import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { api, ApiError } from '../lib/api';
import { useIsAgency } from '../lib/auth';
import { formatDateTime, formatDuration } from '../lib/format';
import { useIncidents, type Incident } from '../lib/monitors';

const UPDATE_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

// What visitors of the status page read about this incident, and a form to add to it.
function Updates({ incident, canPost }: { incident: Incident; canPost: boolean }) {
  const qc = useQueryClient();
  const post = useMutation({
    mutationFn: (body: { status: string; message: string }) =>
      api(`/incidents/${incident.id}/updates`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    post.mutate({ status: String(form.get('status')), message: String(form.get('message')) });
    e.currentTarget.reset();
  }

  return (
    <div className="stack" style={{ gap: 10, padding: '4px 0' }}>
      {incident.updates.length === 0 ? (
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          No public updates yet. The status page says the problem is being looked into.
        </span>
      ) : (
        incident.updates.map((u) => (
          <div key={u.id} style={{ borderLeft: '2px solid var(--line-strong)', paddingLeft: 10 }}>
            <strong style={{ textTransform: 'capitalize' }}>{u.status}</strong>{' '}
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              {formatDateTime(u.createdAt)}
            </span>
            <div>{u.message}</div>
          </div>
        ))
      )}
      {canPost && (
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor={`u-status-${incident.id}`}>Status</label>
            <select id={`u-status-${incident.id}`} name="status" className="input">
              {UPDATE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 280px' }}>
            <label htmlFor={`u-message-${incident.id}`}>Public message</label>
            <input
              id={`u-message-${incident.id}`}
              name="message"
              className="input"
              placeholder="We have found the cause and are fixing it."
              required
            />
          </div>
          <button className="btn" type="submit" disabled={post.isPending}>
            Post update
          </button>
          {post.isError && (
            <span className="field-error">
              {post.error instanceof ApiError ? post.error.message : 'Could not post'}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

type Filter = 'all' | 'ongoing' | 'resolved';

export function Incidents() {
  const [status, setStatus] = useState<Filter>('all');
  const incidents = useIncidents({ status });
  const isAgency = useIsAgency();
  const [open, setOpen] = useState<string | null>(null);

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
              <th aria-label="Public updates" />
            </tr>
          </thead>
          <tbody>
            {incidents.data.map((i) => (
              <Fragment key={i.id}>
                <tr>
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
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost"
                      aria-expanded={open === i.id}
                      onClick={() => setOpen(open === i.id ? null : i.id)}
                    >
                      <MessageSquarePlus size={15} /> {i.updates.length || ''} Updates
                    </button>
                  </td>
                </tr>
                {open === i.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--raised)' }}>
                      <Updates incident={i} canPost={isAgency} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
