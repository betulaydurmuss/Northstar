import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { scopedByMonitor } from '../tenancy.js';

export function incidentsRouter() {
  const router = Router();
  router.use(requireAuth());

  // Incident history across the caller's monitors, newest first.
  router.get('/', async (req, res) => {
    const q = z
      .object({
        monitorId: z.string().uuid().optional(),
        status: z.enum(['all', 'ongoing', 'resolved']).default('all'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    const incidents = await prisma.incident.findMany({
      where: {
        // Scoped through the monitor, so a foreign monitorId returns nothing.
        ...scopedByMonitor(req),
        ...(q.monitorId ? { monitorId: q.monitorId } : {}),
        ...(q.status === 'ongoing' ? { resolvedAt: null } : {}),
        ...(q.status === 'resolved' ? { resolvedAt: { not: null } } : {}),
      },
      include: {
        monitor: { select: { id: true, name: true } },
        updates: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { startedAt: 'desc' },
      take: q.limit,
    });

    const now = Date.now();
    res.json(
      incidents.map((i) => ({
        id: i.id,
        monitor: i.monitor,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        cause: i.cause,
        updates: i.updates.map((u) => ({
          id: u.id,
          status: u.status,
          message: u.message,
          createdAt: u.createdAt,
        })),
        durationMs: (i.resolvedAt?.getTime() ?? now) - i.startedAt.getTime(),
      })),
    );
  });

  return router;
}
