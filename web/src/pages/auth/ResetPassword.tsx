import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get('password') !== form.get('confirm')) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password: form.get('password') },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="This link is incomplete"
        subtitle="Open the link from the email again, or ask for a new one."
        foot={<Link to="/forgot-password">Ask for a new link</Link>}
      >
        <p className="muted">The reset link is missing its token.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Every device signed in to your account will be signed out."
      foot={<Link to="/sign-in">Back to sign in</Link>}
    >
      {done ? (
        <div className="stack">
          <p>Your password has been changed.</p>
          <Link className="btn btn-primary btn-block" to="/sign-in">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Repeat it</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              required
            />
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Set new password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
