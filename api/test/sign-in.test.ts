import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_SIGN_INS } from '../src/auth/router.js';
import { prisma } from '../src/db.js';
import { createUser, PASSWORD, post, refreshCookie, resetDb, testApp } from './helpers.js';

beforeEach(resetDb);

describe('sign-up', () => {
  it('creates an account and signs it in', async () => {
    const res = await post(testApp(), '/api/auth/register').send({
      name: 'Brightline Studio',
      email: 'Mira@Brightline.Studio',
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'mira@brightline.studio', role: 'user' });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeDefined();
  });

  it('stores an argon2id hash, never the password', async () => {
    await post(testApp(), '/api/auth/register').send({
      name: 'Brightline Studio',
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('refuses a common password', async () => {
    const res = await post(testApp(), '/api/auth/register').send({
      name: 'Brightline Studio',
      email: 'mira@brightline.studio',
      password: 'password1234',
    });
    expect(res.status).toBe(400);
  });
});

describe('sign-in', () => {
  it('signs in with the right password', async () => {
    await createUser();
    const res = await post(testApp(), '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    expect(res.status).toBe(200);

    const me = await request(testApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.email).toBe('mira@brightline.studio');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    await createUser();
    const app = testApp();
    const unknown = await post(app, '/api/auth/login').send({
      email: 'nobody@brightline.studio',
      password: PASSWORD,
    });
    const wrong = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: 'not-the-right-password',
    });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({ error: 'Invalid email or password' });
  });

  it(`locks the account after ${MAX_FAILED_SIGN_INS} failed attempts`, async () => {
    await createUser();
    const app = testApp();
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) {
      await post(app, '/api/auth/login').send({
        email: 'mira@brightline.studio',
        password: 'not-the-right-password',
      });
    }

    const res = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('opens again once the lock has expired', async () => {
    await createUser();
    await prisma.user.update({
      where: { email: 'mira@brightline.studio' },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const res = await post(testApp(), '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  it('rate limits attempts against one account', async () => {
    await createUser();
    const app = testApp({ perIp: 1000, perAccount: 3 });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await post(app, '/api/auth/login').send({
        email: 'mira@brightline.studio',
        password: 'not-the-right-password',
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('refuses state-changing requests without the CSRF header', async () => {
    const res = await request(testApp())
      .post('/api/auth/login')
      .send({ email: 'mira@brightline.studio', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('sets the refresh cookie httpOnly, Secure and SameSite=Strict', async () => {
    await createUser();
    const res = await post(testApp(), '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/SameSite=Strict/);
  });
});

describe('refresh tokens', () => {
  async function signIn(app: ReturnType<typeof testApp>) {
    await createUser();
    const res = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    return refreshCookie(res)!;
  }

  it('issues a new refresh token on every use', async () => {
    const app = testApp();
    const first = await signIn(app);

    const res = await post(app, '/api/auth/refresh').set('Cookie', first);
    expect(res.status).toBe(200);
    const second = refreshCookie(res)!;
    expect(second).not.toBe(first);

    expect((await post(app, '/api/auth/refresh').set('Cookie', second)).status).toBe(200);
  });

  it('closes every session when an old refresh token is replayed', async () => {
    const app = testApp();
    const stolen = await signIn(app);
    const res = await post(app, '/api/auth/refresh').set('Cookie', stolen);
    const current = refreshCookie(res)!;

    // Move the rotation outside the grace window meant for two tabs refreshing together.
    await prisma.session.updateMany({ data: { lastUsedAt: new Date(Date.now() - 60_000) } });

    expect((await post(app, '/api/auth/refresh').set('Cookie', stolen)).status).toBe(401);
    // The legitimate holder is signed out too: there is no telling who is who.
    expect((await post(app, '/api/auth/refresh').set('Cookie', current)).status).toBe(401);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('cannot be used after signing out', async () => {
    const app = testApp();
    const cookie = await signIn(app);
    expect((await post(app, '/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await post(app, '/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('sessions', () => {
  it('lists sessions and signs out everywhere', async () => {
    await createUser();
    const app = testApp();
    const login = () =>
      post(app, '/api/auth/login')
        .set('User-Agent', 'Firefox on Linux')
        .send({ email: 'mira@brightline.studio', password: PASSWORD });
    const a = await login();
    await login();

    const list = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${a.body.accessToken}`);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const out = await post(app, '/api/auth/sessions/revoke-all').set(
      'Authorization',
      `Bearer ${a.body.accessToken}`,
    );
    expect(out.status).toBe(204);

    // The access token dies with its session, without waiting for it to expire.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${a.body.accessToken}`);
    expect(me.status).toBe(401);
  });
});
