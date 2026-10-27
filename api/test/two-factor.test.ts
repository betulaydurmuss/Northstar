import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { createUser, PASSWORD, post, resetDb, testApp, totpNow } from './helpers.js';

beforeEach(resetDb);

const app = testApp();

async function login(email = 'mira@brightline.studio') {
  return post(app, '/api/auth/login').send({ email, password: PASSWORD });
}

async function enrol(accessToken: string) {
  const setup = await post(app, '/api/auth/2fa/setup').set(
    'Authorization',
    `Bearer ${accessToken}`,
  );
  const enable = await post(app, '/api/auth/2fa/enable')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ code: await totpNow(setup.body.secret) });
  return { secret: setup.body.secret as string, enable };
}

describe('admin two-factor', () => {
  it('keeps an admin out of the admin api until two-factor is set up', async () => {
    await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
    const res = await login('ops@northstar.local');
    expect(res.body.twoFactorSetupRequired).toBe(true);

    const admin = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(admin.status).toBe(403);

    const { enable } = await enrol(res.body.accessToken);
    expect(enable.status).toBe(200);
    expect(enable.body.backupCodes).toHaveLength(10);

    const after = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${enable.body.accessToken}`);
    expect(after.status).toBe(200);
  });

  it('refuses the admin api to ordinary users', async () => {
    await createUser();
    const res = await login();
    const admin = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(admin.status).toBe(403);
  });

  it('does not let an admin switch two-factor off', async () => {
    await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
    const first = await login('ops@northstar.local');
    const { secret, enable } = await enrol(first.body.accessToken);

    const res = await post(app, '/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${enable.body.accessToken}`)
      .send({ password: PASSWORD, code: await totpNow(secret) });
    expect(res.status).toBe(403);
  });
});

describe('signing in with two-factor', () => {
  it('asks for a code after the password, then signs in', async () => {
    await createUser();
    const { secret } = await enrol((await login()).body.accessToken);

    const first = await login();
    expect(first.body).toEqual({ twoFactorRequired: true, challenge: expect.any(String) });
    expect(first.body.accessToken).toBeUndefined();

    const second = await post(app, '/api/auth/2fa/verify').send({
      challenge: first.body.challenge,
      code: await totpNow(secret),
    });
    expect(second.status).toBe(200);
    expect(second.body.accessToken).toEqual(expect.any(String));
  });

  it('accepts each backup code exactly once', async () => {
    await createUser();
    const { enable } = await enrol((await login()).body.accessToken);
    const code = enable.body.backupCodes[0] as string;

    const verify = async () =>
      post(app, '/api/auth/2fa/verify').send({ challenge: (await login()).body.challenge, code });

    expect((await verify()).status).toBe(200);
    expect((await verify()).status).toBe(401);
  });

  it('counts wrong codes towards the lockout', async () => {
    await createUser();
    await enrol((await login()).body.accessToken);
    const { challenge } = (await login()).body;

    await post(app, '/api/auth/2fa/verify').send({ challenge, code: '000000' });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.failedLogins).toBe(1);
  });

  it('keeps the TOTP secret encrypted in the database', async () => {
    await createUser();
    const { secret } = await enrol((await login()).body.accessToken);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.totpSecret).not.toContain(secret);
  });
});
