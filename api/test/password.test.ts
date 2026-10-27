import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../src/auth/password.js';

describe('passwordProblem', () => {
  it('accepts a long, unremarkable passphrase', () => {
    expect(passwordProblem('harbour-lights-at-dusk')).toBeNull();
  });

  it('refuses anything under twelve characters', () => {
    expect(passwordProblem('Short1!')).toMatch(/12 characters/);
  });

  it('refuses passwords from breach lists regardless of case', () => {
    expect(passwordProblem('Password1234')).toMatch(/common passwords/);
  });

  it('refuses passwords made of very few distinct characters', () => {
    expect(passwordProblem('abababababab')).toMatch(/variety/);
  });

  it('refuses passwords that contain the email name', () => {
    expect(passwordProblem('mira.okafor-2026', 'mira.okafor@brightline.studio')).toMatch(/email/);
  });
});
