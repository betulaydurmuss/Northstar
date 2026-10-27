import { CHECKS_QUEUE, schedulerId, type CheckJob } from '@northstar/shared/queues';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// What the monitor routes need from the queue. Tests pass an in-memory version, so the
// api's behaviour can be checked without Redis.
export interface CheckScheduler {
  schedule(monitor: { id: string; intervalSec: number }): Promise<void>;
  unschedule(monitorId: string): Promise<void>;
}

export function bullScheduler(redisUrl: string): CheckScheduler {
  let queue: Queue<CheckJob> | undefined;
  // Connect on first use, so starting the api never waits on Redis.
  const q = () =>
    (queue ??= new Queue<CheckJob>(CHECKS_QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    }));

  return {
    async schedule(m) {
      await q().upsertJobScheduler(
        schedulerId(m.id),
        { every: m.intervalSec * 1000, immediately: true },
        {
          name: 'check',
          data: { monitorId: m.id },
          opts: { removeOnComplete: true, removeOnFail: 100 },
        },
      );
    },
    async unschedule(monitorId) {
      await q().removeJobScheduler(schedulerId(monitorId));
    },
  };
}
