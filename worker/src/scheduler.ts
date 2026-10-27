import { schedulerId, type CheckJob } from '@northstar/shared/queues';
import type { Queue } from 'bullmq';
import { prisma } from './db.js';

// On startup, make Redis agree with the database: every active monitor has exactly one
// repeating job at its interval, and nothing else is scheduled. This repairs any drift
// from a Redis flush or an api that crashed between writing a monitor and scheduling it.
export async function syncSchedulers(queue: Queue<CheckJob>) {
  const active = await prisma.monitor.findMany({
    where: { isActive: true },
    select: { id: true, intervalSec: true },
  });
  const wanted = new Set(active.map((m) => schedulerId(m.id)));

  for (const m of active) {
    await queue.upsertJobScheduler(
      schedulerId(m.id),
      { every: m.intervalSec * 1000 },
      {
        name: 'check',
        data: { monitorId: m.id },
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  const existing = await queue.getJobSchedulers(0, -1);
  let removed = 0;
  for (const s of existing) {
    if (!wanted.has(s.key)) {
      await queue.removeJobScheduler(s.key);
      removed++;
    }
  }
  return { scheduled: active.length, removed };
}
