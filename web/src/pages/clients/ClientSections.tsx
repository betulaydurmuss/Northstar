import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, Mail, Trash2, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api, ApiError } from '../../lib/api';

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong.';
const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function StatusPageCard({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const page = useQuery({
    queryKey: ['status-page', clientId],
    queryFn: () =>
      api<{ slug: string; isPublic: boolean } | null>(`/status-pages/by-client/${clientId}`),
  });
  return (
    <section className="card row" style={{ justifyContent: 'space-between' }}>
      <div className="row" style={{ gap: 12 }}>
        <Globe size={20} className="muted" aria-hidden="true" />
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Status page</h2>
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {page.data
              ? page.data.isPublic
                ? `Public at /status/${page.data.slug}`
                : 'Saved, but hidden from the public'
              : 'Not published yet'}
          </p>
        </div>
      </div>
      <div className="row">
        {page.data?.isPublic && (
          <a className="btn" href={`/status/${page.data.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open
          </a>
        )}
        {canEdit && (
          <Link className="btn btn-primary" to={`/clients/${clientId}/status-page`}>
            {page.data ? 'Edit page' : 'Create page'}
          </Link>
        )}
      </div>
    </section>
  );
}

type Window = { id: string; startsAt: string; endsAt: string; message: string };

// <input type="datetime-local"> speaks local time without a zone; turn it into an instant.
const localToIso = (value: string) => new Date(value).toISOString();

export function Maintenance({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const windows = useQuery({
    queryKey: ['maintenance', clientId],
    queryFn: () => api<Window[]>(`/maintenance-windows?clientId=${clientId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['maintenance', clientId] });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: object) => api('/maintenance-windows', { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      return refresh();
    },
    onError: (err) => {
      const details =
        err instanceof ApiError ? (err.details as { message: string }[] | undefined) : undefined;
      setError(details?.[0]?.message ?? messageOf(err));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/maintenance-windows/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      clientId,
      startsAt: localToIso(String(form.get('startsAt'))),
      endsAt: localToIso(String(form.get('endsAt'))),
      message: form.get('message'),
    });
    e.currentTarget.reset();
  }

  const now = Date.now();
  return (
    <section className="card stack">
      <div className="row" style={{ gap: 10 }}>
        <Wrench size={18} className="muted" aria-hidden="true" />
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Planned maintenance</h2>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        During a window, checks keep running but nobody is alerted, the status page says so, and the
        time is left out of the monthly uptime figure.
      </p>
      {windows.isPending ? (
        <Skeleton rows={2} height={36} />
      ) : windows.isError ? (
        <ErrorState message="Could not load maintenance windows." />
      ) : windows.data.length === 0 ? (
        <p className="muted">No maintenance planned.</p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
          {windows.data.map((w) => {
            const state =
              new Date(w.endsAt).getTime() < now
                ? { status: 'paused' as const, label: 'Finished' }
                : new Date(w.startsAt).getTime() <= now
                  ? { status: 'maintenance' as const, label: 'In progress' }
                  : { status: 'pending' as const, label: 'Scheduled' };
            return (
              <li key={w.id} className="row" style={{ justifyContent: 'space-between' }}>
                <div className="stack" style={{ gap: 2 }}>
                  <span>{w.message}</span>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {when.format(new Date(w.startsAt))} – {when.format(new Date(w.endsAt))}
                  </span>
                </div>
                <div className="row">
                  <StatusBadge status={state.status} label={state.label} />
                  {canEdit && (
                    <button
                      className="btn btn-ghost"
                      aria-label={`Delete maintenance: ${w.message}`}
                      onClick={() => remove.mutate(w.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="mw-start">Starts</label>
            <input id="mw-start" name="startsAt" type="datetime-local" className="input" required />
          </div>
          <div className="field">
            <label htmlFor="mw-end">Ends</label>
            <input id="mw-end" name="endsAt" type="datetime-local" className="input" required />
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="mw-message">What is happening</label>
            <input
              id="mw-message"
              name="message"
              className="input"
              placeholder="Moving to a faster server"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={create.isPending}>
            Plan window
          </button>
          {error && (
            <span className="field-error" style={{ flexBasis: '100%' }}>
              {error}
            </span>
          )}
        </form>
      )}
    </section>
  );
}

export function Invite({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (email: string) =>
      api<{ email: string }>(`/clients/${clientId}/invite`, { method: 'POST', body: { email } }),
    onSuccess: (res) => setSentTo(res.email),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    invite.mutate(String(new FormData(e.currentTarget).get('email')));
    e.currentTarget.reset();
  }

  return (
    <section className="card stack">
      <div className="row" style={{ gap: 10 }}>
        <Mail size={18} className="muted" aria-hidden="true" />
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Give {clientName} their own sign-in</h2>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        They see only this client&apos;s sites, incidents and reports, and cannot change anything.
        The invitation link works once, for 72 hours.
      </p>
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor="invite-email">Their email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            className="input"
            placeholder="owner@harborpine.coffee"
            required
          />
        </div>
        <button className="btn" type="submit" disabled={invite.isPending}>
          Send invitation
        </button>
      </form>
      {sentTo && !invite.isError && <span className="muted">Invitation sent to {sentTo}.</span>}
      {invite.isError && <ErrorState message={messageOf(invite.error)} />}
    </section>
  );
}
