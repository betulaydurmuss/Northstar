import {
  CHECKS_QUEUE,
  MAINTENANCE_QUEUE,
  NOTIFICATIONS_QUEUE,
  REPORTS_QUEUE,
} from '@northstar/shared/queues';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export type QueueHealth = {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  // Worker processes currently connected to this queue.
  workers: number;
};

// What the admin panel's system page asks of Redis. Tests pass a fixed version.
export interface SystemProbe {
  queues(): Promise<QueueHealth[]>;
  redisMemory(): Promise<string | null>;
}

export function bullProbe(redisUrl: string): SystemProbe {
  let connection: Redis | undefined;
  const queues = new Map<string, Queue>();
  const conn = () => (connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null }));
  const queue = (name: string) => {
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: conn() });
      queues.set(name, q);
    }
    return q;
  };

  return {
    async queues() {
      const names = [CHECKS_QUEUE, NOTIFICATIONS_QUEUE, REPORTS_QUEUE, MAINTENANCE_QUEUE];
      return Promise.all(
        names.map(async (name) => {
          const q = queue(name);
          const [counts, workers] = await Promise.all([
            q.getJobCounts('waiting', 'active', 'delayed', 'failed'),
            q.getWorkers(),
          ]);
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            workers: workers.length,
          };
        }),
      );
    },
    async redisMemory() {
      const info = await conn().info('memory');
      return /used_memory_human:(\S+)/.exec(info)?.[1] ?? null;
    },
  };
}
