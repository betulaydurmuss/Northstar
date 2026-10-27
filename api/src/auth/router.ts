import type { User } from '@prisma/client';
import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { decrypt, encrypt, randomToken, sha256 } from '../crypto.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { sendMail } from '../mail.js';
import { requireAuth } from './middleware.js';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './password.js';
import { authLimiters, type AuthLimits } from './rate-limit.js';
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  revokeAllSessions,
  revokeByRefreshToken,
  rotateSession,
  setRefreshCookie,
  startSession,
} from './sessions.js';
import { signAccessToken, signChallenge, verifyChallenge } from './tokens.js';
import { checkTotp, hashBackupCode, newBackupCodes, newTotpSecret, totpUri } from './totp.js';

export const MAX_FAILED_SIGN_INS = 5;
export const LOCK_MINUTES = 15;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// One message for every way a sign-in can fail, so the response never reveals whether
// an account exists, is locked, or just had the wrong password.
const INVALID = 'Invalid email or password';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    twoFactorEnabled: u.totpEnabled,
  };
}

async function recordFailure(user: User) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: { increment: 1 } },
  });
  if (updated.failedLogins >= MAX_FAILED_SIGN_INS) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
    });
  }
}

function isLocked(user: User) {
  return user.lockedUntil !== null && user.lockedUntil > new Date();
}

async function signedIn(req: Request, user: User, mfaVerified: boolean) {
  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }
  return startSession(user, req, mfaVerified);
}

// A six-digit code from the app, or one of the ten backup codes, which is then spent.
async function checkSecondFactor(user: User, code: string) {
  if (!user.totpSecret) return false;
  if (await checkTotp(decrypt(user.totpSecret), code.replace(/\s/g, ''))) return true;

  const hash = hashBackupCode(code);
  if (!user.backupCodes.includes(hash)) return false;
  await prisma.user.update({
    where: { id: user.id },
    data: { backupCodes: user.backupCodes.filter((h) => h !== hash) },
  });
  return true;
}

export function authRouter(limits: AuthLimits) {
  const router = Router();
  const { perIp, perAccount } = authLimiters(limits);

  router.post('/register', perIp, async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120), email, password: z.string() })
      .parse(req.body);

    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new HttpError(400, problem);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    // Signing up creates the agency too, with this person as its first admin.
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        membership: {
          create: { role: 'agency_admin', organization: { create: { name: body.name } } },
        },
      },
    });
    const { accessToken, refreshToken } = await startSession(user, req, false);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ accessToken, user: publicUser(user) });
  });

  router.post('/login', perIp, perAccount, async (req, res) => {
    const body = z.object({ email, password: z.string().max(256) }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, INVALID);
    }
    if (isLocked(user)) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, INVALID);
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      await recordFailure(user);
      throw new HttpError(401, INVALID);
    }

    if (user.totpEnabled) {
      res.json({ twoFactorRequired: true, challenge: await signChallenge(user.id) });
      return;
    }

    const { accessToken, refreshToken } = await signedIn(req, user, false);
    setRefreshCookie(res, refreshToken);
    res.json({
      accessToken,
      user: publicUser(user),
      // Admins must enrol before anything else works; the web app routes them to setup.
      twoFactorSetupRequired: user.role === 'super_admin',
    });
  });

  router.post('/2fa/verify', perIp, async (req, res) => {
    const body = z
      .object({ challenge: z.string(), code: z.string().min(6).max(20) })
      .parse(req.body);

    const userId = await verifyChallenge(body.challenge);
    const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user || !user.totpEnabled || isLocked(user)) {
      throw new HttpError(401, 'Invalid code');
    }
    if (!(await checkSecondFactor(user, body.code))) {
      await recordFailure(user);
      throw new HttpError(401, 'Invalid code');
    }

    const { accessToken, refreshToken } = await signedIn(req, user, true);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, user: publicUser(user) });
  });

  router.post('/refresh', async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string') throw new HttpError(401, 'Sign in to continue');

    const result = await rotateSession(token, req);
    if (!result.ok) {
      clearRefreshCookie(res);
      throw new HttpError(401, 'Sign in to continue');
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken, user: publicUser(result.user) });
  });

  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string') await revokeByRefreshToken(token);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.userId },
      include: {
        membership: {
          select: {
            role: true,
            organization: { select: { id: true, name: true } },
            client: { select: { id: true, name: true } },
          },
        },
      },
    });
    res.json({
      ...publicUser(user),
      twoFactorSetupRequired: user.role === 'super_admin' && !req.auth!.mfa,
      membership: user.membership,
    });
  });

  router.post('/forgot-password', perIp, async (req, res) => {
    const body = z.object({ email }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (user) {
      const token = randomToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const link = `${config.WEB_ORIGIN}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your Northstar password',
        text: `Someone asked to reset the password for ${user.email}.\n\nTo choose a new password, open this link within the next hour:\n${link}\n\nIf this was not you, you can ignore this email. Your password has not changed.`,
      });
    }
    // The same answer whether or not the account exists.
    res.status(204).end();
  });

  router.post('/reset-password', perIp, async (req, res) => {
    const body = z.object({ token: z.string().min(10), password: z.string() }).parse(req.body);

    const reset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(body.token) },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new HttpError(400, 'This reset link has expired. Ask for a new one.');
    }
    const problem = passwordProblem(body.password, reset.user.email);
    if (problem) throw new HttpError(400, problem);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await hashPassword(body.password),
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);
    // Whoever knew the old password is signed out everywhere.
    await revokeAllSessions(reset.userId);
    res.status(204).end();
  });

  // Two-factor enrolment: setup stores a pending secret, enable proves the app has it.
  router.post('/2fa/setup', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is already on');

    const secret = newTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret) } });
    const uri = totpUri(user.email, secret);
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  });

  router.post('/2fa/enable', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    const body = z.object({ code: z.string() }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (user.totpEnabled) throw new HttpError(409, 'Two-factor authentication is already on');
    if (!user.totpSecret || !(await checkTotp(decrypt(user.totpSecret), body.code.trim()))) {
      throw new HttpError(
        400,
        'That code did not match. Check the time on your phone and try again.',
      );
    }

    const codes = newBackupCodes();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: true, backupCodes: codes.map(hashBackupCode) },
      }),
      prisma.session.update({ where: { id: req.auth!.sessionId }, data: { mfaVerified: true } }),
    ]);
    // The current session has now passed the second factor, so it gets a token that says so.
    const accessToken = await signAccessToken({
      sub: user.id,
      sid: req.auth!.sessionId,
      role: user.role,
      mfa: true,
    });
    res.json({ accessToken, backupCodes: codes });
  });

  router.post('/2fa/disable', requireAuth(), async (req, res) => {
    const body = z.object({ password: z.string(), code: z.string() }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (user.role === 'super_admin') {
      throw new HttpError(403, 'Admins cannot turn off two-factor authentication');
    }
    if (
      !user.totpEnabled ||
      !(await verifyPassword(user.passwordHash, body.password)) ||
      !(await checkSecondFactor(user, body.code))
    ) {
      throw new HttpError(400, 'Password or code is incorrect');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
    });
    res.status(204).end();
  });

  router.get('/sessions', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
    });
    res.json(sessions.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })));
  });

  router.delete('/sessions/:id', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'Session not found');
    // Scoped to the caller's own sessions: another user's id simply matches nothing.
    const { count } = await prisma.session.updateMany({
      where: { id: id.data, userId: req.auth!.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new HttpError(404, 'Session not found');
    res.status(204).end();
  });

  router.post('/sessions/revoke-all', requireAuth({ allowPendingMfa: true }), async (req, res) => {
    await revokeAllSessions(req.auth!.userId);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  return router;
}
