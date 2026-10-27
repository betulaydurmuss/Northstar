import type { CheckOutcome } from './checks/outcome.js';
import { prisma } from './db.js';
import { transition, type MonitorState } from './incidents.js';

export type Recorded = {
  notify: { kind: 'incident-opened' | 'incident-resolved'; incidentId: string } | null;
};

// Stores the check and applies the state machine in one transaction. The monitor row is
// locked first, so if two checks of the same monitor finish together the second sees the
// state the first wrote, and an incident is never opened twice.
export async function recordOutcome(
  monitorId: string,
  outcome: CheckOutcome,
  inMaintenance = false,
): Promise<Recorded> {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ state: MonitorState }[]>`
      SELECT state FROM monitors WHERE id = ${monitorId}::uuid FOR UPDATE`;
    if (!row) return { notify: null };

    const now = new Date();
    await tx.checkResult.create({
      data: {
        monitorId,
        status: outcome.status,
        responseMs: outcome.responseMs,
        statusCode: outcome.statusCode,
        error: outcome.error,
        maintenance: inMaintenance,
        checkedAt: now,
      },
    });

    const t = transition(row.state, outcome.status, inMaintenance);
    await tx.monitor.update({
      where: { id: monitorId },
      data: { state: t.next, lastCheckedAt: now },
    });

    if (t.openIncident) {
      const incident = await tx.incident.create({
        data: { monitorId, startedAt: now, cause: outcome.error ?? 'The check failed' },
      });
      return { notify: { kind: 'incident-opened', incidentId: incident.id } };
    }

    if (t.closeIncident) {
      const open = await tx.incident.findFirst({
        where: { monitorId, resolvedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!open) return { notify: null };
      await tx.incident.update({ where: { id: open.id }, data: { resolvedAt: now } });
      // Closed by the start of maintenance: no "recovered" email for planned work.
      return t.notify
        ? { notify: { kind: 'incident-resolved', incidentId: open.id } }
        : { notify: null };
    }

    return { notify: null };
  });
}
