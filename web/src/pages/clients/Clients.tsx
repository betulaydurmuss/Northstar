import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClientMark } from '../../components/ClientMark';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api, ApiError } from '../../lib/api';
import { useIsAgency } from '../../lib/auth';
import { useClients, type Client } from '../../lib/clients';
import { formatUptime } from '../../lib/format';

function NewClientForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: { name: string; brandColor: string }) =>
      api<Client>('/clients', { method: 'POST', body }),
    onSuccess: async (client) => {
      await qc.invalidateQueries({ queryKey: ['clients'] });
      navigate(`/clients/${client.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save.'),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({ name: String(form.get('name')), brandColor: String(form.get('brandColor')) });
  }

  return (
    <form
      className="card row"
      style={{ alignItems: 'flex-end', marginBottom: 16 }}
      onSubmit={onSubmit}
    >
      <div className="field" style={{ flex: '1 1 240px' }}>
        <label htmlFor="client-name">Client name</label>
        <input
          id="client-name"
          name="name"
          className="input"
          placeholder="Marlowe Dental Clinic"
          autoFocus
          required
        />
      </div>
      <div className="field">
        <label htmlFor="client-color">Brand colour</label>
        <input
          id="client-color"
          name="brandColor"
          type="color"
          className="input"
          defaultValue="#818CF8"
          style={{ width: 64, padding: 4 }}
        />
      </div>
      <button className="btn btn-primary" type="submit" disabled={create.isPending}>
        Add client
      </button>
      <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Cancel">
        <X size={16} />
      </button>
      {error && (
        <div className="field-error" style={{ flexBasis: '100%' }} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

function ClientCard({ client }: { client: Client }) {
  return (
    <Link
      to={`/clients/${client.id}`}
      className="card stack client-card"
      style={{ gap: 14, color: 'var(--text)' }}
    >
      <div className="row" style={{ gap: 12 }}>
        <ClientMark
          name={client.name}
          logoUrl={client.logoUrl}
          color={client.brandColor}
          size={40}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {client.name}
          </div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            {client.contactEmail ?? 'No contact email'}
          </div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {client.monitors === 0 ? (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            No monitors yet
          </span>
        ) : client.down > 0 ? (
          <StatusBadge status="down" label={`${client.down} of ${client.monitors} down`} />
        ) : (
          <StatusBadge status="up" label={`${client.monitors} up`} />
        )}
        <span className="num" title="Uptime over the last 30 days">
          {formatUptime(client.uptime30d)}
          <span className="muted" style={{ fontSize: 'var(--text-xs)', marginLeft: 6 }}>
            30d
          </span>
        </span>
      </div>
    </Link>
  );
}

export function Clients() {
  const clients = useClients();
  const isAgency = useIsAgency();
  const [adding, setAdding] = useState(false);

  let body;
  if (clients.isPending) {
    body = <Skeleton rows={3} height={110} />;
  } else if (clients.isError) {
    body = <ErrorState message="Could not load clients." onRetry={() => clients.refetch()} />;
  } else if (clients.data.length === 0) {
    body = (
      <EmptyState
        title="No clients yet"
        body="Clients group the sites you look after. Each one gets its own status page, its brand colour and a monthly report."
        action={
          isAgency && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> Add a client
            </button>
          )
        }
      />
    );
  } else {
    // Clients with something down come first.
    const sorted = [...clients.data].sort(
      (a, b) => b.down - a.down || a.name.localeCompare(b.name),
    );
    body = (
      <div className="client-grid">
        {sorted.map((c) => (
          <ClientCard key={c.id} client={c} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="muted">The businesses whose sites you look after.</p>
        </div>
        {isAgency && !adding && clients.data?.length ? (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add a client
          </button>
        ) : null}
      </div>
      {adding && <NewClientForm onClose={() => setAdding(false)} />}
      {body}
    </>
  );
}
