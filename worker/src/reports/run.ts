import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { reportData } from './data.js';
import { renderPdf } from './pdf.js';
import { formatUptime, reportHtml } from './template.js';

// Same folder the api serves from; STORAGE_DIR moves both.
export const STORAGE_DIR =
  process.env.STORAGE_DIR ?? fileURLToPath(new URL('../../../api/storage/', import.meta.url));
const REPORTS_DIR = join(STORAGE_DIR, 'reports');
const LOGOS_DIR = join(STORAGE_DIR, 'logos');

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };

async function logoDataUri(logoPath: string | null) {
  if (!logoPath) return null;
  const ext = logoPath.split('.').pop() ?? '';
  const bytes = await readFile(join(LOGOS_DIR, logoPath)).catch(() => null);
  return bytes && MIME[ext] ? `data:${MIME[ext]};base64,${bytes.toString('base64')}` : null;
}

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false,
});

export async function renderReport(reportId: string, send: boolean) {
  const report = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    include: { client: true },
  });
  try {
    const data = await reportData(report.clientId, report.period);
    const pdf = await renderPdf(reportHtml(data, await logoDataUri(report.client.logoPath)));
    await mkdir(REPORTS_DIR, { recursive: true });
    const fileName = `${report.id}.pdf`;
    await writeFile(join(REPORTS_DIR, fileName), pdf);
    await prisma.report.update({
      where: { id: report.id },
      data: { status: 'ready', filePath: fileName, error: null },
    });

    if (send) {
      // The client's contact gets it, with the agency's admins copied.
      const admins = await prisma.membership.findMany({
        where: { organizationId: report.client.organizationId, role: 'agency_admin' },
        select: { user: { select: { email: true } } },
      });
      const cc = admins.map((a) => a.user.email);
      const to = report.client.contactEmail ?? cc[0];
      if (to) {
        await transport.sendMail({
          from: config.MAIL_FROM,
          to,
          cc: cc.filter((e) => e !== to),
          subject: `${report.client.name}: uptime report for ${data.periodLabel}`,
          text: `Your websites were available ${formatUptime(data.overall.uptime)} of the time in ${data.periodLabel}, with ${data.overall.incidents} incident${data.overall.incidents === 1 ? '' : 's'}.\n\nThe full report is attached.\n\n${data.agency}`,
          attachments: [
            {
              filename: `${report.client.name.replace(/[^\w-]+/g, '-')}-${report.period}-uptime-report.pdf`,
              content: Buffer.from(pdf),
              contentType: 'application/pdf',
            },
          ],
        });
        await prisma.report.update({ where: { id: report.id }, data: { sentAt: new Date() } });
      }
    }
  } catch (err) {
    await prisma.report.update({
      where: { id: report.id },
      data: { status: 'failed', error: err instanceof Error ? err.message : 'Rendering failed' },
    });
    throw err;
  }
}

// The 1st of each month: last month's report for every client that has monitors.
export async function queueMonthlyReports(
  enqueue: (reportId: string) => Promise<unknown>,
  now = new Date(),
) {
  const period = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  const clients = await prisma.client.findMany({
    where: { monitors: { some: {} } },
    select: { id: true },
  });
  for (const c of clients) {
    const report = await prisma.report.upsert({
      where: { clientId_period: { clientId: c.id, period } },
      create: { clientId: c.id, period },
      update: { status: 'queued', error: null },
    });
    await enqueue(report.id);
  }
  return { period, clients: clients.length };
}
