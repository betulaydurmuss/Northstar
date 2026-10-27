import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { api, ApiError } from '../lib/api';
import { useIsAgency } from '../lib/auth';
import { useClients, useExpirations, type Expiration } from '../lib/clients';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

// Red under a week, amber under a month; always with an icon and the number of days.
function DaysLeft({ item }: { item: Expiration }) {
  if (item.daysLeft === null) {
    return <StatusBadge status="pending" label="Unknown" />;
  }
  if (item.daysLeft <= 0) return <StatusBadge status="down" label="Expired" />;
  const label = `${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`;
  if (item.daysLeft < 7) return <StatusBadge status="down" label={label} />;
  if (item.daysLeft < 30) return <StatusBadge status="degraded" label={label} />;
  return <StatusBadge status="up" label={label} />;
}

function ManualDate({ item }: { item: Expiration }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (expiresAt: string | null) =>
      api(`/domains/${item.id}`, { method: 'PATCH', body: { expiresAt } }),
    onSuccess: () => {
      setOpen(false);
      return qc.invalidateQueries({ queryKey: ['expirations'] });
    },
  });

  if (!open) {
    return (
      <div className="row" style={{ gap: 4 }}>
        <button className="btn btn-ghost" onClick={() => setOpen(true)}>
          {item.source === 'manual' ? 'Change date' : 'Enter date'}
        </button>
        {item.source === 'manual' && (
          <button
            className="btn btn-ghost"
            onClick={() => save.mutate(null)}
            title="Look the date up automatically again"
          >
            Use RDAP
          </button>
        )}
      </div>
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate(String(new FormData(e.currentTarget).get('expiresAt')));
  }

  return (
    <form className="row" style={{ gap: 6 }} onSubmit={onSubmit}>
      <input
        name="expiresAt"
        type="date"
        className="input"
        aria-label={`Expiry date for ${item.name}`}
        defaultValue={item.expiresAt?.slice(0, 10)}
        required
      />
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>
        Save
      </button>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {save.isError && (
        <span className="field-error">
          {save.error instanceof ApiError ? save.error.message : 'Could not save'}
        </span>
      )}
    </form>
  );
}

export function Expirations() {
  const [clientId, setClientId] = useState('');
  const clients = useClients();
  const items = useExpirations(clientId);
  const isAgency = useIsAgency();

  let body;
  if (items.isPending) {
    body = <Skeleton rows={6} height={48} />;
  } else if (items.isError) {
    body = <ErrorState message="Could not load expiry dates." onRetry={() => items.refetch()} />;
  } else if (items.data.length === 0) {
    body = (
      <EmptyState
        title="Nothing to track yet"
        body="Certificates and domain registrations appear here after the first check of each https monitor."
      />
    );
  } else {
    body = (
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>What</th>
              <th>Client</th>
              <th>Expires</th>
              <th>Left</th>
              <th>Detail</th>
              {isAgency && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {items.data.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    {item.kind === 'certificate' ? (
                      <Lock size={15} className="muted" aria-label="TLS certificate" />
                    ) : (
                      <Globe size={15} className="muted" aria-label="Domain registration" />
                    )}
                    <div>
                      <div className="mono" style={{ fontSize: 'var(--text-sm)' }}>
                        {item.name}
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {item.kind === 'certificate' ? (
                          <>
                            Certificate ·{' '}
                            <Link to={`/monitors/${item.monitor!.id}`}>{item.monitor!.name}</Link>
                          </>
                        ) : (
                          'Domain registration'
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="muted">{item.client?.name ?? '—'}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {item.expiresAt ? dateFormat.format(new Date(item.expiresAt)) : '—'}
                </td>
                <td>
                  <DaysLeft item={item} />
                </td>
                <td style={{ fontSize: 'var(--text-xs)', maxWidth: 320 }}>
                  {item.error ? (
                    <span style={{ color: 'var(--warn)' }}>{item.error}</span>
                  ) : (
                    <span className="muted">{item.detail}</span>
                  )}
                </td>
                {isAgency && (
                  <td style={{ textAlign: 'right' }}>
                    {/* Only where the lookup failed or a date was typed in: RDAP results need no help. */}
                    {item.kind === 'domain' && (item.error || item.source === 'manual') && (
                      <ManualDate item={item} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expiring soon</h1>
          <p className="muted">
            TLS certificates and domain registrations, the soonest first. We email you at 30, 15, 7
            and 1 days.
          </p>
        </div>
      </div>
      <div className="filters">
        <select
          className="input"
          aria-label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">All clients</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {body}
    </>
  );
}
