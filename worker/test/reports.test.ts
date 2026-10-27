import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { clip, periodRange, reportData } from '../src/reports/data.js';
import { findChrome, renderPdf } from '../src/reports/pdf.js';
import { reportHtml } from '../src/reports/template.js';

const MIN = 60_000;

describe('clip', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-10-01T00:00:00Z');

  it('counts only the part of an incident inside the month', () => {
    const start = new Date('2026-08-31T23:30:00Z');
    const end = new Date('2026-09-01T00:20:00Z');
    expect(clip(start, end, from, to)).toBe(20 * MIN);
  });

  it('runs an ongoing incident to the end of the period', () => {
    expect(clip(new Date('2026-09-30T23:00:00Z'), null, from, to)).toBe(60 * MIN);
  });
});

describe('periodRange', () => {
  it('stops a month in progress at now', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(periodRange('2026-10', now).to).toEqual(now);
    expect(periodRange('2026-09', now).to).toEqual(new Date('2026-10-01T00:00:00Z'));
  });
});

describe('reportData', () => {
  let clientId: string;
  let monitorId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE users, organizations, monitors, check_results_hourly RESTART IDENTITY CASCADE',
    );
    const owner = await prisma.user.create({
      data: { email: 'mira@brightline.studio', name: 'Mira', passwordHash: 'x' },
    });
    const org = await prisma.organization.create({ data: { name: 'Brightline Studio' } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, name: 'Kettle & Crumb <Bakery>' },
    });
    const monitor = await prisma.monitor.create({
      data: {
        ownerId: owner.id,
        organizationId: org.id,
        clientId: client.id,
        name: 'Shop',
        target: 'https://1.1.1.1/',
      },
    });
    clientId = client.id;
    monitorId = monitor.id;

    const day = new Date('2026-09-10T00:00:00Z').getTime();
    await prisma.checkResult.createMany({
      data: [
        ...Array.from({ length: 98 }, (_, i) => ({
          monitorId,
          status: 'up' as const,
          responseMs: 200,
          checkedAt: new Date(day + i * MIN),
        })),
        { monitorId, status: 'down' as const, checkedAt: new Date(day + 100 * MIN) },
        { monitorId, status: 'down' as const, checkedAt: new Date(day + 101 * MIN) },
        // Taken during planned maintenance: must not count either way.
        ...Array.from({ length: 10 }, (_, i) => ({
          monitorId,
          status: 'down' as const,
          maintenance: true,
          checkedAt: new Date(day + (200 + i) * MIN),
        })),
      ],
    });
    await prisma.incident.create({
      data: {
        monitorId,
        startedAt: new Date(day + 100 * MIN),
        resolvedAt: new Date(day + 102 * MIN),
        cause: 'The server answered 503',
      },
    });
    await prisma.maintenanceWindow.create({
      data: {
        clientId,
        startsAt: new Date(day + 200 * MIN),
        endsAt: new Date(day + 230 * MIN),
        message: 'Server upgrade',
      },
    });
  });

  it('computes uptime, downtime and maintenance for the month', async () => {
    const data = await reportData(clientId, '2026-09');
    expect(data.overall.uptime).toBeCloseTo(98); // 98 of 100, maintenance excluded
    expect(data.overall.checks).toBe(100);
    expect(data.overall.downtimeMs).toBe(2 * MIN);
    expect(data.overall.incidents).toBe(1);
    expect(data.overall.avgMs).toBe(200);
    expect(data.maintenanceMs).toBe(30 * MIN);
    expect(data.days).toHaveLength(30);
    expect(data.periodLabel).toBe('September 2026');
  });

  it('renders escaped HTML with every figure present', async () => {
    const html = reportHtml(await reportData(clientId, '2026-09'), null);
    expect(html).toContain('Kettle &amp; Crumb &lt;Bakery&gt;');
    expect(html).not.toContain('<Bakery>');
    expect(html).toContain('98.00%');
    expect(html).toContain('Planned maintenance (30 min) is not counted against uptime.');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  // Needs a Chrome on the machine; CI runners have one.
  it.skipIf(!findChrome())(
    'renders an A4 PDF',
    async () => {
      const pdf = await renderPdf(reportHtml(await reportData(clientId, '2026-09'), null));
      expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    },
    30_000,
  );
});
