import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { api, ApiError, setAccessToken } from '../../lib/api';
import { useMe, useSignOut, type Me } from '../../lib/auth';
import { describeDevice, timeAgo } from '../../lib/format';

type Setup = { secret: string; uri: string; qr: string };
type Session = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

function TwoFactor({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api<Setup>('/auth/2fa/setup', { method: 'POST' }),
    onSuccess: setSetup,
    onError: (err) => setError(err.message),
  });

  const enable = useMutation({
    mutationFn: (code: string) =>
      api<{ accessToken: string; backupCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { code },
      }),
    onSuccess: async (res) => {
      setAccessToken(res.accessToken);
      setBackupCodes(res.backupCodes);
      setSetup(null);
      qc.setQueryData(['me'], await api<Me>('/auth/me'));
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'),
  });

  function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    enable.mutate(String(new FormData(e.currentTarget).get('code')));
  }

  if (backupCodes) {
    return (
      <div className="card stack">
        <div className="row">
          <ShieldCheck size={20} color="var(--good)" aria-hidden="true" />
          <h3>Two-factor authentication is on</h3>
        </div>
        <p className="muted">
          Save these backup codes somewhere safe, such as a password manager. Each one signs you in
          once if you lose your phone. They will not be shown again.
        </p>
        <div
          className="mono"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 8,
            padding: 16,
            background: 'var(--raised)',
            borderRadius: 'var(--radius)',
          }}
        >
          {backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}
          >
            Copy codes
          </button>
          <button className="btn btn-primary" onClick={() => setBackupCodes(null)}>
            I have saved them
          </button>
        </div>
      </div>
    );
  }

  if (me.twoFactorEnabled) {
    return (
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <ShieldCheck size={20} color="var(--good)" aria-hidden="true" />
          <div>
            <h3>Two-factor authentication is on</h3>
            <p className="muted">Signing in asks for a code from your authenticator app.</p>
          </div>
        </div>
      </div>
    );
  }

  if (setup) {
    return (
      <div className="card stack">
        <h3>Scan this code with your authenticator app</h3>
        <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <img
            src={setup.qr}
            alt="QR code for your authenticator app"
            width={180}
            height={180}
            style={{ borderRadius: 'var(--radius)', background: '#fff' }}
          />
          <div className="stack" style={{ flex: 1, minWidth: 240 }}>
            <p className="muted">
              Google Authenticator, 1Password, Authy or any app that supports TOTP will work. If you
              cannot scan, enter this key by hand:
            </p>
            <code style={{ wordBreak: 'break-all' }}>{setup.secret}</code>
            <form onSubmit={onVerify} className="stack" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="code">Six-digit code from the app</label>
                <input
                  id="code"
                  name="code"
                  className="input mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  required
                  style={{ maxWidth: 200 }}
                />
              </div>
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              <div>
                <button className="btn btn-primary" type="submit" disabled={enable.isPending}>
                  Turn on two-factor
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="row">
        <ShieldAlert size={20} color="var(--warn)" aria-hidden="true" />
        <h3>Two-factor authentication is off</h3>
      </div>
      {me.role === 'super_admin' ? (
        // Admins are never enrolled from the browser; see api/src/auth/admin-totp.ts.
        <>
          <p className="muted">
            Admin accounts must use two-factor authentication, and it is set up on the server so
            that a password alone can never claim an admin account. Someone with access to the
            server runs:
          </p>
          <code className="card card-raised" style={{ padding: 12 }}>
            npm run admin:create -- {me.email}
          </code>
          <p className="muted">Then sign in again with the code from your authenticator app.</p>
        </>
      ) : (
        <>
          <p className="muted">
            Add a second step to signing in, so a leaked password alone is not enough.
          </p>
          {error && <ErrorState message={error} />}
          <div>
            <button
              className="btn btn-primary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Set up two-factor
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const signOut = useSignOut();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<Session[]>('/auth/sessions'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const revokeAll = useMutation({
    mutationFn: () => api('/auth/sessions/revoke-all', { method: 'POST' }),
    onSuccess: signOut,
  });

  if (sessions.isPending) return <Skeleton rows={2} height={56} />;
  if (sessions.isError) {
    return (
      <ErrorState message="Could not load your sessions." onRetry={() => sessions.refetch()} />
    );
  }
  if (sessions.data.length === 0) {
    return <EmptyState title="No active sessions" body="Sign in again to start a new session." />;
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Device</th>
            <th>IP address</th>
            <th>Last active</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sessions.data.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="row" style={{ gap: 8 }}>
                  <Laptop size={16} aria-hidden="true" className="muted" />
                  {describeDevice(s.userAgent)}
                  {s.current && <span className="badge badge-up">This device</span>}
                </span>
              </td>
              <td className="mono muted">{s.ip ?? 'unknown'}</td>
              <td className="muted">{timeAgo(s.lastUsedAt)}</td>
              <td style={{ textAlign: 'right' }}>
                {!s.current && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending}
                  >
                    Sign out
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
        <button
          className="btn btn-danger"
          onClick={() => revokeAll.mutate()}
          disabled={revokeAll.isPending}
        >
          <LogOut size={16} /> Sign out of every device
        </button>
      </div>
    </div>
  );
}

export function Security() {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p className="muted">How you sign in, and where you are signed in.</p>
        </div>
      </div>
      <div className="stack" style={{ gap: 32 }}>
        <section className="stack">
          <h2>Two-factor authentication</h2>
          <TwoFactor me={me} />
        </section>
        {!me.twoFactorSetupRequired && (
          <section className="stack">
            <h2>Sessions</h2>
            <Sessions />
          </section>
        )}
      </div>
    </>
  );
}
