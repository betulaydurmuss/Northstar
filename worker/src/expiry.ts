import { parseHttpTarget } from '@northstar/shared/monitor';
import type { Monitor } from '@prisma/client';
import nodemailer from 'nodemailer';
import { readCertificate } from './checks/certificate.js';
import { lookupDomainExpiry, registrableDomain } from './checks/domain.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { expiryEmail } from './notify/templates.js';

export const THRESHOLDS = [30, 15, 7, 1] as const;
const DAY = 86_400_000;
// Refresh a little under a day, so the daily run always finds yesterday's data stale.
const STALE_MS = 20 * 3_600_000;

export const daysLeft = (expiresAt: Date, now = new Date()) =>
  Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);

// Which warning to send now, and which thresholds to mark as handled. A certificate first
// seen with 5 days left crosses 30, 15 and 7 at once: one email (the most urgent), and
// all three recorded so the 30- and 15-day warnings never arrive late.
export function noticePlan(days: number, alreadySent: number[]) {
  const due = THRESHOLDS.filter((t) => days <= t && !alreadySent.includes(t));
  if (due.length === 0) return { send: null, record: [] as number[] };
  return { send: Math.min(...due), record: due };
}

const isHttps = (m: Pick<Monitor, 'type' | 'target'>) =>
  (m.type === 'http' || m.type === 'keyword') && parseHttpTarget(m.target)?.protocol === 'https:';

export async function refreshCertificate(m: Pick<Monitor, 'id' | 'target'>) {
  const now = new Date();
  try {
    const info = await readCertificate(new URL(m.target), {
      timeoutMs: 10_000,
      allowPrivate: config.ALLOW_PRIVATE_TARGETS,
    });
    const data = { ...info, checkedAt: now };
    await prisma.certificate.upsert({
      where: { monitorId: m.id },
      create: { monitorId: m.id, ...data },
      update: data,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Could not read the certificate';
    await prisma.certificate.upsert({
      where: { monitorId: m.id },
      create: { monitorId: m.id, authorized: false, error, checkedAt: now },
      update: { error, checkedAt: now },
    });
  }
}

// Makes sure the monitor's registrable domain has a row, then looks it up if due.
export async function refreshDomainFor(m: Pick<Monitor, 'organizationId' | 'clientId' | 'target'>) {
  const host = parseHttpTarget(m.target)?.hostname;
  const domain = host ? registrableDomain(host) : null;
  if (!domain) return;

  const row = await prisma.domain.upsert({
    where: { organizationId_domain: { organizationId: m.organizationId, domain } },
    create: { organizationId: m.organizationId, clientId: m.clientId, domain },
    update: {},
  });
  // Dates typed in by hand are never overwritten by a lookup.
  if (row.source === 'manual') return;
  if (row.checkedAt && Date.now() - row.checkedAt.getTime() < STALE_MS) return;

  const { expiresAt, error } = await lookupDomainExpiry(domain);
  await prisma.domain.update({
    where: { id: row.id },
    data: { expiresAt: expiresAt ?? row.expiresAt, error, checkedAt: new Date() },
  });
}

// Called after a check: the first time a monitor is seen, fill in its certificate and
// domain right away rather than waiting for the nightly run.
// Two indexed reads per check; the writes only happen the first time.
export async function ensureExpiryData(m: Monitor) {
  if (m.type !== 'http' && m.type !== 'keyword') return;

  if (isHttps(m)) {
    const cert = await prisma.certificate.findUnique({
      where: { monitorId: m.id },
      select: { monitorId: true },
    });
    if (!cert) await refreshCertificate(m);
  }

  const host = parseHttpTarget(m.target)?.hostname;
  const domain = host ? registrableDomain(host) : null;
  if (!domain) return;
  const known = await prisma.domain.findUnique({
    where: { organizationId_domain: { organizationId: m.organizationId, domain } },
    select: { id: true },
  });
  if (!known) await refreshDomainFor(m);
}

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false,
});

async function agencyAdmins(organizationId: string) {
  const members = await prisma.membership.findMany({
    where: { organizationId, role: 'agency_admin' },
    select: { user: { select: { email: true } } },
  });
  return members.map((m) => m.user.email);
}

async function warn(
  kind: 'certificate' | 'domain',
  subjectId: string,
  expiresAt: Date,
  organizationId: string,
  label: string,
) {
  const days = daysLeft(expiresAt);
  const sent = await prisma.expiryNotice.findMany({
    where: { kind, subjectId, expiresAt },
    select: { threshold: true },
  });
  const plan = noticePlan(
    days,
    sent.map((s) => s.threshold),
  );
  if (plan.send === null) return false;

  const to = await agencyAdmins(organizationId);
  if (to.length) {
    const message = expiryEmail({
      kind,
      label,
      expiresAt,
      daysLeft: days,
      link: `${config.WEB_ORIGIN}/expirations`,
    });
    await transport.sendMail({ from: config.MAIL_FROM, to, ...message });
  }
  // skipDuplicates makes a second worker racing on the same notice harmless.
  await prisma.expiryNotice.createMany({
    data: plan.record.map((threshold) => ({ kind, subjectId, expiresAt, threshold })),
    skipDuplicates: true,
  });
  return true;
}

// The daily run: refresh what is stale, then send whatever warnings are due.
export async function refreshAndWarn() {
  const monitors = await prisma.monitor.findMany({
    where: { isActive: true, type: { in: ['http', 'keyword'] } },
    include: { certificate: { select: { checkedAt: true } } },
  });

  for (const m of monitors) {
    if (
      isHttps(m) &&
      (!m.certificate || Date.now() - m.certificate.checkedAt.getTime() > STALE_MS)
    ) {
      await refreshCertificate(m);
    }
    await refreshDomainFor(m);
  }

  let warned = 0;
  const certs = await prisma.certificate.findMany({
    where: { validTo: { not: null }, monitor: { isActive: true } },
    include: { monitor: { select: { name: true, organizationId: true, target: true } } },
  });
  for (const c of certs) {
    const label = `${c.monitor.name} (${new URL(c.monitor.target).hostname})`;
    if (await warn('certificate', c.monitorId, c.validTo!, c.monitor.organizationId, label))
      warned++;
  }

  const domains = await prisma.domain.findMany({ where: { expiresAt: { not: null } } });
  for (const d of domains) {
    if (await warn('domain', d.id, d.expiresAt!, d.organizationId, d.domain)) warned++;
  }
  return { monitors: monitors.length, warned };
}
