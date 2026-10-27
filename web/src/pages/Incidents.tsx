import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatDuration } from '../lib/format';
import { useIncidents } from '../lib/monitors';

type Filter = 'all' | 'ongoing' | 'resolved';

export function Incidents() {
  const [status, setStatus] = useState<Filter>('all');
  const incidents = useIncidents({ status });

  let body;
  if (incidents.isPending) {
    body = <Skeleton rows={5} height={48} />;
  } else if (incidents.isError) {
    body = <ErrorState message="Could not load incidents." onRetry={() => incidents.refetch()} />;
  } else if (incidents.data.length === 0) {
    body = (
      <EmptyState
        title={status === 'ongoing' ? 'Nothing is down' : 'No incidents yet'}
        body={
          status === 'ongoing'
            ? 'Every monitor answered its last check.'
            : 'When a monitor fails its checks, the outage is recorded here with when it started, how long it lasted and why.'
        }
      />
    );
  } else {
    body = (
      <div
        className={`card${incidents.isPlaceholderData ? ' chart-refreshing' : ''}`}
        style={{ padding: 0, overflowX: 'auto' }}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Monitor</th>
              <th>Status</th>
              <th>Started</th>
              <th>Ended</th>
              <th style={{ textAlign: 'right' }}>Duration</th>
              <th>Cause</th>
            </tr>
          </thead>
          <tbody>
            {incidents.data.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link
                    to={`/monitors/${i.monitor.id}`}
                    style={{ color: 'var(--text)', fontWeight: 500 }}
                  >
                    {i.monitor.name}
                  </Link>
                </td>
                <td>
                  {i.resolvedAt ? (
                    <StatusBadge status="up" label="Resolved" />
                  ) : (
                    <StatusBadge status="down" label="Ongoing" />
                  )}
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(i.startedAt)}
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {i.resolvedAt ? formatDateTime(i.resolvedAt) : 'Ongoing'}
                </td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {formatDuration(i.durationMs)}
                </td>
                <td className="muted">{i.cause}</td>
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
          <h1>Incidents</h1>
          <p className="muted">Every outage across your monitors, newest first.</p>
        </div>
      </div>
      <div className="filters">
        <Segmented
          label="Show"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'resolved', label: 'Resolved' },
          ]}
        />
      </div>
      {body}
    </>
  );
}
