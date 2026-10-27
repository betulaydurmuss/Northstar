import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { sniffImage, svgProblem } from '../src/files.js';
import { createUser, PASSWORD, post, resetDb } from './helpers.js';

const noScheduler = { schedule: async () => undefined, unschedule: async () => undefined };
const app = createApp({ authLimits: { perIp: 1000, perAccount: 1000 }, scheduler: noScheduler });

let auth: string;

beforeEach(async () => {
  await resetDb();
  await createUser();
  const res = await post(app, '/api/auth/login').send({
    email: 'mira@brightline.studio',
    password: PASSWORD,
  });
  auth = `Bearer ${res.body.accessToken as string}`;
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>',
);

describe('clients', () => {
  it('creates, renames and lists clients with their summary', async () => {
    const created = await post(app, '/api/clients')
      .set('Authorization', auth)
      .send({ name: 'Harbor & Pine Coffee', brandColor: '#2F7D5B', contactEmail: '' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      brandColor: '#2F7D5B',
      contactEmail: null,
      logoUrl: null,
    });

    const renamed = await request(app)
      .patch(`/api/clients/${created.body.id}`)
      .set({ Authorization: auth, 'X-Requested-With': 'northstar' })
      .send({ name: 'Harbor and Pine' });
    expect(renamed.body.name).toBe('Harbor and Pine');

    const list = await request(app).get('/api/clients').set('Authorization', auth);
    expect(list.body[0]).toMatchObject({ name: 'Harbor and Pine', monitors: 0, down: 0 });
  });

  it('refuses a second client with the same name', async () => {
    await post(app, '/api/clients').set('Authorization', auth).send({ name: 'Sable Architects' });
    const again = await post(app, '/api/clients')
      .set('Authorization', auth)
      .send({ name: 'Sable Architects' });
    expect(again.status).toBe(409);
  });

  it('refuses a colour that is not a hex code', async () => {
    const res = await post(app, '/api/clients')
      .set('Authorization', auth)
      .send({ name: 'Lumen Yoga', brandColor: 'orange' });
    expect(res.status).toBe(400);
  });
});

describe('client logos', () => {
  async function client() {
    const res = await post(app, '/api/clients').set('Authorization', auth).send({ name: 'Kettle' });
    return res.body.id as string;
  }

  it('accepts a PNG and serves it with locked-down headers', async () => {
    const id = await client();
    const res = await post(app, `/api/clients/${id}/logo`)
      .set('Authorization', auth)
      .attach('logo', PNG, 'logo.png');
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/api\/files\/logos\/.+\.png$/);

    const file = await request(app).get(res.body.logoUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('accepts a clean SVG', async () => {
    const id = await client();
    const res = await post(app, `/api/clients/${id}/logo`)
      .set('Authorization', auth)
      .attach('logo', SVG, 'logo.svg');
    expect(res.status).toBe(200);
  });

  it('refuses an SVG carrying script', async () => {
    const id = await client();
    const res = await post(app, `/api/clients/${id}/logo`)
      .set('Authorization', auth)
      .attach('logo', Buffer.from('<svg><script>alert(1)</script></svg>'), 'logo.svg');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SVG logos cannot contain scripts');
  });

  it('judges the bytes, not the file name', async () => {
    const id = await client();
    const res = await post(app, `/api/clients/${id}/logo`)
      .set('Authorization', auth)
      .attach('logo', Buffer.from('MZ\x90\x00 not an image'), 'logo.png');
    expect(res.status).toBe(400);
  });

  it('refuses files over 1 MB', async () => {
    const id = await client();
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    const res = await post(app, `/api/clients/${id}/logo`)
      .set('Authorization', auth)
      .attach('logo', big, 'logo.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Logos must be 1 MB or smaller');
  });

  it('serves nothing for made-up file names', async () => {
    expect((await request(app).get('/api/files/logos/..%2F..%2F.env')).status).toBe(404);
  });
});

describe('sniffImage and svgProblem', () => {
  it('recognises formats by their first bytes', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg></svg>'))).toBe('svg');
    expect(sniffImage(Buffer.from('<html><svg></svg></html>'))).toBeNull();
  });

  it.each([
    ['a handler after a slash', '<svg><g/onload="alert(1)"/></svg>'],
    ['an encoded javascript: link', '<svg><a href="jav&#x61;script:alert(1)"/></svg>'],
    ['an external reference', '<svg><use href="https://evil.example/x.svg#a"/></svg>'],
    ['an external xlink', '<svg><image xlink:href="//evil.example/p.png"/></svg>'],
    ['a CSS url()', '<svg><rect style="fill:url(https://evil.example/t)"/></svg>'],
    ['an entity', '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'],
  ])('refuses %s', (_label, svg) => {
    expect(svgProblem(svg)).not.toBeNull();
  });

  it('still accepts links inside the file, such as gradients', () => {
    const svg =
      '<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>';
    expect(svgProblem(svg)).toBeNull();
  });

  it('flags event handlers and embedded HTML', () => {
    expect(svgProblem('<svg onload="x()"></svg>')).not.toBeNull();
    expect(svgProblem('<svg><foreignObject></foreignObject></svg>')).not.toBeNull();
    expect(svgProblem('<svg><a href="javascript:x()"/></svg>')).not.toBeNull();
  });
});
