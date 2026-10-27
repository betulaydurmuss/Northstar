import type { Client } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { deleteLogo, logoUrl, MAX_LOGO_BYTES, saveLogo } from '../files.js';
import { HttpError } from '../http.js';
import { assertClientRoom, createWithinLimits } from '../limits.js';
import { requireAgency, scopedClients, tenant } from '../tenancy.js';

const clientInput = z.object({
  name: z.string().trim().min(1, 'Give the client a name').max(120),
  contactEmail: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .max(254)
    .nullish()
    .or(z.literal('').transform(() => null)),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #2F6FEB')
    .optional(),
});

// Memory storage: the file is checked byte by byte before anything touches the disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

function serialize(c: Client) {
  return {
    id: c.id,
    name: c.name,
    contactEmail: c.contactEmail,
    brandColor: c.brandColor,
    logoUrl: logoUrl(c.logoPath),
    createdAt: c.createdAt,
  };
}

// Monitors, monitors down now, and 30-day uptime for each client, in two queries.
async function clientSummaries(organizationId: string, clientIds: string[]) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [counts, uptime] = await Promise.all([
    prisma.monitor.groupBy({
      by: ['clientId', 'state'],
      where: { organizationId, clientId: { in: clientIds } },
      _count: true,
    }),
    clientIds.length
      ? prisma.$queryRaw<{ client_id: string; up: bigint; total: bigint }[]>`
          SELECT m.client_id, sum(s.up) AS up, sum(s.total) AS total
            FROM monitors m
            JOIN (
              SELECT monitor_id, (status = 'up')::int AS up, 1 AS total
                FROM check_results WHERE checked_at >= ${since} AND NOT maintenance
              UNION ALL
              SELECT monitor_id, up_count, total_count
                FROM check_results_hourly WHERE hour >= ${since}
            ) s ON s.monitor_id = m.id
           WHERE m.organization_id = ${organizationId}::uuid
             AND m.client_id IN (${Prisma.join(clientIds.map((id) => Prisma.sql`${id}::uuid`))})
           GROUP BY m.client_id`
      : [],
  ]);

  const result = new Map<string, { monitors: number; down: number; uptime30d: number | null }>();
  for (const id of clientIds) result.set(id, { monitors: 0, down: 0, uptime30d: null });
  for (const c of counts) {
    const entry = c.clientId ? result.get(c.clientId) : undefined;
    if (!entry) continue;
    entry.monitors += c._count;
    if (c.state === 'down') entry.down += c._count;
  }
  for (const u of uptime) {
    const entry = result.get(u.client_id);
    if (entry && Number(u.total) > 0) entry.uptime30d = (Number(u.up) / Number(u.total)) * 100;
  }
  return result;
}

export function clientsRouter() {
  const router = Router();
  router.use(requireAuth());

  async function findScoped(req: Request) {
    const id = z.string().uuid().safeParse(req.params.id);
    const client = id.success
      ? await prisma.client.findFirst({ where: { AND: [{ id: id.data }, scopedClients(req)] } })
      : null;
    if (!client) throw new HttpError(404, 'Client not found');
    return client;
  }

  function nameTaken(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  router.get('/', async (req, res) => {
    const clients = await prisma.client.findMany({
      where: scopedClients(req),
      orderBy: { name: 'asc' },
    });
    const summaries = await clientSummaries(
      tenant(req).organizationId,
      clients.map((c) => c.id),
    );
    res.json(clients.map((c) => ({ ...serialize(c), ...summaries.get(c.id) })));
  });

  router.get('/:id', async (req, res) => {
    const client = await findScoped(req);
    const summary = await clientSummaries(client.organizationId, [client.id]);
    res.json({ ...serialize(client), ...summary.get(client.id) });
  });

  router.post('/', requireAgency, async (req, res) => {
    const input = clientInput.parse(req.body);
    const { organizationId } = tenant(req);
    try {
      const client = await createWithinLimits(
        organizationId,
        (tx) => assertClientRoom(tx, organizationId),
        (tx) => tx.client.create({ data: { ...input, organizationId } }),
      );
      res.status(201).json(serialize(client));
    } catch (err) {
      if (nameTaken(err)) throw new HttpError(409, 'A client with this name already exists');
      throw err;
    }
  });

  router.patch('/:id', requireAgency, async (req, res) => {
    const existing = await findScoped(req);
    const input = clientInput.partial().parse(req.body);
    try {
      const client = await prisma.client.update({ where: { id: existing.id }, data: input });
      res.json(serialize(client));
    } catch (err) {
      if (nameTaken(err)) throw new HttpError(409, 'A client with this name already exists');
      throw err;
    }
  });

  // The client's monitors stay, ungrouped; deleting a client never deletes monitoring.
  router.delete('/:id', requireAgency, async (req, res) => {
    const client = await findScoped(req);
    await prisma.client.delete({ where: { id: client.id } });
    await deleteLogo(client.logoPath);
    res.status(204).end();
  });

  router.post('/:id/logo', requireAgency, upload.single('logo'), async (req, res) => {
    const client = await findScoped(req);
    if (!req.file) throw new HttpError(400, 'Choose an image to upload');
    const name = await saveLogo(client.id, req.file.buffer);
    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { logoPath: name },
    });
    await deleteLogo(client.logoPath);
    res.json(serialize(updated));
  });

  router.delete('/:id/logo', requireAgency, async (req, res) => {
    const client = await findScoped(req);
    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { logoPath: null },
    });
    await deleteLogo(client.logoPath);
    res.json(serialize(updated));
  });

  return router;
}
