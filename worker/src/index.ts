import {
  CHECKS_QUEUE,
  MAINTENANCE_QUEUE,
  NOTIFICATIONS_QUEUE,
  schedulerId,
  type CheckJob,
  type NotificationJob,
} from '@northstar/shared/queues';
import { Queue, Worker } from 'bullmq';
import { runCheck } from './checks/run.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { sendIncidentEmail } from './notify/email.js';
import { ensureExpiryData, refreshAndWarn } from './expiry.js';
import { recordOutcome } from './record.js';
import { createRedis } from './redis.js';
import { rollUpOldChecks } from './rollup.js';
import { syncSchedulers } from './scheduler.js';

const connection = createRedis();
const checks = new Queue<CheckJob>(CHECKS_QUEUE, { connection });
const notifications = new Queue<NotificationJob>(NOTIFICATIONS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: 500,
  },
});

const checkWorker = new Worker<CheckJob>(
  CHECKS_QUEUE,
  async (job) => {
    const monitor = await prisma.monitor.findUnique({ where: { id: job.data.monitorId } });
    // Deleted or paused since this job was scheduled: stop scheduling it.
    if (!monitor || !monitor.isActive) {
      await checks.removeJobScheduler(schedulerId(job.data.monitorId));
      return;
    }
    const outcome = await runCheck(monitor, { allowPrivate: config.ALLOW_PRIVATE_TARGETS });
    const { notify } = await recordOutcome(monitor.id, outcome);
    if (notify) await notifications.add(notify.kind, notify);
    // A failed certificate or RDAP lookup must not fail the check that triggered it.
    await ensureExpiryData(monitor).catch((err: Error) =>
      console.error(`expiry data for ${monitor.id}: ${err.message}`),
    );
  },
  { connection, concurrency: config.CHECK_CONCURRENCY },
);

const notifyWorker = new Worker<NotificationJob>(
  NOTIFICATIONS_QUEUE,
  (job) => sendIncidentEmail(job.data),
  { connection },
);

const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
const maintenanceWorker = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === 'rollup') {
      const { hours, deleted } = await rollUpOldChecks();
      console.log(`rollup: ${deleted} checks folded into ${hours} hourly rows`);
    }
    if (job.name === 'expiry') {
      const { monitors, warned } = await refreshAndWarn();
      console.log(`expiry: ${monitors} monitors refreshed, ${warned} warnings sent`);
    }
  },
  { connection },
);
// 03:00 UTC, the quietest hour for most of our customers.
await maintenance.upsertJobScheduler(
  'nightly-rollup',
  { pattern: '0 3 * * *', tz: 'UTC' },
  { name: 'rollup', opts: { removeOnComplete: true, removeOnFail: 50 } },
);
// Once a day: re-read certificates and domain registrations, send 30/15/7/1-day warnings.
await maintenance.upsertJobScheduler(
  'daily-expiry',
  { pattern: '0 4 * * *', tz: 'UTC' },
  { name: 'expiry', opts: { removeOnComplete: true, removeOnFail: 50 } },
);

for (const w of [checkWorker, notifyWorker, maintenanceWorker]) {
  w.on('failed', (job, err) => console.error(`${w.name} job ${job?.id} failed: ${err.message}`));
}

const synced = await syncSchedulers(checks);
console.log(
  `worker ready: ${synced.scheduled} monitors scheduled, ${synced.removed} stale removed`,
);
if (config.ALLOW_PRIVATE_TARGETS) {
  console.warn('ALLOW_PRIVATE_TARGETS is on: monitors may reach private addresses.');
}

async function shutdown() {
  await Promise.all([checkWorker.close(), notifyWorker.close(), maintenanceWorker.close()]);
  await Promise.all([checks.close(), notifications.close(), maintenance.close()]);
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
