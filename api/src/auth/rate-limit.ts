import { rateLimit } from 'express-rate-limit';

export type AuthLimits = {
  // Sign-in attempts per minute from one IP address.
  perIp: number;
  // Sign-in attempts per minute against one account, from anywhere.
  perAccount: number;
};

export const defaultAuthLimits: AuthLimits = { perIp: 20, perAccount: 5 };

const tooMany = { error: 'Too many attempts. Wait a minute and try again.' };

export function authLimiters(limits: AuthLimits) {
  const perIp = rateLimit({
    windowMs: 60_000,
    limit: limits.perIp,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooMany,
  });

  // Keyed on the email in the body, so spreading attempts across many IPs does not help.
  const perAccount = rateLimit({
    windowMs: 60_000,
    limit: limits.perAccount,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: tooMany,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `account:${email}`;
    },
  });

  return { perIp, perAccount };
}
