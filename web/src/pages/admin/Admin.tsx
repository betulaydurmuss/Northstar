import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { formatDateTime, timeAgo } from '../../lib/format';

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong.';

function Head({ title, body }: { title: string; body: string }) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">Admin</span>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
      </div>
    </div>
  );
}

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'super_admin';
  membership: {
    role: 'agency_admin' | 'client_viewer';
    organization: { id: string; name: string; plan: string };
  } | null;
  twoFactorEnabled: boolean;
  lockedUntil: string | null;
  suspendedAt: string | null;
  createdAt: string;
  lastActiveAt: string | null;
};

const PAGE = 50;

function UserState({ user }: { user: AdminUser }) {
  if (user.suspendedAt) return <StatusBadge status="down" label="Suspended" />;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return <StatusBadge status="degraded" label="Locked" />;
  }
  return <StatusBadge status="up" label="Active" />;
}

export function AdminUsers() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['admin', 'users', q, offset],
    queryFn: () =>
      api<{ total: number; users: AdminUser[] }>(
        `/admin/users?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(q)}`,
      ),
  });

  const act = useMutation({
    mutationFn: ({
      user,
      action,
    }: {
      user: AdminUser;
      action: 'suspend' | 'activate' | 'password-reset';
    }) =>
      api(`/admin/users/${user.id}/${action}`, { method: 'POST' }).then(() => ({ user, action })),
    onSuccess: ({ user, action }) => {
      setNotice(
        action === 'password-reset'
          ? `A reset link is on its way to ${user.email}.`
          : `${user.email} is ${action === 'suspend' ? 'suspended and signed out everywhere' : 'active again'}.`,
      );
      return qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setNotice(messageOf(err)),
  });

  return (
    <>
      <Head title="Users" body="Everyone with a Northstar account, newest first." />
      <div className="filters">
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
          <Search
            size={15}
            className="muted"
            aria-hidden="true"
            style={{ position: 'absolute', left: 10, top: 10 }}
          />
          <input
            className="input"
            style={{ width: '100%', paddingLeft: 32 }}
            placeholder="Search by email or name"
            aria-label="Search users"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>
      {notice && (
        <div className="notice" role="status" style={{ marginBottom: 12 }}>
          {notice}
        </div>
      )}
      {users.isPending ? (
        <Skeleton rows={6} height={48} />
      ) : users.isError ? (
        <ErrorState message="Could not load users." onRetry={() => users.refetch()} />
      ) : users.data.users.length === 0 ? (
        <EmptyState title="No one matches" body="Try part of an email address or a name." />
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Agency</th>
                  <th>2FA</th>
                  <th>Last active</th>
                  <th>State</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{u.name}</div>
                      <div className="mono muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {u.email}
                      </div>
                    </td>
                    <td>
                      {u.role === 'super_admin' ? (
                        <span className="eyebrow">Platform admin</span>
                      ) : u.membership ? (
                        <>
                          <div>{u.membership.organization.name}</div>
                          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {u.membership.role === 'agency_admin' ? 'Agency' : 'Client viewer'} ·{' '}
                            {u.membership.organization.plan}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">{u.twoFactorEnabled ? 'On' : 'Off'}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'Never'}
                    </td>
                    <td>
                      <UserState user={u} />
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-ghost"
                        title="Send a password reset link"
                        aria-label={`Send a password reset link to ${u.email}`}
                        onClick={() => act.mutate({ user: u, action: 'password-reset' })}
                      >
                        <KeyRound size={15} />
                      </button>
                      {u.id !== me?.id &&
                        (u.suspendedAt ? (
                          <button
                            className="btn btn-ghost"
                            onClick={() => act.mutate({ user: u, action: 'activate' })}
                          >
                            <UserCheck size={15} /> Reactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Suspend ${u.email}? They are signed out everywhere at once.`,
                                )
                              ) {
                                act.mutate({ user: u, action: 'suspend' });
                              }
                            }}
                          >
                            <UserX size={15} /> Suspend
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
              {offset + 1}–{offset + users.data.users.length} of {users.data.total}
            </span>
            <div className="row">
              <button
                className="btn"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </button>
              <button
                className="btn"
                disabled={offset + PAGE >= users.data.total}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

type Health = {
  api: { uptimeSec: number; node: string };
  queues:
    | {
        name: string;
        waiting: number;
        active: number;
        delayed: number;
        failed: number;
        workers: number;
      }[]
    | null;
  workersOnline: number | null;
  redisMemory: string | null;
  checks24h: number;
  failedChecks24h: number;
  activeMonitors: number;
  openIncidents: number;
  databaseBytes: number;
};

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const uptime = (sec: number) =>
  sec < 3600
    ? `${Math.round(sec / 60)} min`
    : sec < 86400
      ? `${(sec / 3600).toFixed(1)} h`
      : `${(sec / 86400).toFixed(1)} d`;

export function AdminSystem() {
  const health = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => api<Health>('/admin/system/health'),
    refetchInterval: 10_000,
  });

  if (health.isPending) return <Skeleton rows={4} height={90} />;
  if (health.isError)
    return <ErrorState message="Could not load system health." onRetry={() => health.refetch()} />;
  const h = health.data;
  const workersOk = h.workersOnline !== null && h.workersOnline > 0;

  return (
    <>
      <Head title="System health" body="Refreshed every ten seconds." />
      <div className="tiles" style={{ marginBottom: 20 }}>
        <StatTile
          label="Workers"
          value={
            h.workersOnline === null ? (
              <StatusBadge status="down" label="Redis unreachable" />
            ) : workersOk ? (
              <StatusBadge status="up" label={`${h.workersOnline} online`} />
            ) : (
              <StatusBadge status="down" label="None running" />
            )
          }
          hint={workersOk ? 'Checks are being run' : 'No checks are running'}
        />
        <StatTile
          label="Checks, last 24 hours"
          value={h.checks24h.toLocaleString('en')}
          hint={`${h.failedChecks24h.toLocaleString('en')} failed`}
        />
        <StatTile
          label="Active monitors"
          value={h.activeMonitors.toLocaleString('en')}
          hint={`${h.openIncidents} open incidents`}
        />
        <StatTile
          label="Database"
          value={megabytes(h.databaseBytes)}
          hint={`Redis ${h.redisMemory ?? 'unknown'}`}
        />
        <StatTile label="API uptime" value={uptime(h.api.uptimeSec)} hint={`Node ${h.api.node}`} />
      </div>
      <section className="stack">
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Queues</h2>
        {h.queues === null ? (
          <ErrorState message="Redis did not answer, so queue sizes are unknown." />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th style={{ textAlign: 'right' }}>Waiting</th>
                  <th style={{ textAlign: 'right' }}>Running</th>
                  <th style={{ textAlign: 'right' }}>Scheduled</th>
                  <th style={{ textAlign: 'right' }}>Failed</th>
                  <th style={{ textAlign: 'right' }}>Workers</th>
                </tr>
              </thead>
              <tbody>
                {h.queues.map((q) => (
                  <tr key={q.name}>
                    <td className="mono">{q.name}</td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {q.waiting}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {q.active}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {q.delayed}
                    </td>
                    <td
                      className="num"
                      style={{ textAlign: 'right', color: q.failed ? 'var(--bad)' : undefined }}
                    >
                      {q.failed}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {q.workers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  ip: string | null;
  details: unknown;
  createdAt: string;
  actor: { email: string } | null;
};

const ACTIONS = [
  'user.suspend',
  'user.activate',
  'user.password_reset',
  'plan.update',
  'organization.plan',
];

export function AdminAudit() {
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const log = useQuery({
    queryKey: ['admin', 'audit', action, offset],
    queryFn: () =>
      api<{ total: number; entries: AuditEntry[] }>(
        `/admin/audit-logs?limit=${PAGE}&offset=${offset}${action ? `&action=${action}` : ''}`,
      ),
  });

  return (
    <>
      <Head
        title="Audit log"
        body="Every change made from the admin panel: who, what, when, and from where."
      />
      <div className="filters">
        <select
          className="input"
          aria-label="Action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {log.isPending ? (
        <Skeleton rows={6} height={40} />
      ) : log.isError ? (
        <ErrorState message="Could not load the audit log." onRetry={() => log.refetch()} />
      ) : log.data.entries.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          body="Admin actions appear here as soon as they happen."
        />
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {log.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td>{e.actor?.email ?? <span className="muted">deleted user</span>}</td>
                    <td className="mono">{e.action}</td>
                    <td
                      className="mono muted"
                      style={{ fontSize: 'var(--text-xs)', maxWidth: 360, wordBreak: 'break-word' }}
                    >
                      {e.details ? JSON.stringify(e.details) : (e.target ?? '')}
                    </td>
                    <td className="mono muted">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              className="btn"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Newer
            </button>
            <button
              className="btn"
              disabled={offset + PAGE >= log.data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Older
            </button>
          </div>
        </>
      )}
    </>
  );
}

type Plan = { id: string; name: string; maxMonitors: number; maxClients: number };
type Org = {
  id: string;
  name: string;
  plan: string;
  monitors: number;
  clients: number;
  members: number;
  limits: { maxMonitors: number; maxClients: number };
};

function PlanRow({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const [monitors, setMonitors] = useState(String(plan.maxMonitors));
  const [clients, setClients] = useState(String(plan.maxClients));
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/plans/${plan.id}`, {
        method: 'PATCH',
        body: { maxMonitors: monitors, maxClients: clients },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  const changed = monitors !== String(plan.maxMonitors) || clients !== String(plan.maxClients);
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{plan.name}</td>
      <td>
        <input
          className="input mono"
          type="number"
          min={1}
          value={monitors}
          aria-label={`${plan.name} monitor limit`}
          onChange={(e) => setMonitors(e.target.value)}
          style={{ width: 110 }}
        />
      </td>
      <td>
        <input
          className="input mono"
          type="number"
          min={1}
          value={clients}
          aria-label={`${plan.name} client limit`}
          onChange={(e) => setClients(e.target.value)}
          style={{ width: 110 }}
        />
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className="btn" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          Save
        </button>
        {save.isError && <span className="field-error"> {messageOf(save.error)}</span>}
      </td>
    </tr>
  );
}

export function AdminPlans() {
  const qc = useQueryClient();
  const plans = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api<Plan[]>('/admin/plans'),
  });
  const orgs = useQuery({
    queryKey: ['admin', 'orgs'],
    queryFn: () => api<Org[]>('/admin/organizations'),
  });
  const move = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) =>
      api(`/admin/organizations/${id}`, { method: 'PATCH', body: { plan } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  return (
    <>
      <Head title="Plans and limits" body="How many monitors and clients each agency may have." />
      <div className="stack" style={{ gap: 28 }}>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Plans</h2>
          {plans.isPending ? (
            <Skeleton rows={3} height={44} />
          ) : plans.isError ? (
            <ErrorState message="Could not load plans." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Monitors</th>
                    <th>Clients</th>
                    <th aria-label="Save" />
                  </tr>
                </thead>
                <tbody>
                  {plans.data.map((p) => (
                    <PlanRow key={`${p.id}-${p.maxMonitors}-${p.maxClients}`} plan={p} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Agencies</h2>
          {orgs.isPending ? (
            <Skeleton rows={4} height={44} />
          ) : orgs.isError ? (
            <ErrorState message="Could not load agencies." />
          ) : orgs.data.length === 0 ? (
            <EmptyState
              title="No agencies yet"
              body="Agencies appear here when someone signs up."
            />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Agency</th>
                    <th style={{ textAlign: 'right' }}>Monitors</th>
                    <th style={{ textAlign: 'right' }}>Clients</th>
                    <th style={{ textAlign: 'right' }}>People</th>
                    <th>Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.data.map((o) => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 500 }}>{o.name}</td>
                      <td
                        className="num"
                        style={{
                          textAlign: 'right',
                          color: o.monitors >= o.limits.maxMonitors ? 'var(--warn)' : undefined,
                        }}
                      >
                        {o.monitors} / {o.limits.maxMonitors}
                      </td>
                      <td className="num" style={{ textAlign: 'right' }}>
                        {o.clients} / {o.limits.maxClients}
                      </td>
                      <td className="num" style={{ textAlign: 'right' }}>
                        {o.members}
                      </td>
                      <td>
                        <select
                          className="input"
                          aria-label={`Plan for ${o.name}`}
                          value={o.plan}
                          onChange={(e) => move.mutate({ id: o.id, plan: e.target.value })}
                        >
                          {plans.data?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
