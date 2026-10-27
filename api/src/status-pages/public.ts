import { prisma } from '../db.js';
import { logoUrl } from '../files.js';

// Builds what a public status page shows. Everything here is meant for strangers:
// monitors appear under the name the agency chose, never with their address, and
// incidents carry only the wording the agency published, never the technical cause.

const DAY = 86_400_000;
export const STATUS_DAYS = 90;

export type PublicMonitor = {
  key: string;
  name: string;
  group: string | null;
  status: 'up' | 'down' | 'maintenance' | 'paused' | 'pending';
  uptime: number | null;
  days: { date: string; up: number; total: number }[];
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
  maintenance: { startsAt: Date; endsAt: Date; message: string; active: boolean }[];
  generatedAt: Date;
};

type PublicIncident = {
  id: string;
  // The public key of the monitor it belongs to (m1, m2, ...), never its id.
  monitor: string;
  title: string;
  startedAt: Date;
  resolvedAt: Date | null;
  updates: { status: string; message: string; createdAt: Date }[];
};

export type Selection = { monitorId: string; displayName: string | null; groupName: string | null };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

// Ninety daily cells per monitor, oldest first, from raw checks and hourly rollups.
async function dailyUptime(monitorIds: string[]) {
  const start = new Date(Date.now() - (STATUS_DAYS - 1) * DAY);
  start.setUTCHours(0, 0, 0, 0);
  const rows = monitorIds.length
    ? await prisma.$queryRaw<{ monitor_id: string; day: Date; up: bigint; total: bigint }[]>`
        SELECT monitor_id, date_trunc('day', t) AS day, sum(up) AS up, sum(total) AS total
          FROM (
            SELECT monitor_id, checked_at AS t, (status = 'up')::int AS up, 1 AS total
              FROM check_results
             WHERE monitor_id = ANY(${monitorIds}::uuid[]) AND checked_at >= ${start}
               AND NOT maintenance
            UNION ALL
            SELECT monitor_id, hour, up_count, total_count
              FROM check_results_hourly
             WHERE monitor_id = ANY(${monitorIds}::uuid[]) AND hour >= ${start}
          ) s
         GROUP BY 1, 2`
    : [];

  const byMonitor = new Map<string, Map<string, { up: number; total: number }>>();
  for (const r of rows) {
    const days = byMonitor.get(r.monitor_id) ?? new Map();
    days.set(utcDay(r.day), { up: Number(r.up), total: Number(r.total) });
    byMonitor.set(r.monitor_id, days);
  }
  const dates = Array.from({ length: STATUS_DAYS }, (_, i) =>
    utcDay(new Date(start.getTime() + i * DAY)),
  );
  return (monitorId: string) => {
    const days = byMonitor.get(monitorId);
    return dates.map((date) => ({ date, ...(days?.get(date) ?? { up: 0, total: 0 }) }));
  };
}

export async function buildPublicStatus(opts: {
  clientId: string;
  title: string;
  slug: string;
  selection: Selection[];
}): Promise<PublicStatus> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: opts.clientId } });
  const ids = opts.selection.map((s) => s.monitorId);
  const monitors = await prisma.monitor.findMany({
    where: { id: { in: ids }, clientId: opts.clientId },
    select: { id: true, name: true, state: true },
  });
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const days = await dailyUptime(ids);
  const now = new Date();

  // Public names, so incidents can be described without revealing internal ones.
  const names = new Map<string, string>();
  const keys = new Map<string, string>();
  const publicMonitors: PublicMonitor[] = [];
  opts.selection.forEach((s, i) => {
    const m = byId.get(s.monitorId);
    if (!m) return;
    const name = s.displayName?.trim() || m.name;
    names.set(m.id, name);
    keys.set(m.id, `m${i + 1}`);
    const cells = days(m.id);
    const up = cells.reduce((n, c) => n + c.up, 0);
    const total = cells.reduce((n, c) => n + c.total, 0);
    publicMonitors.push({
      key: `m${i + 1}`,
      name,
      group: s.groupName?.trim() || null,
      status: m.state,
      uptime: total ? (up / total) * 100 : null,
      days: cells,
    });
  });

  const [incidents, windows] = await Promise.all([
    prisma.incident.findMany({
      where: {
        monitorId: { in: [...names.keys()] },
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(now.getTime() - 14 * DAY) } }],
      },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
      orderBy: { startedAt: 'desc' },
      take: 30,
    }),
    prisma.maintenanceWindow.findMany({
      where: {
        clientId: opts.clientId,
        endsAt: { gt: now },
        startsAt: { lt: new Date(now.getTime() + 14 * DAY) },
      },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  const toPublic = (i: (typeof incidents)[number]): PublicIncident => ({
    id: i.id,
    monitor: keys.get(i.monitorId)!,
    title: `${names.get(i.monitorId)} ${i.resolvedAt ? 'was' : 'is'} unavailable`,
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    updates: i.updates.map((u) => ({
      status: u.status,
      message: u.message,
      createdAt: u.createdAt,
    })),
  });

  const downCount = publicMonitors.filter((m) => m.status === 'down').length;
  const maintenanceActive = windows.some((w) => w.startsAt <= now);
  const status: PublicStatus['status'] =
    downCount > 0 && downCount === publicMonitors.length
      ? 'outage'
      : downCount > 0
        ? 'degraded'
        : maintenanceActive
          ? 'maintenance'
          : 'operational';
  const statusText = {
    operational: 'All systems operational',
    degraded: 'Some systems are down',
    outage: 'Major outage',
    maintenance: 'Scheduled maintenance in progress',
  }[status];

  return {
    title: opts.title,
    slug: opts.slug,
    client: { name: client.name, logoUrl: logoUrl(client.logoPath), brandColor: client.brandColor },
    status,
    statusText,
    monitors: publicMonitors,
    activeIncidents: incidents.filter((i) => !i.resolvedAt).map(toPublic),
    pastIncidents: incidents.filter((i) => i.resolvedAt).map(toPublic),
    maintenance: windows.map((w) => ({
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      message: w.message,
      active: w.startsAt <= now,
    })),
    generatedAt: now,
  };
}
