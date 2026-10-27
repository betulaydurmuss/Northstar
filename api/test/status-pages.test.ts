import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { REPORTS_DIR } from '../src/files.js';
import { sent } from '../src/mail.js';
import type { ReportQueue } from '../src/reports/router.js';
import { clearStatusCache } from '../src/status-pages/router.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

const queued: string[] = [];
const reportQueue: ReportQueue = {
  async enqueue(job) {
    queued.push(job.reportId);
  },
};
const noScheduler = { schedule: async () => undefined, unschedule: async () => undefined };
const app = createApp({
  authLimits: { perIp: 1000, perAccount: 1000 },
  scheduler: noScheduler,
  reportQueue,
});

const H = (auth: string) => ({ Authorization: auth, 'X-Requested-With': 'northstar' });

async function login(email: string) {
  const res = await post(app, '/api/auth/login').send({ email, password: PASSWORD });
  return `Bearer ${res.body.accessToken as string}`;
}

let agency: string;
let viewerA: string;
let harbor: { client: string; monitor: string };
let marlowe: { client: string; monitor: string };

beforeEach(async () => {
  await resetDb();
  clearStatusCache();
  queued.length = 0;
  sent.length = 0;
  const admin = await createUser({ email: 'mira@brightline.studio' });
  const org = admin.membership!.organizationId;

  async function clientWithMonitor(name: string, target: string) {
    const client = await prisma.client.create({ data: { organizationId: org, name } });
    const monitor = await prisma.monitor.create({
      data: {
        organizationId: org,
        ownerId: admin.id,
        clientId: client.id,
        name,
        target,
        state: 'up',
      },
    });
    return { client: client.id, monitor: monitor.id };
  }
  harbor = await clientWithMonitor('Harbor & Pine Coffee', 'https://1.1.1.1/internal-admin');
  marlowe = await clientWithMonitor('Marlowe Dental Clinic', 'https://8.8.8.8/');

  await createUser({
    email: 'owner@harborpine.coffee',
    agency: org,
    membership: 'client_viewer',
    clientId: harbor.client,
  });
  agency = await login('mira@brightline.studio');
  viewerA = await login('owner@harborpine.coffee');
});

async function publish(clientId: string, monitorId: string, slug: string, extra = {}) {
  return request(app)
    .put(`/api/status-pages/by-client/${clientId}`)
    .set(H(agency))
    .send({
      title: 'Harbor & Pine status',
      slug,
      isPublic: true,
      monitors: [{ monitorId, displayName: 'Online shop', groupName: 'Ordering' }],
      ...extra,
    });
}

describe('public status page', () => {
  it('opens without signing in and shows only what was chosen', async () => {
    expect((await publish(harbor.client, harbor.monitor, 'harbor-pine')).status).toBe(200);
    await prisma.incident.create({
      data: { monitorId: harbor.monitor, cause: 'connect ECONNREFUSED 10.0.0.12:443' },
    });
    clearStatusCache();

    const res = await request(app).get('/api/public/status/harbor-pine');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'Harbor & Pine status',
      client: { name: 'Harbor & Pine Coffee', brandColor: '#818CF8' },
    });
    expect(res.body.monitors).toHaveLength(1);
    expect(res.body.monitors[0]).toMatchObject({ name: 'Online shop', group: 'Ordering' });
    expect(res.body.monitors[0].days).toHaveLength(90);
    expect(res.body.activeIncidents[0].title).toBe('Online shop is unavailable');

    // Addresses, internal names and technical causes never leave the building.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('1.1.1.1');
    expect(text).not.toContain('internal-admin');
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain(harbor.monitor);
  });

  it('shows published incident updates', async () => {
    await publish(harbor.client, harbor.monitor, 'harbor-pine');
    const incident = await prisma.incident.create({
      data: { monitorId: harbor.monitor, cause: 'The server answered 502' },
    });
    const update = await post(app, `/api/incidents/${incident.id}/updates`)
      .set('Authorization', agency)
      .send({ status: 'identified', message: 'Our hosting provider is restarting a server.' });
    expect(update.status).toBe(201);

    const res = await request(app).get('/api/public/status/harbor-pine');
    expect(res.body.activeIncidents[0].updates[0]).toMatchObject({
      status: 'identified',
      message: 'Our hosting provider is restarting a server.',
    });
  });

  it('reports maintenance in progress', async () => {
    await publish(harbor.client, harbor.monitor, 'harbor-pine');
    const res = await post(app, '/api/maintenance-windows')
      .set('Authorization', agency)
      .send({
        clientId: harbor.client,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        message: 'Moving to a faster server',
      });
    expect(res.status).toBe(201);
    const page = await request(app).get('/api/public/status/harbor-pine');
    expect(page.body.status).toBe('maintenance');
    expect(page.body.maintenance[0]).toMatchObject({
      message: 'Moving to a faster server',
      active: true,
    });
  });

  it('refuses a maintenance window that ends before it starts', async () => {
    const res = await post(app, '/api/maintenance-windows').set('Authorization', agency).send({
      clientId: harbor.client,
      startsAt: '2026-11-02T10:00:00Z',
      endsAt: '2026-11-02T09:00:00Z',
      message: 'Backwards',
    });
    expect(res.status).toBe(400);
  });

  it('is a 404 when private or unknown', async () => {
    await publish(harbor.client, harbor.monitor, 'harbor-pine', { isPublic: false });
    expect((await request(app).get('/api/public/status/harbor-pine')).status).toBe(404);
    expect((await request(app).get('/api/public/status/nobody')).status).toBe(404);
  });

  it('is found by its custom domain', async () => {
    await publish(harbor.client, harbor.monitor, 'harbor-pine', {
      customDomain: 'status.harborpine.coffee',
    });
    const res = await request(app).get('/api/public/status-host/status.harborpine.coffee');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('harbor-pine');
  });

  it("cannot show another client's monitor", async () => {
    const res = await publish(harbor.client, marlowe.monitor, 'harbor-pine');
    expect(res.status).toBe(400);
  });

  it('refuses a slug that is already taken', async () => {
    await publish(harbor.client, harbor.monitor, 'shared-name');
    const res = await publish(marlowe.client, marlowe.monitor, 'shared-name');
    expect(res.status).toBe(409);
  });
});

describe('reports', () => {
  it('queues a report and serves the PDF once the worker has rendered it', async () => {
    const created = await post(app, '/api/reports')
      .set('Authorization', agency)
      .send({ clientId: harbor.client, period: '2026-09' });
    expect(created.status).toBe(202);
    expect(queued).toEqual([created.body.id]);

    const early = await request(app).get(`/api/reports/${created.body.id}/pdf`).set(H(agency));
    expect(early.status).toBe(409);

    await mkdir(REPORTS_DIR, { recursive: true });
    await writeFile(join(REPORTS_DIR, `${created.body.id}.pdf`), '%PDF-1.7 test');
    await prisma.report.update({
      where: { id: created.body.id },
      data: { status: 'ready', filePath: `${created.body.id}.pdf` },
    });
    const pdf = await request(app).get(`/api/reports/${created.body.id}/pdf`).set(H(viewerA));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('2026-09-uptime-report.pdf');
  });

  it('refuses a month that has not started', async () => {
    const res = await post(app, '/api/reports')
      .set('Authorization', agency)
      .send({ clientId: harbor.client, period: '2099-01' });
    expect(res.status).toBe(400);
  });
});

describe("a client's user and another client's data", () => {
  it('gets 404 or 403 everywhere', async () => {
    await publish(marlowe.client, marlowe.monitor, 'marlowe');
    const report = await prisma.report.create({
      data: { clientId: marlowe.client, period: '2026-09', status: 'ready', filePath: 'x.pdf' },
    });
    const window = await prisma.maintenanceWindow.create({
      data: {
        clientId: marlowe.client,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        message: 'Marlowe only',
      },
    });

    const get = (path: string) => request(app).get(path).set(H(viewerA));
    expect((await get(`/api/status-pages/by-client/${marlowe.client}`)).status).toBe(404);
    expect((await get(`/api/status-pages/by-client/${marlowe.client}/preview`)).status).toBe(404);
    expect((await get(`/api/reports/${report.id}/pdf`)).status).toBe(404);
    expect((await get('/api/reports')).body).toEqual([]);
    expect((await get(`/api/maintenance-windows?clientId=${marlowe.client}`)).body).toEqual([]);

    // And they cannot change anything, not even their own client.
    const edit = await request(app)
      .put(`/api/status-pages/by-client/${harbor.client}`)
      .set(H(viewerA))
      .send({ title: 'x', slug: 'mine', isPublic: true, monitors: [] });
    expect(edit.status).toBe(403);
    expect(
      (await request(app).delete(`/api/maintenance-windows/${window.id}`).set(H(viewerA))).status,
    ).toBe(403);
    expect(
      (
        await post(app, '/api/reports')
          .set('Authorization', viewerA)
          .send({ clientId: harbor.client })
      ).status,
    ).toBe(403);
  });
});

describe('client invitations', () => {
  function tokenFromLastEmail() {
    return sent.at(-1)?.text.match(/invite\/([\w-]+)/)?.[1];
  }

  it('turns an invitation into a viewer of that client only', async () => {
    const invite = await post(app, `/api/clients/${harbor.client}/invite`)
      .set('Authorization', agency)
      .send({ email: 'barista@harborpine.coffee' });
    expect(invite.status).toBe(201);
    const token = tokenFromLastEmail()!;

    const info = await request(app).get(`/api/invites/${token}`);
    expect(info.body).toEqual({
      email: 'barista@harborpine.coffee',
      clientName: 'Harbor & Pine Coffee',
    });

    const accepted = await post(app, `/api/invites/${token}/accept`).send({
      name: 'Sam Ortiz',
      password: 'steamed-milk-and-oat',
    });
    expect(accepted.status).toBe(201);
    const auth = `Bearer ${accepted.body.accessToken as string}`;

    const monitors = await request(app).get('/api/monitors').set('Authorization', auth);
    expect(monitors.body.map((m: { id: string }) => m.id)).toEqual([harbor.monitor]);

    // Used once, then gone.
    const again = await post(app, `/api/invites/${token}/accept`).send({
      name: 'Someone else',
      password: 'steamed-milk-and-oat',
    });
    expect(again.status).toBe(404);
  });

  it('expires after 72 hours', async () => {
    await post(app, `/api/clients/${harbor.client}/invite`)
      .set('Authorization', agency)
      .send({ email: 'late@harborpine.coffee' });
    await prisma.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/invites/${tokenFromLastEmail()}`)).status).toBe(404);
  });

  it('cannot be sent by a client viewer', async () => {
    const res = await post(app, `/api/clients/${harbor.client}/invite`)
      .set('Authorization', viewerA)
      .send({ email: 'friend@example.com' });
    expect(res.status).toBe(403);
  });
});
