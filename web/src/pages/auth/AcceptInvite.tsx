import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useCompleteSignIn } from '../../lib/auth';
import { AuthLayout } from './AuthLayout';

export function AcceptInvite() {
  const { token = '' } = useParams();
  const completeSignIn = useCompleteSignIn();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<{ email: string; clientName: string }>(`/invites/${token}`),
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>(`/invites/${token}/accept`, {
        method: 'POST',
        body: { name: form.get('name'), password: form.get('password') },
      });
      await completeSignIn(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (invite.isPending) {
    return (
      <div className="auth">
        <div className="skeleton" style={{ width: 200, height: 14 }} />
      </div>
    );
  }
  if (invite.isError) {
    return (
      <AuthLayout
        title="This invitation has expired"
        subtitle="Invitations work once, for 72 hours. Ask for a new one."
        foot={<Link to="/sign-in">Sign in instead</Link>}
      >
        <p className="muted">If you already accepted it, sign in with the password you chose.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`See how ${invite.data.clientName}'s sites are doing`}
      subtitle={`Create your account for ${invite.data.email}.`}
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" autoComplete="name" required />
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
            At least 12 characters.
          </span>
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          Create account
        </button>
      </form>
    </AuthLayout>
  );
}
