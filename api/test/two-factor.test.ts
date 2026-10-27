import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAdminTotp } from '../src/auth/admin-totp.js';
import { MAX_FAILED_SIGN_INS } from '../src/auth/router.js';
import { prisma } from '../src/db.js';
import { createUser, PASSWORD, post, resetDb, testApp, totpNext, totpNow } from './helpers.js';

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
  it('cannot be set up from the browser, even with the right password', async () => {
    await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
    const res = await login('ops@northstar.local');
    expect(res.body.twoFactorSetupRequired).toBe(true);
    const auth = `Bearer ${res.body.accessToken as string}`;

    expect((await request(app).get('/api/admin/overview').set('Authorization', auth)).status).toBe(
      403,
    );
    // Whoever learns a new admin's password cannot bind their own phone to it.
    expect((await post(app, '/api/auth/2fa/setup').set('Authorization', auth)).status).toBe(403);
    expect(
      (await post(app, '/api/auth/2fa/enable').set('Authorization', auth).send({ code: '123456' }))
        .status,
    ).toBe(403);
  });

  it('works once provisioned on the server', async () => {
    const admin = await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
    const { secret, backupCodes } = await provisionAdminTotp(admin.id);
    expect(backupCodes).toHaveLength(10);

    const first = await login('ops@northstar.local');
    expect(first.body.twoFactorRequired).toBe(true);
    const second = await post(app, '/api/auth/2fa/verify').send({
      challenge: first.body.challenge,
      code: await totpNow(secret),
    });
    const after = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${second.body.accessToken as string}`);
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
    const admin = await createUser({ email: 'ops@northstar.local', role: 'super_admin' });
    const { secret } = await provisionAdminTotp(admin.id);
    const first = await login('ops@northstar.local');
    const signedIn = await post(app, '/api/auth/2fa/verify').send({
      challenge: first.body.challenge,
      code: await totpNow(secret),
    });

    const res = await post(app, '/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
      .send({ password: PASSWORD, code: await totpNext(secret) });
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

    // A fresh code: the one used to enrol has been spent.
    const second = await post(app, '/api/auth/2fa/verify').send({
      challenge: first.body.challenge,
      code: await totpNext(secret),
    });
    expect(second.status).toBe(200);
    expect(second.body.accessToken).toEqual(expect.any(String));
  });

  it('refuses a code that was already used', async () => {
    await createUser();
    const { secret } = await enrol((await login()).body.accessToken);
    const code = await totpNext(secret);

    const once = await post(app, '/api/auth/2fa/verify').send({
      challenge: (await login()).body.challenge,
      code,
    });
    expect(once.status).toBe(200);
    const replay = await post(app, '/api/auth/2fa/verify').send({
      challenge: (await login()).body.challenge,
      code,
    });
    expect(replay.status).toBe(401);
  });

  it('accepts each backup code exactly once, even when sent twice at the same moment', async () => {
    await createUser();
    const { enable } = await enrol((await login()).body.accessToken);
    const code = enable.body.backupCodes[0] as string;
    const challenges = [(await login()).body.challenge, (await login()).body.challenge];

    const results = await Promise.all(
      challenges.map((challenge) => post(app, '/api/auth/2fa/verify').send({ challenge, code })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('keeps two different backup codes both spent when used together', async () => {
    await createUser();
    const { enable } = await enrol((await login()).body.accessToken);
    const [a, b] = enable.body.backupCodes as string[];
    await Promise.all(
      [a, b].map(async (code) =>
        post(app, '/api/auth/2fa/verify').send({ challenge: (await login()).body.challenge, code }),
      ),
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.backupCodes).toHaveLength(8);
  });

  it('locks the account after five wrong codes, however fast they arrive', async () => {
    await createUser();
    await enrol((await login()).body.accessToken);
    const { challenge } = (await login()).body;

    await Promise.all(
      Array.from({ length: MAX_FAILED_SIGN_INS + 3 }, () =>
        post(app, '/api/auth/2fa/verify').send({ challenge, code: '000000' }),
      ),
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'mira@brightline.studio' },
    });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
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
