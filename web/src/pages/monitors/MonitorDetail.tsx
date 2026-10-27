import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pause, Pencil, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponseChart } from '../../components/ResponseChart';
import { Segmented } from '../../components/Segmented';
import { StatTile } from '../../components/StatTile';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api } from '../../lib/api';
import { formatDateTime, formatDuration, formatMs, formatUptime, timeAgo } from '../../lib/format';
import {
  RANGES,
  useChecks,
  useIncidents,
  useMonitor,
  useSeries,
  useStats,
  type Monitor,
  type Range,
} from '../../lib/monitors';

function Header({ monitor }: { monitor: Monitor }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api(`/monitors/${monitor.id}/${monitor.isActive ? 'pause' : 'resume'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  });

  return (
    <div className="page-head" style={{ alignItems: 'flex-start' }}>
      <div className="stack" style={{ gap: 8 }}>
        <Link to="/" className="muted row" style={{ gap: 6, fontSize: 'var(--text-sm)' }}>
          <ArrowLeft size={14} /> Overview
        </Link>
        <div className="row">
          <h1>{monitor.name}</h1>
          <StatusBadge status={monitor.state} />
        </div>
        <p className="muted">
          <span className="mono">{monitor.target}</span> · every {monitor.intervalSec}s ·{' '}
          {monitor.lastCheckedAt ? `checked ${timeAgo(monitor.lastCheckedAt)}` : 'not checked yet'}
        </p>
      </div>
      <div className="row">
        <button className="btn" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
          {monitor.isActive ? <Pause size={15} /> : <Play size={15} />}
          {monitor.isActive ? 'Pause' : 'Resume'}
        </button>
        <Link className="btn" to={`/monitors/${monitor.id}/edit`}>
          <Pencil size={15} /> Edit
        </Link>
      </div>
    </div>
  );
}

function RecentIncidents({ monitorId }: { monitorId: string }) {
  const incidents = useIncidents({ monitorId });
  if (incidents.isPending) return <Skeleton rows={3} height={40} />;
  if (incidents.isError) {
    return <ErrorState message="Could not load incidents." onRetry={() => incidents.refetch()} />;
  }
  if (incidents.data.length === 0) {
    return (
      <p className="muted" style={{ padding: '8px 0' }}>
        No incidents. Every check has answered.
      </p>
    );
  }
  return (
    <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 0 }}>
      {incidents.data.slice(0, 6).map((i) => (
        <li
          key={i.id}
          style={{
            padding: '10px 0',
            borderBottom: '1px solid var(--line)',
            display: 'grid',
            gap: 2,
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <StatusBadge
              status={i.resolvedAt ? 'up' : 'down'}
              label={i.resolvedAt ? 'Resolved' : 'Ongoing'}
            />
            <span className="muted num" style={{ fontSize: 'var(--text-xs)' }}>
              {formatDuration(i.durationMs)}
            </span>
          </div>
          <span>{i.cause}</span>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            {formatDateTime(i.startedAt)}
            {i.resolvedAt ? ` – ${formatDateTime(i.resolvedAt)}` : ' – ongoing'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RecentChecks({ monitorId }: { monitorId: string }) {
  const checks = useChecks(monitorId);
  if (checks.isPending) return <Skeleton rows={5} height={32} />;
  if (checks.isError) {
    return <ErrorState message="Could not load checks." onRetry={() => checks.refetch()} />;
  }
  if (checks.data.length === 0) {
    return <p className="muted">The first check runs within a minute of saving.</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Result</th>
            <th style={{ textAlign: 'right' }}>Response</th>
            <th>Code</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.data.map((c) => (
            <tr key={c.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {formatDateTime(c.checkedAt)}
              </td>
              <td>
                <StatusBadge status={c.status} label={c.status === 'up' ? 'Up' : 'Failed'} />
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {formatMs(c.responseMs)}
              </td>
              <td className="num muted">{c.statusCode ?? '—'}</td>
              <td className="muted">{c.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Charts({ monitorId }: { monitorId: string }) {
  const [range, setRange] = useState<Range>('24h');
  const stats = useStats(monitorId, range);
  const series = useSeries(monitorId, range);
  const rangeLabel = RANGES.find((r) => r.value === range)!.label;

  return (
    <>
      {/* One filter row; it scopes every figure and chart below it. */}
      <div className="filters">
        <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
      </div>

      <div className="tiles" style={{ marginBottom: 16 }}>
        <StatTile
          label="Uptime, 24 hours"
          value={formatUptime(stats.data?.uptime['24h'] ?? null)}
          loading={stats.isPending}
        />
        <StatTile
          label="Uptime, 7 days"
          value={formatUptime(stats.data?.uptime['7d'] ?? null)}
          loading={stats.isPending}
        />
        <StatTile
          label="Uptime, 30 days"
          value={formatUptime(stats.data?.uptime['30d'] ?? null)}
          loading={stats.isPending}
        />
        <StatTile
          label="Average response"
          value={formatMs(stats.data?.avgMs ?? null)}
          hint={`Last ${rangeLabel}`}
          loading={stats.isPending}
        />
        <StatTile
          label="95th percentile"
          value={formatMs(stats.data?.p95Ms ?? null)}
          hint={`Last ${rangeLabel}`}
          loading={stats.isPending}
        />
      </div>

      <section className="card stack" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Response time</h2>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Average per interval, last {rangeLabel}. Shaded where checks failed.
          </span>
        </div>
        {series.isPending ? (
          <Skeleton rows={1} height={260} />
        ) : series.isError ? (
          <ErrorState message="Could not load the chart." onRetry={() => series.refetch()} />
        ) : series.data.length === 0 ? (
          <EmptyState
            title="No checks in this range"
            body="Pick a longer range, or wait for the next check."
          />
        ) : (
          <div className={series.isPlaceholderData ? 'chart-refreshing' : undefined}>
            <ResponseChart points={series.data} range={range} />
          </div>
        )}
      </section>
    </>
  );
}

export function MonitorDetail() {
  const { id } = useParams();
  const monitor = useMonitor(id);

  if (monitor.isPending) return <Skeleton rows={6} height={60} />;
  if (monitor.isError || !id) {
    return (
      <EmptyState
        title="Monitor not found"
        body="It may have been deleted, or it belongs to another account."
        action={
          <Link className="btn" to="/">
            Back to overview
          </Link>
        }
      />
    );
  }

  return (
    <>
      <Header monitor={monitor.data} />
      <Charts monitorId={id} />
      <div
        className="grid-2"
        style={{
          gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 2fr)',
          alignItems: 'start',
        }}
      >
        <section className="card stack">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Recent incidents</h2>
          <RecentIncidents monitorId={id} />
        </section>
        <section className="card stack">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Latest checks</h2>
          <RecentChecks monitorId={id} />
        </section>
      </div>
    </>
  );
}
