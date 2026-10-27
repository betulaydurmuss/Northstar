import { prisma } from './db.js';

export const RAW_RETENTION_DAYS = 7;

// Folds raw checks older than seven days into one row per monitor per hour, then deletes
// them, in one transaction so a check is never counted twice or lost. Only whole hours
// are rolled up. Running it again is harmless: rows that already exist are merged.
export async function rollUpOldChecks(now = new Date()) {
  const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 86_400_000);
  cutoff.setUTCMinutes(0, 0, 0);

  return prisma.$transaction(async (tx) => {
    const hours = await tx.$executeRaw`
      INSERT INTO check_results_hourly AS h
             (monitor_id, hour, up_count, total_count, avg_ms, p95_ms, ms_count)
      SELECT monitor_id,
             date_trunc('hour', checked_at),
             count(*) FILTER (WHERE status = 'up'),
             count(*),
             avg(response_ms)::float8,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY response_ms),
             count(response_ms)
        FROM check_results
       -- Maintenance checks never count towards uptime, so they are not carried over.
       WHERE checked_at < ${cutoff} AND NOT maintenance
       GROUP BY 1, 2
      ON CONFLICT (monitor_id, hour) DO UPDATE SET
        up_count    = h.up_count + EXCLUDED.up_count,
        total_count = h.total_count + EXCLUDED.total_count,
        avg_ms      = (COALESCE(h.avg_ms * h.ms_count, 0) + COALESCE(EXCLUDED.avg_ms * EXCLUDED.ms_count, 0))
                      / NULLIF(h.ms_count + EXCLUDED.ms_count, 0),
        p95_ms      = GREATEST(h.p95_ms, EXCLUDED.p95_ms),
        ms_count    = h.ms_count + EXCLUDED.ms_count`;

    const deleted = await tx.$executeRaw`DELETE FROM check_results WHERE checked_at < ${cutoff}`;
    return { hours, deleted, cutoff };
  });
}
