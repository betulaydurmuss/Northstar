import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { HttpError } from './http.js';

// The agency's plan caps how many monitors and clients it may have. Each check runs in
// the same transaction as the create it guards, after taking a lock on the organization,
// so two requests arriving together cannot both squeeze into the last free place.

type Db = Prisma.TransactionClient;

export async function lockOrganization(tx: Db, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
}

export async function assertMonitorRoom(tx: Db, organizationId: string, adding = 1) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { planLimits: true, _count: { select: { monitors: true } } },
  });
  const left = org.planLimits.maxMonitors - org._count.monitors;
  if (adding > left) {
    throw new HttpError(
      403,
      left <= 0
        ? `Your ${org.planLimits.name} plan allows ${org.planLimits.maxMonitors} monitors. Remove one or ask us for a larger plan.`
        : `Your ${org.planLimits.name} plan has room for ${left} more monitors; this would add ${adding}.`,
    );
  }
}

export async function assertClientRoom(tx: Db, organizationId: string, adding = 1) {
  if (adding === 0) return;
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { planLimits: true, _count: { select: { clients: true } } },
  });
  if (org._count.clients + adding > org.planLimits.maxClients) {
    throw new HttpError(
      403,
      `Your ${org.planLimits.name} plan allows ${org.planLimits.maxClients} clients. Remove one or ask us for a larger plan.`,
    );
  }
}

// Locks the organization, checks the limit and runs the create, all in one transaction.
export function createWithinLimits<T>(
  organizationId: string,
  check: (tx: Db) => Promise<void>,
  create: (tx: Db) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    await check(tx);
    return create(tx);
  });
}
