import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

const noScheduler = { schedule: async () => undefined, unschedule: async () => undefined };
const app = createApp({ authLimits: { perIp: 1000, perAccount: 1000 }, scheduler: noScheduler });

async function login(email: string) {
  const res = await post(app, '/api/auth/login').send({ email, password: PASSWORD });
  return `Bearer ${res.body.accessToken as string}`;
}

// Two agencies. Brightline has two clients, each with one monitor and one domain, and
// a client viewer for Harbor & Pine.
let brightline: string;
let harbor: { client: string; monitor: string };
let marlowe: { client: string; monitor: string };
let agency: string;
let viewer: string;
let rival: string;

beforeEach(async () => {
  await resetDb();
  const admin = await createUser({ email: 'mira@brightline.studio' });
  brightline = admin.membership!.organizationId;

  async function clientWithMonitor(name: string) {
    const client = await prisma.client.create({ data: { organizationId: brightline, name } });
    const monitor = await prisma.monitor.create({
      data: {
        organizationId: brightline,
        ownerId: admin.id,
        clientId: client.id,
        name,
        target: `https://1.1.1.1/${client.id}`,
      },
    });
    await prisma.domain.create({
      data: { organizationId: brightline, clientId: client.id, domain: `${client.id}.com` },
    });
    await prisma.incident.create({
      data: { monitorId: monitor.id, cause: 'The server answered 500' },
    });
    return { client: client.id, monitor: monitor.id };
  }
  harbor = await clientWithMonitor('Harbor & Pine Coffee');
  marlowe = await clientWithMonitor('Marlowe Dental Clinic');

  await createUser({
    email: 'owner@harborpine.coffee',
    agency: brightline,
    membership: 'client_viewer',
    clientId: harbor.client,
  });
  await createUser({ email: 'theo@fieldnotes.agency' });

  agency = await login('mira@brightline.studio');
  viewer = await login('owner@harborpine.coffee');
  rival = await login('theo@fieldnotes.agency');
});

const get = (path: string, auth: string) => request(app).get(path).set('Authorization', auth);

describe('between agencies', () => {
  it('shows another agency nothing at all', async () => {
    expect((await get('/api/monitors', rival)).body).toEqual([]);
    expect((await get('/api/clients', rival)).body).toEqual([]);
    expect((await get('/api/incidents', rival)).body).toEqual([]);
    expect((await get('/api/expirations', rival)).body).toEqual([]);
  });

  it('answers 404 for ids from another agency', async () => {
    expect((await get(`/api/monitors/${harbor.monitor}`, rival)).status).toBe(404);
    expect((await get(`/api/monitors/${harbor.monitor}/stats`, rival)).status).toBe(404);
    expect((await get(`/api/clients/${harbor.client}`, rival)).status).toBe(404);
  });

  it('cannot put a monitor into another agency’s client', async () => {
    const res = await post(app, '/api/monitors').set('Authorization', rival).send({
      name: 'Sneaky',
      type: 'http',
      target: 'https://1.1.1.1/',
      intervalSec: 60,
      timeoutMs: 5000,
      retries: 0,
      clientId: harbor.client,
    });
    expect(res.status).toBe(400);
  });
});

describe('a client viewer', () => {
  it('sees only their own client', async () => {
    const monitors = await get('/api/monitors', viewer);
    expect(monitors.body.map((m: { id: string }) => m.id)).toEqual([harbor.monitor]);

    const clients = await get('/api/clients', viewer);
    expect(clients.body.map((c: { id: string }) => c.id)).toEqual([harbor.client]);

    const incidents = await get('/api/incidents', viewer);
    expect(incidents.body).toHaveLength(1);
    expect(incidents.body[0].monitor.id).toBe(harbor.monitor);

    const expirations = await get('/api/expirations', viewer);
    expect(expirations.body.map((e: { name: string }) => e.name)).toEqual([`${harbor.client}.com`]);
  });

  it('cannot widen the view by asking for another client', async () => {
    const monitors = await get(`/api/monitors?clientId=${marlowe.client}`, viewer);
    expect(monitors.body).toEqual([]);
    const expirations = await get(`/api/expirations?clientId=${marlowe.client}`, viewer);
    expect(expirations.body).toEqual([]);
    const incidents = await get(`/api/incidents?monitorId=${marlowe.monitor}`, viewer);
    expect(incidents.body).toEqual([]);
  });

  it('gets 404 for the other client’s monitor and client', async () => {
    expect((await get(`/api/monitors/${marlowe.monitor}`, viewer)).status).toBe(404);
    expect((await get(`/api/monitors/${marlowe.monitor}/checks`, viewer)).status).toBe(404);
    expect((await get(`/api/clients/${marlowe.client}`, viewer)).status).toBe(404);
  });

  it('can look but not change anything', async () => {
    const pause = await post(app, `/api/monitors/${harbor.monitor}/pause`).set(
      'Authorization',
      viewer,
    );
    expect(pause.status).toBe(403);
    const create = await post(app, '/api/clients')
      .set('Authorization', viewer)
      .send({ name: 'Mine' });
    expect(create.status).toBe(403);
  });
});

describe('the agency', () => {
  it('sees every client and can filter by one', async () => {
    expect((await get('/api/monitors', agency)).body).toHaveLength(2);
    const filtered = await get(`/api/monitors?clientId=${marlowe.client}`, agency);
    expect(filtered.body.map((m: { id: string }) => m.id)).toEqual([marlowe.monitor]);
  });
});
