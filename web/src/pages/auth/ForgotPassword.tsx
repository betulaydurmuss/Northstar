import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email: form.get('email') } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link that works for one hour."
      foot={<Link to="/sign-in">Back to sign in</Link>}
    >
      {sent ? (
        <p>If an account exists for that address, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit}>
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
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Send reset link
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
