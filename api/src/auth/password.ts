import argon2 from 'argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

// argon2id with the library defaults (64 MiB, 3 passes): slow enough to make a leaked
// hash expensive to crack, fast enough that sign-in still feels instant.
export function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password).catch(() => false);
}

// A hash of a password nobody has, checked when the email is unknown so that a missing
// account takes as long to reject as a wrong password.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('northstar-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

export const MIN_PASSWORD_LENGTH = 12;

// Returns a sentence to show the person, or null when the password is acceptable.
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 256) return 'Use at most 256 characters.';

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'This password appears in lists of common passwords.';
  if (new Set(lower).size <= 3) return 'Use a password with more variety.';

  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return 'Do not include your email address in your password.';
  }
  return null;
}
