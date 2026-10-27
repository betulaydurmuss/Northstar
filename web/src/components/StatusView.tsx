import { AlertTriangle, Check, Wrench, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ClientMark } from './ClientMark';
import { Mark } from './Logo';
import { StatusBadge } from './StatusBadge';
import { UptimeBar } from './UptimeBar';
import { formatUptime } from '../lib/format';

// Rendered on the public page and in the editor's live preview, from the same data.

export type PublicMonitor = {
  key: string;
  name: string;
  group: string | null;
  status: 'up' | 'down' | 'maintenance' | 'paused' | 'pending';
  uptime: number | null;
  days: { date: string; up: number; total: number }[];
};

type PublicIncident = {
  id: string;
  monitor: string;
  title: string;
  startedAt: string;
  resolvedAt: string | null;
  updates: { status: string; message: string; createdAt: string }[];
};

export type PublicStatus = {
  title: string;
  slug: string;
  client: { name: string; logoUrl: string | null; brandColor: string };
  status: 'operational' | 'degraded' | 'outage' | 'maintenance';
  statusText: string;
  monitors: PublicMonitor[];
  activeIncidents: PublicIncident[];
  pastIncidents: PublicIncident[];
  maintenance: { startsAt: string; endsAt: string; message: string; active: boolean }[];
};

const BANNER_ICON = { operational: Check, degraded: AlertTriangle, outage: X, maintenance: Wrench };

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function groupsOf(monitors: PublicMonitor[]) {
  const groups: [string | null, PublicMonitor[]][] = [];
  for (const m of monitors) {
    const last = groups.at(-1);
    if (last && last[0] === m.group) last[1].push(m);
    else groups.push([m.group, [m]]);
  }
  return groups;
}

function Incident({ incident }: { incident: PublicIncident }) {
  return (
    <div className="status-incident">
      <div className="status-row-head">
        <strong>{incident.title}</strong>
        <StatusBadge
          status={incident.resolvedAt ? 'up' : 'down'}
          label={incident.resolvedAt ? 'Resolved' : 'Ongoing'}
        />
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        {when.format(new Date(incident.startedAt))}
        {incident.resolvedAt ? ` – ${when.format(new Date(incident.resolvedAt))}` : ''}
      </span>
      {incident.updates.length === 0 && !incident.resolvedAt && (
        <div className="status-update">
          <span>We are aware of the problem and are looking into it.</span>
        </div>
      )}
      {incident.updates.map((u) => (
        <div key={u.createdAt} className="status-update">
          <span>
            <strong>{u.status}</strong>{' '}
            <span className="muted" style={{ fontSize: 12 }}>
              {when.format(new Date(u.createdAt))}
            </span>
          </span>
          <span>{u.message}</span>
        </div>
      ))}
    </div>
  );
}

export function StatusView({ data }: { data: PublicStatus }) {
  const Icon = BANNER_ICON[data.status];
  const style = { '--brand': data.client.brandColor } as CSSProperties;

  return (
    <div className="status-page" style={style}>
      <div className="status-wrap">
        <header className="status-head">
          <ClientMark
            name={data.client.name}
            logoUrl={data.client.logoUrl}
            color={data.client.brandColor}
            size={40}
          />
          <h1>{data.title}</h1>
        </header>

        <div className={`status-banner is-${data.status}`} role="status">
          <Icon size={22} aria-hidden="true" />
          <span>
            {data.statusText}
            {data.status === 'maintenance' && (
              <small>{data.maintenance.find((m) => m.active)?.message}</small>
            )}
          </span>
        </div>

        {data.activeIncidents.length > 0 && (
          <section className="status-section">
            <h2>Current incidents</h2>
            <div className="status-card">
              {data.activeIncidents.map((i) => (
                <Incident key={i.id} incident={i} />
              ))}
            </div>
          </section>
        )}

        {data.maintenance.filter((m) => !m.active).length > 0 && (
          <section className="status-section">
            <h2>Planned maintenance</h2>
            <div className="status-card">
              {data.maintenance
                .filter((m) => !m.active)
                .map((m) => (
                  <div key={m.startsAt} className="status-incident">
                    <strong>{m.message}</strong>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {when.format(new Date(m.startsAt))} – {when.format(new Date(m.endsAt))}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {data.monitors.length === 0 ? (
          <div className="status-card status-row">
            <span className="muted">No services are listed on this page yet.</span>
          </div>
        ) : (
          groupsOf(data.monitors).map(([group, monitors], gi) => (
            <section key={gi} className="status-card">
              {group && <div className="status-group-title">{group}</div>}
              {monitors.map((m) => {
                const labels = m.days.map((d) => dayLabel.format(new Date(d.date)));
                return (
                  <div key={m.key} className="status-row">
                    <div className="status-row-head">
                      <span className="status-row-name">{m.name}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <UptimeBar
                      cells={m.days.map((d) => (d.total ? { up: d.up, total: d.total } : null))}
                      labels={labels}
                      height={28}
                      summary={`${m.name}: ${formatUptime(m.uptime)} up over the last 90 days`}
                    />
                    <div className="status-axis">
                      <span>90 days ago</span>
                      <span className="mono">{formatUptime(m.uptime)} uptime</span>
                      <span>Today</span>
                    </div>
                  </div>
                );
              })}
            </section>
          ))
        )}

        {data.pastIncidents.length > 0 && (
          <section className="status-section">
            <h2>Past incidents</h2>
            <div className="status-card">
              {data.pastIncidents.map((i) => (
                <Incident key={i.id} incident={i} />
              ))}
            </div>
          </section>
        )}

        <footer className="status-foot">
          <Mark size={14} color="#4F46E5" />
          <span>
            Monitored by <a href="https://github.com/betulaydurmuss/Northstar">Northstar</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
