import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import type { CheckScheduler } from '../src/monitors/scheduler.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

const scheduled = new Set<string>();
const scheduler: CheckScheduler = {
  async schedule(m) {
    scheduled.add(m.id);
  },
  async unschedule(id) {
    scheduled.delete(id);
  },
};
const app = createApp({ authLimits: { perIp: 1000, perAccount: 1000 }, scheduler });

let auth: string;
let organizationId: string;

beforeEach(async () => {
  await resetDb();
  scheduled.clear();
  const user = await createUser();
  organizationId = user.membership!.organizationId;
  await prisma.client.create({ data: { organizationId, name: 'Harbor & Pine Coffee' } });
  const res = await post(app, '/api/auth/login').send({
    email: 'mira@brightline.studio',
    password: PASSWORD,
  });
  auth = `Bearer ${res.body.accessToken as string}`;
});

// IP literals keep these tests off the network; DNS is exercised elsewhere.
const csv = [
  'name,url,client,interval',
  'Harbor & Pine shop,https://1.1.1.1/shop,Harbor & Pine Coffee,60',
  ',https://1.1.1.1/menu,harbor & pine coffee,120',
  'Marlowe Dental,https://8.8.8.8/,Marlowe Dental Clinic,',
  'Broken,not-a-url,,60',
  'Internal,http://10.0.0.5/admin,,60',
  'Too fast,https://1.0.0.1/,,10',
  'Twice,https://1.1.1.1/shop,,60',
].join('\n');

describe('CSV import preview', () => {
  it('explains each row', async () => {
    const res = await post(app, '/api/monitors/import/preview')
      .set('Authorization', auth)
      .send({ csv });
    expect(res.status).toBe(200);
    const [shop, menu, marlowe, broken, internal, fast, twice] = res.body.rows;

    expect(shop).toMatchObject({ line: 2, errors: [], newClient: false });
    // A missing name is made from the address; client names match regardless of case.
    expect(menu).toMatchObject({ name: '1.1.1.1/menu', intervalSec: 120, newClient: false });
    expect(marlowe).toMatchObject({ errors: [], newClient: true, intervalSec: 60 });
    expect(broken.errors[0]).toMatch(/http/);
    expect(internal.errors).toContain('Points at a private or internal address');
    expect(fast.errors[0]).toMatch(/30 seconds/);
    expect(twice.errors).toContain('Appears twice in this file');
    expect(res.body.valid).toBe(3);
  });

  it('refuses more than 500 rows', async () => {
    const big = [
      'name,url',
      ...Array.from({ length: 501 }, (_, i) => `S${i},https://1.1.1.1/${i}`),
    ];
    const res = await post(app, '/api/monitors/import/preview')
      .set('Authorization', auth)
      .send({ csv: big.join('\n') });
    expect(res.status).toBe(400);
  });
});

describe('CSV import commit', () => {
  it('creates fifty monitors and the missing client in one go', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      name: `Site ${i + 1}`,
      url: `https://1.1.1.1/site-${i + 1}`,
      client: i < 25 ? 'Harbor & Pine Coffee' : 'Sable Architects',
      intervalSec: 60,
    }));
    const res = await post(app, '/api/monitors/import/commit')
      .set('Authorization', auth)
      .send({ rows });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: 50, clientsCreated: 1 });
    expect(await prisma.monitor.count({ where: { organizationId } })).toBe(50);
    expect(await prisma.client.count({ where: { organizationId } })).toBe(2);
    expect(scheduled.size).toBe(50);
  });

  it('creates nothing if any row is invalid', async () => {
    const res = await post(app, '/api/monitors/import/commit')
      .set('Authorization', auth)
      .send({
        rows: [
          { name: 'Fine', url: 'https://1.1.1.1/', client: 'New client', intervalSec: 60 },
          { name: 'Bad', url: 'http://127.0.0.1/', client: '', intervalSec: 60 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.rows).toHaveLength(1);
    expect(await prisma.monitor.count()).toBe(0);
    expect(await prisma.client.count({ where: { name: 'New client' } })).toBe(0);
  });
});

describe('domains', () => {
  it('takes a date typed in by hand for registries without RDAP', async () => {
    const domain = await prisma.domain.create({
      data: { organizationId, domain: 'kettle.com.tr', error: 'No RDAP service' },
    });
    const res = await request(app)
      .patch(`/api/domains/${domain.id}`)
      .set({ Authorization: auth, 'X-Requested-With': 'northstar' })
      .send({ expiresAt: '2027-03-01' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'manual', error: null });

    const list = await request(app).get('/api/expirations').set('Authorization', auth);
    expect(list.body[0]).toMatchObject({ kind: 'domain', name: 'kettle.com.tr', source: 'manual' });
    expect(list.body[0].daysLeft).toBeGreaterThan(0);
  });
});
