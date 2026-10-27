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
    'TRUNCATE users, organizations, sessions, password_reset_tokens, monitors, check_results_hourly, domains, expiry_notices, audit_logs RESTART IDENTITY CASCADE',
  );
}

// By default each user runs their own agency. Pass `agency` to add them to an existing one,
// and `clientId` (with role client_viewer) to make them a client's viewer.
export async function createUser(
  overrides: {
    email?: string;
    role?: 'user' | 'super_admin';
    agency?: string;
    membership?: 'agency_admin' | 'client_viewer';
    clientId?: string;
  } = {},
) {
  const email = overrides.email ?? 'mira@brightline.studio';
  return prisma.user.create({
    data: {
      email,
      name: 'Mira Okafor',
      role: overrides.role ?? 'user',
      passwordHash: await hashPassword(PASSWORD),
      membership: {
        create: {
          role: overrides.membership ?? 'agency_admin',
          clientId: overrides.clientId ?? null,
          organizationId: overrides.agency
            ? overrides.agency
            : (await prisma.organization.create({ data: { name: `${email} agency` } })).id,
        },
      },
    },
    include: { membership: true },
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
