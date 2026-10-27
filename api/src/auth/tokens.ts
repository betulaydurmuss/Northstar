import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const issuer = 'northstar';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AccessClaims = {
  sub: string;
  sid: string;
  role: 'user' | 'super_admin';
  // Whether this session passed the second factor. Admin routes require it.
  mfa: boolean;
};

export function signAccessToken(claims: AccessClaims) {
  return new SignJWT({ sid: claims.sid, role: claims.role, mfa: claims.mfa, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer, algorithms: ['HS256'] });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      sid: String(payload.sid),
      role: payload.role === 'super_admin' ? 'super_admin' : 'user',
      mfa: payload.mfa === true,
    };
  } catch {
    return null;
  }
}

// Issued after a correct password when the account has two-factor on. It proves only
// that the first factor passed, lasts five minutes, and cannot be used as an access token.
export function signChallenge(userId: string) {
  return new SignJWT({ typ: 'challenge' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

export async function verifyChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer, algorithms: ['HS256'] });
    return payload.typ === 'challenge' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
