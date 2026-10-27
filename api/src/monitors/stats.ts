import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// Raw checks are kept for seven days; older history lives in check_results_hourly. Every
// figure below reads both, so a 30-day number covers 30 days whether or not the nightly
// rollup has run yet. Uptime is exact either way. Averages are weighted by sample count.
// Percentiles over rolled-up hours use each hour's p95, which is an approximation.

export const RANGES = {
  '1h': { ms: 3_600_000, bucket: '1 minute' },
  '24h': { ms: 86_400_000, bucket: '15 minutes' },
  '7d': { ms: 7 * 86_400_000, bucket: '1 hour' },
  '30d': { ms: 30 * 86_400_000, bucket: '6 hours' },
} as const;
export type Range = keyof typeof RANGES;

const since = (range: Range, now = Date.now()) => new Date(now - RANGES[range].ms);

const pct = (up: number, total: number) => (total > 0 ? (up / total) * 100 : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// Both sources as one relation: (t, up, total, ms_sum, ms_count, p95).
function samples(monitorId: string, from: Date) {
  return Prisma.sql`
    SELECT checked_at AS t,
           (status = 'up')::int AS up,
           1 AS total,
           response_ms::float8 AS ms_sum,
           (response_ms IS NOT NULL)::int AS ms_count,
           response_ms::float8 AS p95
      FROM check_results
     WHERE monitor_id = ${monitorId}::uuid AND checked_at >= ${from}
    UNION ALL
    SELECT hour, up_count, total_count, avg_ms * ms_count, ms_count, p95_ms
      FROM check_results_hourly
     WHERE monitor_id = ${monitorId}::uuid AND hour >= date_trunc('hour', ${from}::timestamp)`;
}

export async function monitorStats(monitorId: string, range: Range) {
  const now = Date.now();
  const d30 = since('30d', now);
  const d7 = since('7d', now);
  const d1 = since('24h', now);
  const from = since(range, now);

  const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH s AS (${samples(monitorId, d30)})
    SELECT
      sum(up)    FILTER (WHERE t >= ${d1}) AS up_24h,  sum(total) FILTER (WHERE t >= ${d1}) AS total_24h,
      sum(up)    FILTER (WHERE t >= ${d7}) AS up_7d,   sum(total) FILTER (WHERE t >= ${d7}) AS total_7d,
      sum(up)                              AS up_30d,  sum(total)                           AS total_30d,
      sum(ms_sum) FILTER (WHERE t >= ${from}) / NULLIF(sum(ms_count) FILTER (WHERE t >= ${from}), 0) AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY p95) FILTER (WHERE t >= ${from} AND p95 IS NOT NULL) AS p95_ms,
      sum(total) FILTER (WHERE t >= ${from}) AS checks
    FROM s`;

  const r = row ?? {};
  return {
    range,
    uptime: {
      '24h': pct(Number(r.up_24h ?? 0), Number(r.total_24h ?? 0)),
      '7d': pct(Number(r.up_7d ?? 0), Number(r.total_7d ?? 0)),
      '30d': pct(Number(r.up_30d ?? 0), Number(r.total_30d ?? 0)),
    },
    avgMs: num(r.avg_ms) === null ? null : Math.round(Number(r.avg_ms)),
    p95Ms: num(r.p95_ms) === null ? null : Math.round(Number(r.p95_ms)),
    checks: Number(r.checks ?? 0),
  };
}

// Response time and availability over a range, in evenly sized buckets for the chart.
export async function monitorSeries(monitorId: string, range: Range) {
  const from = since(range);
  const bucket = RANGES[range].bucket;
  const rows = await prisma.$queryRaw<
    { t: Date; up: bigint; total: bigint; ms_sum: number | null; ms_count: bigint }[]
  >`
    WITH s AS (${samples(monitorId, from)})
    SELECT date_bin(${bucket}::interval, t, ${from}::timestamp) AS t,
           sum(up) AS up, sum(total) AS total, sum(ms_sum) AS ms_sum, sum(ms_count) AS ms_count
      FROM s
     GROUP BY 1
     ORDER BY 1`;

  return rows.map((r) => ({
    t: r.t.toISOString(),
    up: Number(r.up),
    total: Number(r.total),
    avgMs: Number(r.ms_count) > 0 ? Math.round(Number(r.ms_sum) / Number(r.ms_count)) : null,
  }));
}

// The last 24 hours of every listed monitor as 24 hourly cells, oldest first, for the
// mini bars on the overview. One query for the whole list.
export async function last24Hours(monitorIds: string[]) {
  const result = new Map<
    string,
    { cells: ({ up: number; total: number } | null)[]; uptime: number | null }
  >();
  if (monitorIds.length === 0) return result;

  const now = new Date();
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - 23);

  const rows = await prisma.$queryRaw<{ monitor_id: string; h: Date; up: bigint; total: bigint }[]>`
    SELECT monitor_id, date_trunc('hour', checked_at) AS h,
           count(*) FILTER (WHERE status = 'up') AS up, count(*) AS total
      FROM check_results
     WHERE monitor_id = ANY(${monitorIds}::uuid[]) AND checked_at >= ${start}
     GROUP BY 1, 2`;

  for (const id of monitorIds) {
    result.set(id, { cells: Array.from({ length: 24 }, () => null), uptime: null });
  }
  const totals = new Map<string, { up: number; total: number }>();
  for (const r of rows) {
    const index = Math.round((r.h.getTime() - start.getTime()) / 3_600_000);
    const entry = result.get(r.monitor_id);
    if (!entry || index < 0 || index > 23) continue;
    entry.cells[index] = { up: Number(r.up), total: Number(r.total) };
    const t = totals.get(r.monitor_id) ?? { up: 0, total: 0 };
    t.up += Number(r.up);
    t.total += Number(r.total);
    totals.set(r.monitor_id, t);
  }
  for (const [id, t] of totals) result.get(id)!.uptime = pct(t.up, t.total);
  return result;
}
