import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Plus, Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClientTag } from '../components/ClientMark';
import { Segmented } from '../components/Segmented';
import { StatTile } from '../components/StatTile';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { last24HourLabels, UptimeBar } from '../components/UptimeBar';
import { api } from '../lib/api';
import { useIsAgency } from '../lib/auth';
import { formatUptime, timeAgo } from '../lib/format';
import { useMonitors, type MonitorListItem } from '../lib/monitors';

type StateFilter = 'all' | 'down' | 'up' | 'paused';
type Sort = 'status' | 'name' | 'uptime';

// Down first: the overview exists to answer "is anything broken right now?".
const STATE_ORDER = { down: 0, pending: 1, up: 2, paused: 3 } as const;

const sorters: Record<Sort, (a: MonitorListItem, b: MonitorListItem) => number> = {
  status: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  uptime: (a, b) => (a.uptime24h ?? 101) - (b.uptime24h ?? 101),
};

function PauseToggle({ monitor }: { monitor: MonitorListItem }) {
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
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate();
      }}
      disabled={toggle.isPending}
      aria-label={label}
      title={label}
    >
      {monitor.isActive ? <Pause size={15} /> : <Play size={15} />}
    </button>
  );
}

function MonitorTable({
  monitors,
  labels,
  showClient,
  canEdit,
  onOpen,
}: {
  monitors: MonitorListItem[];
  labels: string[];
  showClient: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Monitor</th>
            <th>Status</th>
            <th style={{ minWidth: 200 }}>Last 24 hours</th>
            <th style={{ textAlign: 'right' }}>Uptime</th>
            <th>Checked</th>
            {canEdit && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {monitors.map((m) => (
            <tr key={m.id} className="table-link" onClick={() => onOpen(m.id)}>
              <td>
                <Link
                  to={'/monitors/' + m.id}
                  style={{ color: 'var(--text)', fontWeight: 500 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {m.name}
                </Link>
                <div className="mono muted" style={{ fontSize: 'var(--text-xs)' }}>
                  {m.target}
                </div>
                {showClient && m.client && (
                  <ClientTag name={m.client.name} color={m.client.brandColor} />
                )}
              </td>
              <td>
                <StatusBadge status={m.state} />
              </td>
              <td>
                <UptimeBar
                  cells={m.last24h}
                  labels={labels}
                  summary={m.name + ': ' + formatUptime(m.uptime24h) + ' up in the last 24 hours'}
                />
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {formatUptime(m.uptime24h)}
              </td>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {m.lastCheckedAt ? timeAgo(m.lastCheckedAt) : 'Not yet'}
              </td>
              {canEdit && (
                <td style={{ textAlign: 'right' }}>
                  <PauseToggle monitor={m} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ monitors }: { monitors: MonitorListItem[] }) {
  const down = monitors.filter((m) => m.state === 'down');
  const paused = monitors.filter((m) => m.state === 'paused').length;
  let up = 0;
  let total = 0;
  for (const m of monitors) {
    for (const c of m.last24h) {
      up += c?.up ?? 0;
      total += c?.total ?? 0;
    }
  }
  return (
    <div className="tiles" style={{ marginBottom: 24 }}>
      <StatTile
        label="Monitors"
        value={monitors.length}
        hint={paused ? `${paused} paused` : 'All active'}
      />
      <StatTile
        label="Down now"
        value={down.length}
        hint={down.length ? down.map((m) => m.name).join(', ') : 'Everything is answering'}
      />
      <StatTile
        label="Uptime, last 24 hours"
        value={formatUptime(total ? (up / total) * 100 : null)}
        hint={`${total.toLocaleString('en')} checks across all monitors`}
      />
    </div>
  );
}

export function Overview() {
  const monitors = useMonitors();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<StateFilter>('all');
  const [sort, setSort] = useState<Sort>('status');
  const [clientId, setClientId] = useState('');
  const [grouped, setGrouped] = useState(false);
  const isAgency = useIsAgency();
  // The hours the api bucketed are relative to when it answered.
  const fetchedAt = monitors.dataUpdatedAt;
  const labels = useMemo(() => last24HourLabels(new Date(fetchedAt || 0)), [fetchedAt]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (monitors.data ?? [])
      .filter((m) => state === 'all' || m.state === state)
      .filter((m) => !clientId || m.clientId === clientId)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.target.toLowerCase().includes(q))
      .sort(sorters[sort]);
  }, [monitors.data, query, state, sort, clientId]);

  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of monitors.data ?? []) if (m.client) seen.set(m.client.id, m.client.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [monitors.data]);

  // Grouped: one section per client, ungrouped monitors last. Otherwise one list.
  const groups = useMemo((): [string | null, MonitorListItem[]][] => {
    if (!grouped) return [[null, visible]];
    const byClient = new Map<string, MonitorListItem[]>();
    for (const m of visible) {
      const key = m.client?.name ?? 'No client';
      byClient.set(key, [...(byClient.get(key) ?? []), m]);
    }
    return [...byClient].sort(([a], [b]) =>
      a === 'No client' ? 1 : b === 'No client' ? -1 : a.localeCompare(b),
    );
  }, [visible, grouped]);

  const addButton = isAgency && (
    <div className="row">
      <Link className="btn" to="/monitors/import">
        <Upload size={16} /> Import
      </Link>
      <Link className="btn btn-primary" to="/monitors/new">
        <Plus size={16} /> Add a monitor
      </Link>
    </div>
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
      <>
        <Summary monitors={monitors.data} />
        <div className="filters">
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <Search
              size={15}
              className="muted"
              aria-hidden="true"
              style={{ position: 'absolute', left: 10, top: 10 }}
            />
            <input
              className="input"
              style={{ width: '100%', paddingLeft: 32 }}
              placeholder="Search by name or address"
              aria-label="Search monitors"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Segmented
            label="Status"
            value={state}
            onChange={setState}
            options={[
              { value: 'all', label: 'All' },
              { value: 'down', label: 'Down' },
              { value: 'up', label: 'Up' },
              { value: 'paused', label: 'Paused' },
            ]}
          />
          <select
            className="input"
            aria-label="Sort by"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="status">Sort: problems first</option>
            <option value="name">Sort: name</option>
            <option value="uptime">Sort: lowest uptime</option>
          </select>
          {clientOptions.length > 0 && (
            <select
              className="input"
              aria-label="Client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">All clients</option>
              {clientOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <label className="row muted" style={{ gap: 6, fontSize: 'var(--text-sm)' }}>
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />
            Group by client
          </label>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body="No monitor fits this search and filter."
            action={
              <button
                className="btn"
                onClick={() => {
                  setQuery('');
                  setState('all');
                  setClientId('');
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <div className="stack" style={{ gap: 20 }}>
            {groups.map(([group, items]) => (
              <section key={group ?? 'all'} className="stack" style={{ gap: 8 }}>
                {group !== null && (
                  <h2 className="row" style={{ fontSize: 'var(--text-md)', gap: 8 }}>
                    {items[0]?.client && (
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: items[0].client.brandColor,
                        }}
                      />
                    )}
                    {group}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {items.length}
                    </span>
                  </h2>
                )}
                <MonitorTable
                  monitors={items}
                  labels={labels}
                  showClient={!grouped}
                  canEdit={isAgency}
                  onOpen={(id) => navigate('/monitors/' + id)}
                />
              </section>
            ))}
          </div>
        )}
      </>
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
