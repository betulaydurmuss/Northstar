import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useCompleteSignIn } from '../../lib/auth';
import { AuthLayout } from './AuthLayout';

type LoginResponse =
  | { twoFactorRequired: true; challenge: string }
  | { accessToken: string; twoFactorSetupRequired: boolean };

function messageFor(err: unknown) {
  return err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.';
}

export function SignIn() {
  const completeSignIn = useCompleteSignIn();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      if ('twoFactorRequired' in res) setChallenge(res.challenge);
      else await completeSignIn(res.accessToken);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/2fa/verify', {
        method: 'POST',
        body: { challenge, code: form.get('code') },
      });
      await completeSignIn(res.accessToken);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <AuthLayout
        title="Two-factor authentication"
        subtitle="Enter the six-digit code from your authenticator app, or one of your backup codes."
        foot={
          <button className="btn btn-ghost" onClick={() => setChallenge(null)}>
            Use a different account
          </button>
        }
      >
        <form onSubmit={onCode}>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              name="code"
              className="input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to Northstar"
      subtitle="Every client site, watched from one place."
      foot={
        <>
          New here? <Link to="/sign-up">Create an account</Link>
        </>
      }
    >
      <form onSubmit={onPassword}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" style={{ fontSize: 'var(--text-sm)' }}>
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
