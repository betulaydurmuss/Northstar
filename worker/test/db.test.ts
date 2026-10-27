import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { recordOutcome } from '../src/record.js';
import { rollUpOldChecks } from '../src/rollup.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let monitorId: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, monitors, check_results_hourly RESTART IDENTITY CASCADE',
  );
  const owner = await prisma.user.create({
    data: { email: 'mira@brightline.studio', name: 'Mira Okafor', passwordHash: 'x' },
  });
  const monitor = await prisma.monitor.create({
    data: { ownerId: owner.id, name: 'Lumen Yoga Studio', target: 'https://1.1.1.1/' },
  });
  monitorId = monitor.id;
});

const up = { status: 'up' as const, responseMs: 120, statusCode: 200, error: null };
const down = {
  status: 'down' as const,
  responseMs: null,
  statusCode: 503,
  error: 'The server answered 503',
};

describe('recordOutcome', () => {
  it('opens one incident for an outage and closes it on recovery', async () => {
    expect((await recordOutcome(monitorId, up)).notify).toBeNull();

    const opened = await recordOutcome(monitorId, down);
    expect(opened.notify?.kind).toBe('incident-opened');
    expect((await recordOutcome(monitorId, down)).notify).toBeNull();

    const resolved = await recordOutcome(monitorId, up);
    expect(resolved.notify).toEqual({
      kind: 'incident-resolved',
      incidentId: opened.notify!.incidentId,
    });

    const incidents = await prisma.incident.findMany();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ cause: 'The server answered 503' });
    expect(incidents[0]!.resolvedAt).not.toBeNull();
    expect(await prisma.checkResult.count()).toBe(4);
  });

  it('opens a single incident when two failed checks land at once', async () => {
    await recordOutcome(monitorId, up);
    await Promise.all([recordOutcome(monitorId, down), recordOutcome(monitorId, down)]);
    expect(await prisma.incident.count()).toBe(1);
  });
});

describe('rollUpOldChecks', () => {
  it('folds checks older than seven days into hourly rows and keeps recent ones', async () => {
    const now = new Date('2026-10-27T12:30:00Z');
    const old = new Date(now.getTime() - 10 * DAY);
    old.setUTCMinutes(5, 0, 0);
    await prisma.checkResult.createMany({
      data: [
        ...Array.from({ length: 9 }, (_, i) => ({
          monitorId,
          status: 'up' as const,
          responseMs: 100 + i * 10,
          checkedAt: new Date(old.getTime() + i * 60_000),
        })),
        { monitorId, status: 'down' as const, checkedAt: new Date(old.getTime() + 9 * 60_000) },
        {
          monitorId,
          status: 'up' as const,
          responseMs: 90,
          checkedAt: new Date(now.getTime() - DAY),
        },
      ],
    });

    const result = await rollUpOldChecks(now);
    expect(result).toMatchObject({ hours: 1, deleted: 10 });

    const [row] = await prisma.checkHourly.findMany();
    expect(row).toMatchObject({ upCount: 9, totalCount: 10, msCount: 9 });
    expect(row!.avgMs).toBeCloseTo(140);
    expect(await prisma.checkResult.count()).toBe(1);
  });

  it('can run twice without counting anything twice', async () => {
    const now = new Date('2026-10-27T12:30:00Z');
    await prisma.checkResult.create({
      data: {
        monitorId,
        status: 'up',
        responseMs: 100,
        checkedAt: new Date(now.getTime() - 9 * DAY),
      },
    });
    await rollUpOldChecks(now);
    await rollUpOldChecks(now);
    const rows = await prisma.checkHourly.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalCount).toBe(1);
  });
});
