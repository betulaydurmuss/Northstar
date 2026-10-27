import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

const noScheduler = { schedule: async () => undefined, unschedule: async () => undefined };
const app = createApp({ authLimits: { perIp: 1000, perAccount: 1000 }, scheduler: noScheduler });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function signIn(email: string) {
  const user = await createUser({ email });
  const res = await post(app, '/api/auth/login').send({ email, password: PASSWORD });
  return { user, auth: `Bearer ${res.body.accessToken as string}` };
}

async function addChecks(
  monitorId: string,
  agoMs: number,
  n: number,
  status: 'up' | 'down',
  ms: number,
) {
  const now = Date.now();
  await prisma.checkResult.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      monitorId,
      status,
      responseMs: status === 'up' ? ms : null,
      checkedAt: new Date(now - agoMs - i * 1000),
    })),
  });
}

let monitorId: string;
let auth: string;

beforeEach(async () => {
  await resetDb();
  const signedIn = await signIn('mira@brightline.studio');
  auth = signedIn.auth;
  const org = await prisma.organization.findFirstOrThrow({
    where: { memberships: { some: { userId: signedIn.user.id } } },
  });
  const monitor = await prisma.monitor.create({
    data: {
      ownerId: signedIn.user.id,
      organizationId: org.id,
      name: 'Sable Architects',
      target: 'https://1.1.1.1/',
      state: 'up',
    },
  });
  monitorId = monitor.id;

  // Last 24 hours: 90 up at 200 ms, 10 down.
  await addChecks(monitorId, HOUR, 90, 'up', 200);
  await addChecks(monitorId, 2 * HOUR, 10, 'down', 0);
  // Three days ago: 100 up at 400 ms.
  await addChecks(monitorId, 3 * DAY, 100, 'up', 400);
  // Twenty days ago, already rolled up: 50 of 100 checks up.
  const hour = new Date(Date.now() - 20 * DAY);
  hour.setUTCMinutes(0, 0, 0);
  await prisma.checkHourly.create({
    data: { monitorId, hour, upCount: 50, totalCount: 100, avgMs: 1000, p95Ms: 1500, msCount: 50 },
  });
});

describe('GET /monitors/:id/stats', () => {
  it('computes uptime over 24 hours, 7 days and 30 days across raw and rolled-up data', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/stats?range=24h`)
      .set('Authorization', auth);

    expect(res.status).toBe(200);
    expect(res.body.uptime['24h']).toBeCloseTo(90);
    expect(res.body.uptime['7d']).toBeCloseTo(95); // 190 of 200
    expect(res.body.uptime['30d']).toBeCloseTo(80); // 240 of 300
  });

  it('averages response time only over checks that measured one', async () => {
    const day = await request(app)
      .get(`/api/monitors/${monitorId}/stats?range=24h`)
      .set('Authorization', auth);
    expect(day.body.avgMs).toBe(200);
    expect(day.body.checks).toBe(100);

    // 90 x 200 ms + 100 x 400 ms, weighted by sample count.
    const week = await request(app)
      .get(`/api/monitors/${monitorId}/stats?range=7d`)
      .set('Authorization', auth);
    expect(week.body.avgMs).toBe(Math.round((90 * 200 + 100 * 400) / 190));
  });

  it('reports no uptime rather than 100% when there is no data', async () => {
    await prisma.checkResult.deleteMany();
    await prisma.checkHourly.deleteMany();
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/stats`)
      .set('Authorization', auth);
    expect(res.body.uptime).toEqual({ '24h': null, '7d': null, '30d': null });
  });

  it('refuses an unknown range', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/stats?range=1y`)
      .set('Authorization', auth);
    expect(res.status).toBe(400);
  });

  it("does not reveal another account's stats", async () => {
    const other = await signIn('theo@fieldnotes.agency');
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/stats`)
      .set('Authorization', other.auth);
    expect(res.status).toBe(404);
  });
});

describe('GET /monitors/:id/series', () => {
  it('buckets checks for the chart and keeps every check', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/series?range=24h`)
      .set('Authorization', auth);
    const total = res.body.reduce((n: number, p: { total: number }) => n + p.total, 0);
    expect(total).toBe(100);
    expect(res.body.some((p: { up: number; total: number }) => p.up < p.total)).toBe(true);
  });
});

describe('GET /monitors', () => {
  it('includes 24 hourly cells and the 24-hour uptime for each monitor', async () => {
    const res = await request(app).get('/api/monitors').set('Authorization', auth);
    expect(res.body[0].last24h).toHaveLength(24);
    expect(res.body[0].uptime24h).toBeCloseTo(90);
  });
});

describe('GET /incidents', () => {
  it("lists the caller's incidents only", async () => {
    await prisma.incident.create({ data: { monitorId, cause: 'The server answered 503' } });
    const other = await signIn('theo@fieldnotes.agency');

    const mine = await request(app).get('/api/incidents').set('Authorization', auth);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ cause: 'The server answered 503', resolvedAt: null });

    const theirs = await request(app)
      .get(`/api/incidents?monitorId=${monitorId}`)
      .set('Authorization', other.auth);
    expect(theirs.body).toEqual([]);
  });
});
