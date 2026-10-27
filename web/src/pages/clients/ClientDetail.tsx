import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClientMark } from '../../components/ClientMark';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api, ApiError } from '../../lib/api';
import { useIsAgency } from '../../lib/auth';
import { useClient, type Client } from '../../lib/clients';
import { formatUptime, timeAgo } from '../../lib/format';
import { useMonitors } from '../../lib/monitors';

function messageOf(err: unknown) {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

function Settings({ client }: { client: Client }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['clients'] });

  const save = useMutation({
    mutationFn: (body: Partial<Client>) =>
      api<Client>(`/clients/${client.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      return refresh();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('logo', file);
      return api<Client>(`/clients/${client.id}/logo`, { method: 'POST', body });
    },
    onSuccess: refresh,
    onError: (err) => setError(messageOf(err)),
  });

  const removeLogo = useMutation({
    mutationFn: () => api<Client>(`/clients/${client.id}/logo`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => api(`/clients/${client.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/clients');
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaved(false);
    save.mutate({
      name: String(form.get('name')),
      contactEmail: String(form.get('contactEmail')),
      brandColor: String(form.get('brandColor')),
    });
  }

  return (
    <section className="card stack" style={{ gap: 20 }}>
      <h2 style={{ fontSize: 'var(--text-lg)' }}>Brand and contact</h2>

      <div className="row" style={{ gap: 16 }}>
        <ClientMark
          name={client.name}
          logoUrl={client.logoUrl}
          color={client.brandColor}
          size={64}
        />
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <button
              className="btn"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
            >
              <ImageUp size={15} /> {client.logoUrl ? 'Replace logo' : 'Upload logo'}
            </button>
            {client.logoUrl && (
              <button className="btn btn-ghost" type="button" onClick={() => removeLogo.mutate()}>
                Remove
              </button>
            )}
          </div>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            PNG, JPG or SVG, up to 1 MB. Shown on the status page and in reports.
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <form className="stack" onSubmit={onSubmit} style={{ gap: 14 }}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" className="input" defaultValue={client.name} required />
          </div>
          <div className="field">
            <label htmlFor="contactEmail">Contact email</label>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              className="input"
              defaultValue={client.contactEmail ?? ''}
              placeholder="Where the monthly report goes"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="brandColor">Brand colour</label>
          <div className="row">
            <input
              id="brandColor"
              name="brandColor"
              type="color"
              className="input"
              defaultValue={client.brandColor}
              style={{ width: 64, padding: 4 }}
            />
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              Used as the accent on this client&apos;s status page.
            </span>
          </div>
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={save.isPending}>
              Save
            </button>
            {saved && <span className="muted">Saved.</span>}
          </div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm(`Delete ${client.name}? Its monitors stay, without a client.`)) {
                remove.mutate();
              }
            }}
          >
            <Trash2 size={15} /> Delete client
          </button>
        </div>
      </form>
    </section>
  );
}

function ClientMonitors({ clientId }: { clientId: string }) {
  const monitors = useMonitors(clientId);
  if (monitors.isPending) return <Skeleton rows={3} height={44} />;
  if (monitors.isError) {
    return <ErrorState message="Could not load monitors." onRetry={() => monitors.refetch()} />;
  }
  if (monitors.data.length === 0) {
    return (
      <EmptyState
        title="No monitors for this client"
        body="Add a monitor and choose this client, or import a list of their sites."
        action={
          <Link className="btn" to="/monitors/import">
            Import sites
          </Link>
        }
      />
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Monitor</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>24h</th>
            <th>Checked</th>
          </tr>
        </thead>
        <tbody>
          {monitors.data.map((m) => (
            <tr key={m.id}>
              <td>
                <Link to={`/monitors/${m.id}`} style={{ color: 'var(--text)', fontWeight: 500 }}>
                  {m.name}
                </Link>
                <div className="mono muted" style={{ fontSize: 'var(--text-xs)' }}>
                  {m.target}
                </div>
              </td>
              <td>
                <StatusBadge status={m.state} />
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {formatUptime(m.uptime24h)}
              </td>
              <td className="muted">{m.lastCheckedAt ? timeAgo(m.lastCheckedAt) : 'Not yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const client = useClient(id);
  const isAgency = useIsAgency();

  if (client.isPending) return <Skeleton rows={4} height={60} />;
  if (client.isError || !id) {
    return (
      <EmptyState
        title="Client not found"
        body="It may have been deleted."
        action={
          <Link className="btn" to="/clients">
            Back to clients
          </Link>
        }
      />
    );
  }
  const c = client.data;

  return (
    <>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 8 }}>
          <Link to="/clients" className="muted row" style={{ gap: 6, fontSize: 'var(--text-sm)' }}>
            <ArrowLeft size={14} /> Clients
          </Link>
          <div className="row" style={{ gap: 12 }}>
            <ClientMark name={c.name} logoUrl={c.logoUrl} color={c.brandColor} size={36} />
            <h1>{c.name}</h1>
          </div>
          <p className="muted">
            {c.monitors} monitor{c.monitors === 1 ? '' : 's'} · {formatUptime(c.uptime30d)} up over
            30 days
          </p>
        </div>
      </div>
      <div className="stack" style={{ gap: 24 }}>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Monitors</h2>
          <ClientMonitors clientId={id} />
        </section>
        {isAgency && <Settings client={c} />}
      </div>
    </>
  );
}
