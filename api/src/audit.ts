import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from './db.js';

// Every admin action goes through here, so the audit log answers who did what, to whom,
// when and from where. It is written after the action succeeds, never before.
export function audit(
  req: Request,
  action: string,
  target: string | null,
  details?: Prisma.InputJsonValue,
) {
  return prisma.auditLog.create({
    data: { actorId: req.auth?.userId ?? null, action, target, ip: req.ip ?? null, details },
  });
}
