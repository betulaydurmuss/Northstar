import { generate } from 'otplib';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/db.js';

export const PASSWORD = 'harbour-lights-at-dusk';

// Generous limits so lockout tests are not cut short by the rate limiter.
export function testApp(limits = { perIp: 1000, perAccount: 1000 }) {
  return createApp({ authLimits: limits });
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, password_reset_tokens, monitors, audit_logs RESTART IDENTITY CASCADE',
  );
}

export async function createUser(
  overrides: { email?: string; role?: 'user' | 'super_admin' } = {},
) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? 'mira@brightline.studio',
      name: 'Mira Okafor',
      role: overrides.role ?? 'user',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

// Every state-changing request from the web app carries this header.
export function post(app: ReturnType<typeof createApp>, path: string) {
  return request(app).post(path).set('X-Requested-With', 'northstar');
}

export function refreshCookie(res: request.Response) {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('ns_refresh='));
  return cookie?.split(';')[0];
}

export function totpNow(secret: string) {
  return generate({ secret });
}
