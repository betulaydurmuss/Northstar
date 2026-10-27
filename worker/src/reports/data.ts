import { prisma } from '../db.js';

// The numbers behind a monthly SLA report. Uptime is checks up over checks taken, with
// checks during planned maintenance left out entirely. Downtime is the length of each
// incident clipped to the month, so an outage that began on the 31st counts only its
// share. A month still in progress is measured up to now.

const DAY = 86_400_000;

export type ReportData = {
  client: { name: string; brandColor: string; logoPath: string | null };
  agency: string;
  period: string;
  periodLabel: string;
  from: Date;
  to: Date;
  overall: {
    uptime: number | null;
    downtimeMs: number;
    incidents: number;
    avgMs: number | null;
    checks: number;
  };
  maintenanceMs: number;
  monitors: {
    name: string;
    target: string;
    uptime: number | null;
    avgMs: number | null;
    incidents: number;
    downtimeMs: number;
  }[];
  days: { date: string; uptime: number | null; avgMs: number | null }[];
  incidents: {
    monitor: string;
    startedAt: Date;
    resolvedAt: Date | null;
    durationMs: number;
    cause: string;
  }[];
};

export function periodRange(period: string, now = new Date()) {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { from, to: end > now ? now : end };
}

// The overlap of [start, end) with [from, to), in milliseconds.
export function clip(start: Date, end: Date | null, from: Date, to: Date) {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min((end ?? to).getTime(), to.getTime());
  return Math.max(0, e - s);
}

type Row = {
  monitor_id: string;
  day: Date;
  up: bigint;
  total: bigint;
  ms_sum: number | null;
  ms_count: bigint;
};

export async function reportData(clientId: string, period: string): Promise<ReportData> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { organization: { select: { name: true } } },
  });
  const { from, to } = periodRange(period);
  const monitors = await prisma.monitor.findMany({
    where: { clientId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, target: true },
  });
  const ids = monitors.map((m) => m.id);

  const rows = ids.length
    ? await prisma.$queryRaw<Row[]>`
        SELECT monitor_id, date_trunc('day', t) AS day,
               sum(up) AS up, sum(total) AS total, sum(ms_sum) AS ms_sum, sum(ms_count) AS ms_count
          FROM (
            SELECT monitor_id, checked_at AS t, (status = 'up')::int AS up, 1 AS total,
                   response_ms::float8 AS ms_sum, (response_ms IS NOT NULL)::int AS ms_count
              FROM check_results
             WHERE monitor_id = ANY(${ids}::uuid[]) AND checked_at >= ${from} AND checked_at < ${to}
               AND NOT maintenance
            UNION ALL
            SELECT monitor_id, hour, up_count, total_count, avg_ms * ms_count, ms_count
              FROM check_results_hourly
             WHERE monitor_id = ANY(${ids}::uuid[]) AND hour >= ${from} AND hour < ${to}
          ) s
         GROUP BY 1, 2`
    : [];

  const [incidents, windows] = await Promise.all([
    prisma.incident.findMany({
      where: {
        monitorId: { in: ids },
        startedAt: { lt: to },
        OR: [{ resolvedAt: null }, { resolvedAt: { gt: from } }],
      },
      include: { monitor: { select: { name: true } } },
      orderBy: { startedAt: 'asc' },
    }),
    prisma.maintenanceWindow.findMany({
      where: { clientId, startsAt: { lt: to }, endsAt: { gt: from } },
    }),
  ]);

  const sum = (list: Row[], key: 'up' | 'total' | 'ms_count') =>
    list.reduce((n, r) => n + Number(r[key]), 0);
  const msSum = (list: Row[]) => list.reduce((n, r) => n + Number(r.ms_sum ?? 0), 0);
  const pct = (up: number, total: number) => (total > 0 ? (up / total) * 100 : null);
  const avg = (list: Row[]) => {
    const count = sum(list, 'ms_count');
    return count > 0 ? Math.round(msSum(list) / count) : null;
  };

  const incidentRows = incidents.map((i) => ({
    monitorId: i.monitorId,
    monitor: i.monitor.name,
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    durationMs: clip(i.startedAt, i.resolvedAt, from, to),
    cause: i.cause,
  }));

  const days: ReportData['days'] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const today = rows.filter((r) => r.day.toISOString().slice(0, 10) === date);
    days.push({ date, uptime: pct(sum(today, 'up'), sum(today, 'total')), avgMs: avg(today) });
  }

  return {
    client: { name: client.name, brandColor: client.brandColor, logoPath: client.logoPath },
    agency: client.organization.name,
    period,
    periodLabel: from.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    from,
    to,
    overall: {
      uptime: pct(sum(rows, 'up'), sum(rows, 'total')),
      downtimeMs: incidentRows.reduce((n, i) => n + i.durationMs, 0),
      incidents: incidentRows.length,
      avgMs: avg(rows),
      checks: sum(rows, 'total'),
    },
    maintenanceMs: windows.reduce((n, w) => n + clip(w.startsAt, w.endsAt, from, to), 0),
    monitors: monitors.map((m) => {
      const own = rows.filter((r) => r.monitor_id === m.id);
      const mine = incidentRows.filter((i) => i.monitorId === m.id);
      return {
        name: m.name,
        target: m.target,
        uptime: pct(sum(own, 'up'), sum(own, 'total')),
        avgMs: avg(own),
        incidents: mine.length,
        downtimeMs: mine.reduce((n, i) => n + i.durationMs, 0),
      };
    }),
    days,
    incidents: incidentRows.map(({ monitorId: _id, ...rest }) => rest),
  };
}
