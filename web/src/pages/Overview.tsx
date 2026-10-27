import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useMonitors, type Monitor } from '../lib/monitors';

function PauseToggle({ monitor }: { monitor: Monitor }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api(`/monitors/${monitor.id}/${monitor.isActive ? 'pause' : 'resume'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  });
  const label = monitor.isActive ? `Pause ${monitor.name}` : `Resume ${monitor.name}`;
  return (
    <button
      className="btn btn-ghost"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-label={label}
      title={label}
    >
      {monitor.isActive ? <Pause size={15} /> : <Play size={15} />}
    </button>
  );
}

export function Overview() {
  const monitors = useMonitors();

  const addButton = (
    <Link className="btn btn-primary" to="/monitors/new">
      <Plus size={16} /> Add a monitor
    </Link>
  );

  let body;
  if (monitors.isPending) {
    body = <Skeleton rows={5} height={52} />;
  } else if (monitors.isError) {
    body = (
      <ErrorState message="Could not load your monitors." onRetry={() => monitors.refetch()} />
    );
  } else if (monitors.data.length === 0) {
    body = (
      <EmptyState
        title="No monitors yet"
        body="Add the first site you want Northstar to watch. We check it every minute and email you the moment it goes down."
        action={addButton}
      />
    );
  } else {
    body = (
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Monitor</th>
              <th>Status</th>
              <th>Checked</th>
              <th>Every</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {monitors.data.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{m.name}</div>
                  <div className="mono muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {m.target}
                  </div>
                </td>
                <td>
                  <StatusBadge status={m.state} />
                </td>
                <td className="muted">{m.lastCheckedAt ? timeAgo(m.lastCheckedAt) : 'Not yet'}</td>
                <td className="mono muted">{m.intervalSec}s</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <PauseToggle monitor={m} />
                  <Link
                    className="btn btn-ghost"
                    to={`/monitors/${m.id}/edit`}
                    aria-label={`Edit ${m.name}`}
                    title={`Edit ${m.name}`}
                  >
                    <Pencil size={15} />
                  </Link>
                </td>
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
          <h1>Overview</h1>
          <p className="muted">Every client site you look after, in one place.</p>
        </div>
        {monitors.data && monitors.data.length > 0 && addButton}
      </div>
      {body}
    </>
  );
}
