import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { randomToken, sha256 } from '../crypto.js';
import { prisma } from '../db.js';
import { REFRESH_TOKEN_TTL_MS, signAccessToken } from './tokens.js';

export const REFRESH_COOKIE = 'ns_refresh';

// Scoped to the auth routes so the refresh token is never sent anywhere else.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 300) ?? null };
}

export async function startSession(user: User, req: Request, mfaVerified: boolean) {
  const refreshToken = randomToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      mfaVerified,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      ...clientInfo(req),
    },
  });
  const accessToken = await signAccessToken({
    sub: user.id,
    sid: session.id,
    role: user.role,
    mfa: mfaVerified,
  });
  return { accessToken, refreshToken };
}

// Two tabs refreshing at the same moment both present the same token; the slower one is
// refused but not treated as theft if it arrives within this window.
const REUSE_GRACE_MS = 10_000;

export type RotateResult =
  | { ok: true; accessToken: string; refreshToken: string; user: User }
  | { ok: false; reused: boolean };

export async function rotateSession(presented: string, req: Request): Promise<RotateResult> {
  const hash = sha256(presented);
  const now = new Date();
  const next = randomToken();

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: true },
  });

  if (session && !session.revokedAt && session.expiresAt > now) {
    // The where clause on the old hash makes this a compare-and-swap: if another request
    // rotated first, nothing is updated and this request falls through as a replay.
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash },
      data: {
        refreshTokenHash: sha256(next),
        previousTokenHash: hash,
        lastUsedAt: now,
        ...clientInfo(req),
      },
    });
    if (count === 1) {
      const accessToken = await signAccessToken({
        sub: session.userId,
        sid: session.id,
        role: session.user.role,
        mfa: session.mfaVerified,
      });
      return { ok: true, accessToken, refreshToken: next, user: session.user };
    }
  }

  const replayed = await prisma.session.findUnique({ where: { previousTokenHash: hash } });
  if (replayed && now.getTime() - replayed.lastUsedAt.getTime() > REUSE_GRACE_MS) {
    // A token that was already exchanged is being used again: someone else has a copy.
    // Every session of that account is closed so the thief and the owner both sign in again.
    await revokeAllSessions(replayed.userId);
    return { ok: false, reused: true };
  }
  return { ok: false, reused: false };
}

export function revokeAllSessions(userId: string) {
  return prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeByRefreshToken(token: string) {
  await prisma.session.updateMany({
    where: { refreshTokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
