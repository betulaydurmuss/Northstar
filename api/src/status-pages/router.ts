import { Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { requireAgency, scopedClients } from '../tenancy.js';
import { buildPublicStatus, type PublicStatus } from './public.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const pageInput = z.object({
  title: z.string().trim().min(1, 'Give the page a title').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG, 'Use 3 to 60 lowercase letters, digits and dashes'),
  isPublic: z.boolean(),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOST, 'Enter a host name such as status.harborpine.coffee')
    .nullish()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  monitors: z
    .array(
      z.object({
        monitorId: z.string().uuid(),
        displayName: z.string().trim().max(120).nullish(),
        groupName: z.string().trim().max(80).nullish(),
      }),
    )
    .max(100),
});

// Public pages are read far more than they change; 30 seconds of staleness is invisible
// next to a 60-second check interval and keeps a busy outage from hammering Postgres.
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; body: PublicStatus }>();
export const clearStatusCache = () => cache.clear();

async function publicPage(where: Prisma.StatusPageWhereUniqueInput) {
  const page = await prisma.statusPage.findUnique({
    where,
    include: { monitors: { orderBy: { position: 'asc' } } },
  });
  if (!page || !page.isPublic) throw new HttpError(404, 'This status page does not exist');
  const key = page.id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const body = await buildPublicStatus({
    clientId: page.clientId,
    title: page.title,
    slug: page.slug,
    selection: page.monitors,
  });
  cache.set(key, { at: Date.now(), body });
  return body;
}

// No sign-in: anyone with the link may read a public page.
export function publicRouter() {
  const router = Router();
  router.use(
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }),
  );

  router.get('/status/:slug', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await publicPage({ slug: String(req.params.slug).toLowerCase() }));
  });

  // For status.client.com: the web app asks which page belongs to the host it was served on.
  router.get('/status-host/:host', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await publicPage({ customDomain: String(req.params.host).toLowerCase() }));
  });

  return router;
}

export function statusPagesRouter() {
  const router = Router();
  router.use(requireAuth());

  async function findClient(req: Request) {
    const id = z.string().uuid().safeParse(req.params.clientId);
    const client = id.success
      ? await prisma.client.findFirst({ where: { AND: [{ id: id.data }, scopedClients(req)] } })
      : null;
    if (!client) throw new HttpError(404, 'Client not found');
    return client;
  }

  router.get('/by-client/:clientId', async (req, res) => {
    const client = await findClient(req);
    const page = await prisma.statusPage.findUnique({
      where: { clientId: client.id },
      include: { monitors: { orderBy: { position: 'asc' } } },
    });
    res.json(page);
  });

  // The editor's live preview: every monitor of the client, so the browser can apply
  // the unsaved selection, order and names itself.
  router.get('/by-client/:clientId/preview', async (req, res) => {
    const client = await findClient(req);
    const monitors = await prisma.monitor.findMany({
      where: { clientId: client.id },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    const preview = await buildPublicStatus({
      clientId: client.id,
      title: client.name,
      slug: 'preview',
      selection: monitors.map((m) => ({ monitorId: m.id, displayName: null, groupName: null })),
    });
    res.json({ ...preview, monitorIds: monitors.map((m) => m.id) });
  });

  router.put('/by-client/:clientId', requireAgency, async (req, res) => {
    const client = await findClient(req);
    const input = pageInput.parse(req.body);
    const owned = await prisma.monitor.count({
      where: { id: { in: input.monitors.map((m) => m.monitorId) }, clientId: client.id },
    });
    if (owned !== input.monitors.length) {
      throw new HttpError(400, "A status page can only show this client's own monitors");
    }

    const data = {
      title: input.title,
      slug: input.slug,
      isPublic: input.isPublic,
      customDomain: input.customDomain,
    };
    try {
      const page = await prisma.$transaction(async (tx) => {
        const saved = await tx.statusPage.upsert({
          where: { clientId: client.id },
          create: { clientId: client.id, ...data },
          update: data,
        });
        await tx.statusPageMonitor.deleteMany({ where: { statusPageId: saved.id } });
        await tx.statusPageMonitor.createMany({
          data: input.monitors.map((m, position) => ({
            statusPageId: saved.id,
            monitorId: m.monitorId,
            position,
            displayName: m.displayName || null,
            groupName: m.groupName || null,
          })),
        });
        return tx.statusPage.findUniqueOrThrow({
          where: { id: saved.id },
          include: { monitors: { orderBy: { position: 'asc' } } },
        });
      });
      clearStatusCache();
      res.json(page);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const field = String(err.meta?.target ?? '');
        throw new HttpError(
          409,
          field.includes('custom_domain')
            ? 'Another status page already uses that domain'
            : 'That address is taken; choose another',
        );
      }
      throw err;
    }
  });

  return router;
}
