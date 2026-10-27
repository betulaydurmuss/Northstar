import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { verifyAccessToken, type AccessClaims } from './tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; sessionId: string; role: AccessClaims['role']; mfa: boolean };
  }
}

type Options = {
  // Lets an admin who has not finished two-factor setup reach the setup routes, and nothing else.
  allowPendingMfa?: boolean;
};

export function requireAuth(options: Options = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? await verifyAccessToken(token) : null;
    if (!claims) throw new HttpError(401, 'Sign in to continue');

    // Access tokens are short-lived, but "sign out everywhere" should still take effect
    // at once, so the session behind the token is checked on every request.
    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new HttpError(401, 'Sign in to continue');
    }

    if (claims.role === 'super_admin' && !claims.mfa && !options.allowPendingMfa) {
      throw new HttpError(403, 'Set up two-factor authentication to continue');
    }

    req.auth = { userId: claims.sub, sessionId: claims.sid, role: claims.role, mfa: claims.mfa };
    next();
  };
}

// The admin guard stands on its own so no admin route can forget a check.
export const requireAdmin: RequestHandler[] = [
  requireAuth(),
  (req, _res, next) => {
    if (req.auth?.role !== 'super_admin' || !req.auth.mfa) {
      throw new HttpError(403, 'Forbidden');
    }
    next();
  },
];
