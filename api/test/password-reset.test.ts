import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { sent } from '../src/mail.js';
import { createUser, PASSWORD, post, resetDb, testApp } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

const app = testApp();

function tokenFromLastEmail() {
  const match = sent.at(-1)?.text.match(/token=([\w-]+)/);
  return match?.[1];
}

describe('password reset', () => {
  it('answers the same way for known and unknown emails', async () => {
    await createUser();
    const known = await post(app, '/api/auth/forgot-password').send({
      email: 'mira@brightline.studio',
    });
    const unknown = await post(app, '/api/auth/forgot-password').send({
      email: 'nobody@brightline.studio',
    });
    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(sent).toHaveLength(1);
  });

  it('sets a new password and signs out every session', async () => {
    await createUser();
    await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: PASSWORD,
    });
    await post(app, '/api/auth/forgot-password').send({ email: 'mira@brightline.studio' });

    const res = await post(app, '/api/auth/reset-password').send({
      token: tokenFromLastEmail(),
      password: 'quiet-tide-over-the-harbour',
    });
    expect(res.status).toBe(204);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);

    const login = await post(app, '/api/auth/login').send({
      email: 'mira@brightline.studio',
      password: 'quiet-tide-over-the-harbour',
    });
    expect(login.status).toBe(200);
  });

  it('works only once per link', async () => {
    await createUser();
    await post(app, '/api/auth/forgot-password').send({ email: 'mira@brightline.studio' });
    const token = tokenFromLastEmail();

    await post(app, '/api/auth/reset-password').send({
      token,
      password: 'quiet-tide-over-the-harbour',
    });
    const again = await post(app, '/api/auth/reset-password').send({
      token,
      password: 'another-calm-evening-sky',
    });
    expect(again.status).toBe(400);
  });
});
