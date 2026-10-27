import {
  CHECKS_QUEUE,
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
import { recordOutcome } from './record.js';
import { createRedis } from './redis.js';
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
  },
  { connection, concurrency: config.CHECK_CONCURRENCY },
);

const notifyWorker = new Worker<NotificationJob>(
  NOTIFICATIONS_QUEUE,
  (job) => sendIncidentEmail(job.data),
  { connection },
);

for (const w of [checkWorker, notifyWorker]) {
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
  await Promise.all([checkWorker.close(), notifyWorker.close()]);
  await Promise.all([checks.close(), notifications.close()]);
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
