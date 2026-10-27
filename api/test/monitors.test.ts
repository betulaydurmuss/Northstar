import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import type { CheckScheduler } from '../src/monitors/scheduler.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

// Records what would have been sent to Redis.
function fakeScheduler() {
  const scheduled = new Map<string, number>();
  const scheduler: CheckScheduler = {
    async schedule(m) {
      scheduled.set(m.id, m.intervalSec);
    },
    async unschedule(id) {
      scheduled.delete(id);
    },
  };
  return { scheduler, scheduled };
}

let app: ReturnType<typeof createApp>;
let scheduled: Map<string, number>;

beforeEach(async () => {
  await resetDb();
  const fake = fakeScheduler();
  scheduled = fake.scheduled;
  app = createApp({ authLimits: { perIp: 1000, perAccount: 1000 }, scheduler: fake.scheduler });
});

async function tokenFor(email: string) {
  await createUser({ email });
  const res = await post(app, '/api/auth/login').send({ email, password: PASSWORD });
  return `Bearer ${res.body.accessToken as string}`;
}

// A public IP literal needs no DNS, so these tests do not depend on the network.
const monitor = {
  name: 'Harbor & Pine Coffee',
  type: 'http',
  target: 'https://1.1.1.1/',
  intervalSec: 60,
  timeoutMs: 10000,
  retries: 2,
};

describe('monitors', () => {
  it('creates a monitor and schedules its checks', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const res = await post(app, '/api/monitors').set('Authorization', auth).send(monitor);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: monitor.name, state: 'pending', isActive: true });
    expect(scheduled.get(res.body.id)).toBe(60);
  });

  it('refuses an interval outside 30 to 300 seconds', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const res = await post(app, '/api/monitors')
      .set('Authorization', auth)
      .send({ ...monitor, intervalSec: 10 });
    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe('intervalSec');
  });

  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.8/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:5432/',
    'http://localhost:6379/',
  ])('refuses %s as a private address', async (target) => {
    const auth = await tokenFor('mira@brightline.studio');
    const res = await post(app, '/api/monitors')
      .set('Authorization', auth)
      .send({ ...monitor, target });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Monitors cannot point at private or internal addresses');
    expect(await prisma.monitor.count()).toBe(0);
  });

  it('pauses and resumes the schedule', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const { body } = await post(app, '/api/monitors').set('Authorization', auth).send(monitor);

    const paused = await post(app, `/api/monitors/${body.id}/pause`).set('Authorization', auth);
    expect(paused.body).toMatchObject({ isActive: false, state: 'paused' });
    expect(scheduled.has(body.id)).toBe(false);

    await post(app, `/api/monitors/${body.id}/resume`).set('Authorization', auth);
    expect(scheduled.has(body.id)).toBe(true);
  });

  it('reschedules when the interval changes', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const { body } = await post(app, '/api/monitors').set('Authorization', auth).send(monitor);
    await request(app)
      .patch(`/api/monitors/${body.id}`)
      .set('X-Requested-With', 'northstar')
      .set('Authorization', auth)
      .send({ intervalSec: 120 });
    expect(scheduled.get(body.id)).toBe(120);
  });

  it('checks a partial change against the stored values', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const { body } = await post(app, '/api/monitors')
      .set('Authorization', auth)
      .send({ ...monitor, intervalSec: 30, timeoutMs: 5000 });
    const res = await request(app)
      .patch(`/api/monitors/${body.id}`)
      .set('X-Requested-With', 'northstar')
      .set('Authorization', auth)
      .send({ timeoutMs: 30000 });
    expect(res.status).toBe(400);
  });

  it('deletes the monitor and its schedule', async () => {
    const auth = await tokenFor('mira@brightline.studio');
    const { body } = await post(app, '/api/monitors').set('Authorization', auth).send(monitor);
    const res = await request(app)
      .delete(`/api/monitors/${body.id}`)
      .set('X-Requested-With', 'northstar')
      .set('Authorization', auth);
    expect(res.status).toBe(204);
    expect(scheduled.size).toBe(0);
  });
});

describe('ownership', () => {
  it("never shows, changes or deletes another account's monitor", async () => {
    const owner = await tokenFor('mira@brightline.studio');
    const other = await tokenFor('theo@fieldnotes.agency');
    const { body } = await post(app, '/api/monitors').set('Authorization', owner).send(monitor);

    const list = await request(app).get('/api/monitors').set('Authorization', other);
    expect(list.body).toEqual([]);

    const csrf = { 'X-Requested-With': 'northstar', Authorization: other };
    expect((await request(app).get(`/api/monitors/${body.id}`).set(csrf)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/monitors/${body.id}`).set(csrf).send({ name: 'Mine now' }))
        .status,
    ).toBe(404);
    expect((await request(app).post(`/api/monitors/${body.id}/pause`).set(csrf)).status).toBe(404);
    expect((await request(app).delete(`/api/monitors/${body.id}`).set(csrf)).status).toBe(404);

    const stored = await prisma.monitor.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored).toMatchObject({ name: monitor.name, isActive: true });
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get('/api/monitors')).status).toBe(401);
  });
});
