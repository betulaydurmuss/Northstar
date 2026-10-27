import type { Monitor } from '@prisma/client';
import { prisma } from './db.js';

// Planned maintenance is set per client: every monitor of that client is covered.
export async function inMaintenance(m: Pick<Monitor, 'clientId'>, at = new Date()) {
  if (!m.clientId) return false;
  const window = await prisma.maintenanceWindow.findFirst({
    where: { clientId: m.clientId, startsAt: { lte: at }, endsAt: { gt: at } },
    select: { id: true },
  });
  return window !== null;
}
