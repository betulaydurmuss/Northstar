import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { clearStatusCache } from '../status-pages/router.js';
import { requireAgency, scopedByMonitor, scopedClients } from '../tenancy.js';

const windowInput = z
  .object({
    clientId: z.string().uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    message: z.string().trim().min(1, 'Say what is happening').max(500),
  })
  .refine((w) => w.endsAt > w.startsAt, {
    path: ['endsAt'],
    message: 'The window must end after it starts',
  })
  .refine((w) => w.endsAt.getTime() - w.startsAt.getTime() <= 7 * 86_400_000, {
    path: ['endsAt'],
    message: 'Keep a maintenance window under a week',
  });

// Planned maintenance, per client: while a window is open, checks still run but are
// marked as maintenance, nobody is alerted, and the time is left out of SLA figures.
export function maintenanceRouter() {
  const router = Router();
  router.use(requireAuth());

  async function assertClient(req: Request, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { AND: [{ id: clientId }, scopedClients(req)] },
    });
    if (!client) throw new HttpError(404, 'Client not found');
  }

  router.get('/', async (req, res) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    const windows = await prisma.maintenanceWindow.findMany({
      where: {
        AND: [q.clientId ? { clientId: q.clientId } : {}, { client: scopedClients(req) }],
        endsAt: { gt: new Date(Date.now() - 30 * 86_400_000) },
      },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'desc' },
    });
    res.json(windows);
  });

  router.post('/', requireAgency, async (req, res) => {
    const input = windowInput.parse(req.body);
    await assertClient(req, input.clientId);
    const window = await prisma.maintenanceWindow.create({ data: input });
    clearStatusCache();
    res.status(201).json(window);
  });

  router.delete('/:id', requireAgency, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const window = id.success
      ? await prisma.maintenanceWindow.findFirst({
          where: { id: id.data, client: scopedClients(req) },
        })
      : null;
    if (!window) throw new HttpError(404, 'Maintenance window not found');
    await prisma.maintenanceWindow.delete({ where: { id: window.id } });
    clearStatusCache();
    res.status(204).end();
  });

  return router;
}

// Public updates on an incident: investigating, identified, monitoring, resolved.
export function incidentUpdatesRouter() {
  const router = Router();
  router.use(requireAuth());

  router.post('/:id/updates', requireAgency, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z
      .object({
        status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
        message: z.string().trim().min(1, 'Write a short update').max(1000),
      })
      .parse(req.body);
    const incident = id.success
      ? await prisma.incident.findFirst({ where: { id: id.data, ...scopedByMonitor(req) } })
      : null;
    if (!incident) throw new HttpError(404, 'Incident not found');
    const update = await prisma.incidentUpdate.create({
      data: { incidentId: incident.id, ...body },
    });
    clearStatusCache();
    res.status(201).json(update);
  });

  return router;
}
