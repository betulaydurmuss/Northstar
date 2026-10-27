import { generateSecret, generateURI, verify } from 'otplib';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../crypto.js';

export function newTotpSecret() {
  return generateSecret();
}

export function totpUri(email: string, secret: string) {
  return generateURI({ issuer: 'Northstar', label: email, secret });
}

// Accept the previous and next 30-second step as well, for phones whose clocks drift.
// Returns the start of the time step the code belongs to, or null when it is wrong, so
// the caller can refuse a code for a step that was already used.
export async function checkTotp(secret: string, code: string): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  // The functional verify is typed for HOTP too, which has no epoch; TOTP always sets it.
  return result.valid && 'epoch' in result ? result.epoch : null;
}

// Ten codes like "k7qp-2mxd-9tfa", shown once and stored only as hashes.
export function newBackupCodes() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export function normaliseBackupCode(code: string) {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}

export function hashBackupCode(code: string) {
  return sha256(normaliseBackupCode(code));
}
