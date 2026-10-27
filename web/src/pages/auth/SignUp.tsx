import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useCompleteSignIn } from '../../lib/auth';
import { AuthLayout } from './AuthLayout';

export function SignUp() {
  const completeSignIn = useCompleteSignIn();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/register', {
        method: 'POST',
        body: {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
        },
      });
      await completeSignIn(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your agency account"
      subtitle="Add your clients, then their sites. It takes a minute."
      foot={
        <>
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="name">Agency name</label>
          <input id="name" name="name" className="input" autoComplete="organization" required />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
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
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            At least 12 characters. A short sentence works well.
          </span>
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
