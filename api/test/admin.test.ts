import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SystemProbe } from '../src/admin/probe.js';
import { createApp } from '../src/app.js';
import { provisionAdminTotp } from '../src/auth/admin-totp.js';
import { prisma } from '../src/db.js';
import { sent } from '../src/mail.js';
import { createUser, PASSWORD, post, resetDb, totpNow } from './helpers.js';

const probe: SystemProbe = {
  async queues() {
    return [{ name: 'checks', waiting: 2, active: 1, delayed: 40, failed: 0, workers: 1 }];
  },
  async redisMemory() {
    return '1.20M';
  },
};
const noScheduler = { schedule: async () => undefined, unschedule: async () => undefined };
const app = createApp({
  authLimits: { perIp: 1000, perAccount: 1000 },
  scheduler: noScheduler,
  probe,
});
const H = (auth: string) => ({ Authorization: auth, 'X-Requested-With': 'northstar' });

async function login(email: string) {
  const res = await post(app, '/api/auth/login').send({ email, password: PASSWORD });
  return { auth: `Bearer ${res.body.accessToken as string}`, body: res.body };
}

// A super_admin provisioned on the server and signed in with a code, as the panel requires.
async function adminWithTwoFactor() {
  const admin = await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
  const { secret } = await provisionAdminTotp(admin.id);
  const first = await post(app, '/api/auth/login').send({
    email: 'ops@northstar.local',
    password: PASSWORD,
  });
  const verified = await post(app, '/api/auth/2fa/verify').send({
    challenge: first.body.challenge,
    code: await totpNow(secret),
  });
  return `Bearer ${verified.body.accessToken as string}`;
}

let admin: string;
let mira: { id: string; organizationId: string };

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  admin = await adminWithTwoFactor();
  const user = await createUser({ email: 'mira@brightline.studio' });
  mira = { id: user.id, organizationId: user.membership!.organizationId };
});

afterEach(async () => {
  // Plans are shared fixtures from the migration; put them back as they were.
  await prisma.plan.update({ where: { id: 'starter' }, data: { maxMonitors: 50, maxClients: 10 } });
});

const ADMIN_ROUTES: [string, string][] = [
  ['get', '/api/admin/users'],
  ['get', '/api/admin/system/health'],
  ['get', '/api/admin/audit-logs'],
  ['get', '/api/admin/plans'],
  ['get', '/api/admin/organizations'],
];

describe('the admin guard', () => {
  it.each(ADMIN_ROUTES)('refuses %s %s to an ordinary user', async (method, path) => {
    const { auth } = await login('mira@brightline.studio');
    const res = await request(app)[method as 'get'](path).set(H(auth));
    expect(res.status).toBe(403);
  });

  it('refuses an admin who has not finished two-factor', async () => {
    await createUser({ email: 'new-admin@northstar.local', role: 'super_admin' });
    const { auth } = await login('new-admin@northstar.local');
    expect((await request(app).get('/api/admin/users').set(H(auth))).status).toBe(403);
  });

  it('refuses everyone signed out', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  it('refuses suspending to anyone but an admin', async () => {
    const { auth } = await login('mira@brightline.studio');
    const res = await post(app, `/api/admin/users/${mira.id}/suspend`).set('Authorization', auth);
    expect(res.status).toBe(403);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('users', () => {
  it('finds users by email or name', async () => {
    const res = await request(app).get('/api/admin/users?q=brightline').set(H(admin));
    expect(res.body.total).toBe(1);
    expect(res.body.users[0]).toMatchObject({
      email: 'mira@brightline.studio',
      membership: { role: 'agency_admin' },
    });
  });

  it('suspends a user: their sessions end at once and they cannot sign back in', async () => {
    const { auth } = await login('mira@brightline.studio');
    const res = await post(app, `/api/admin/users/${mira.id}/suspend`).set('Authorization', admin);
    expect(res.status).toBe(204);

    expect((await request(app).get('/api/monitors').set(H(auth))).status).toBe(401);
    const again = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    expect(again.status).toBe(403);
    // A wrong password still gets the generic answer, so suspension reveals nothing.
    const wrong = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: 'not-the-right-password',
    });
    expect(wrong.body).toEqual({ error: 'Invalid email or password' });

    await post(app, `/api/admin/users/${mira.id}/activate`).set('Authorization', admin);
    expect((await login('mira@brightline.studio')).body.accessToken).toEqual(expect.any(String));
  });

  it('will not let an admin suspend themselves', async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'ops@northstar.local' } });
    const res = await post(app, `/api/admin/users/${me.id}/suspend`).set('Authorization', admin);
    expect(res.status).toBe(400);
  });

  it('sends a password reset link', async () => {
    const res = await post(app, `/api/admin/users/${mira.id}/password-reset`).set(
      'Authorization',
      admin,
    );
    expect(res.status).toBe(204);
    expect(sent.at(-1)).toMatchObject({ to: 'mira@brightline.studio' });
  });
});

describe('the audit log', () => {
  it('records every admin action with who, what, whom and from where', async () => {
    await post(app, `/api/admin/users/${mira.id}/suspend`).set('Authorization', admin);
    await post(app, `/api/admin/users/${mira.id}/activate`).set('Authorization', admin);
    await post(app, `/api/admin/users/${mira.id}/password-reset`).set('Authorization', admin);
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 60, maxClients: 12 });
    await request(app)
      .patch(`/api/admin/organizations/${mira.organizationId}`)
      .set(H(admin))
      .send({ plan: 'agency' });

    const res = await request(app).get('/api/admin/audit-logs').set(H(admin));
    expect(res.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'organization.plan',
      'plan.update',
      'user.password_reset',
      'user.activate',
      'user.suspend',
    ]);
    for (const e of res.body.entries) {
      expect(e.actor.email).toBe('ops@northstar.local');
      expect(e.ip).toEqual(expect.any(String));
    }
    expect(res.body.entries[1].details).toEqual({
      from: { maxMonitors: 50, maxClients: 10 },
      to: { maxMonitors: 60, maxClients: 12 },
    });
  });
});

describe('system health', () => {
  it('reports queues, workers, checks and database size', async () => {
    const res = await request(app).get('/api/admin/system/health').set(H(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      queues: [{ name: 'checks', waiting: 2, workers: 1 }],
      workersOnline: 1,
      redisMemory: '1.20M',
      checks24h: 0,
    });
    expect(res.body.databaseBytes).toBeGreaterThan(0);
  });
});

describe('plan limits', () => {
  const monitor = (i: number) => ({
    name: `Site ${i}`,
    type: 'http',
    target: `https://1.1.1.1/${i}`,
    intervalSec: 60,
    timeoutMs: 5000,
    retries: 0,
  });

  it('stops an agency at its plan’s monitor limit', async () => {
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 2, maxClients: 10 });
    const { auth } = await login('mira@brightline.studio');

    expect(
      (await post(app, '/api/monitors').set('Authorization', auth).send(monitor(1))).status,
    ).toBe(201);
    expect(
      (await post(app, '/api/monitors').set('Authorization', auth).send(monitor(2))).status,
    ).toBe(201);
    const third = await post(app, '/api/monitors').set('Authorization', auth).send(monitor(3));
    expect(third.status).toBe(403);
    expect(third.body.error).toMatch(/Starter plan allows 2 monitors/);
  });

  it('holds the limit when several monitors are created at the same moment', async () => {
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 2, maxClients: 10 });
    const { auth } = await login('mira@brightline.studio');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        post(app, '/api/monitors').set('Authorization', auth).send(monitor(i)),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await prisma.monitor.count()).toBe(2);
  });

  it('refuses an import that would go over the limit, creating nothing', async () => {
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 3, maxClients: 10 });
    const { auth } = await login('mira@brightline.studio');
    const rows = [1, 2, 3, 4].map((i) => ({
      name: `Site ${i}`,
      url: `https://1.1.1.1/${i}`,
      client: '',
      intervalSec: 60,
    }));
    const res = await post(app, '/api/monitors/import/commit')
      .set('Authorization', auth)
      .send({ rows });
    expect(res.status).toBe(403);
    expect(await prisma.monitor.count()).toBe(0);
  });

  it('stops an agency at its plan’s client limit', async () => {
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 50, maxClients: 1 });
    const { auth } = await login('mira@brightline.studio');
    await post(app, '/api/clients').set('Authorization', auth).send({ name: 'Harbor & Pine' });
    const second = await post(app, '/api/clients')
      .set('Authorization', auth)
      .send({ name: 'Marlowe' });
    expect(second.status).toBe(403);
  });

  it('lifts the limit when the agency moves to a larger plan', async () => {
    await request(app)
      .patch('/api/admin/plans/starter')
      .set(H(admin))
      .send({ maxMonitors: 1, maxClients: 10 });
    const { auth } = await login('mira@brightline.studio');
    await post(app, '/api/monitors').set('Authorization', auth).send(monitor(1));
    await request(app)
      .patch(`/api/admin/organizations/${mira.organizationId}`)
      .set(H(admin))
      .send({ plan: 'agency' });
    expect(
      (await post(app, '/api/monitors').set('Authorization', auth).send(monitor(2))).status,
    ).toBe(201);
  });
});
