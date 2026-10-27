import {
  monitorInput,
  monitorPatch,
  parseHttpTarget,
  parsePingTarget,
  usesHttp,
  type MonitorInput,
} from '@northstar/shared/monitor';
import { assertPublicHost, SsrfError } from '@northstar/shared/net';
import type { Client, Monitor } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { requireAgency, scoped, tenant } from '../tenancy.js';
import { importRouter } from './import.js';
import type { CheckScheduler } from './scheduler.js';
import { last24Hours, monitorSeries, monitorStats, RANGES, type Range } from './stats.js';

const rangeQuery = z.object({
  range: z.enum(Object.keys(RANGES) as [Range, ...Range[]]).default('24h'),
});

function hostOf(m: Pick<MonitorInput, 'type' | 'target'>) {
  return usesHttp(m.type) ? parseHttpTarget(m.target)!.hostname : parsePingTarget(m.target)!.host;
}

// Checked when a monitor is saved, and again by the worker before every request,
// because what a name resolves to can change after it was saved.
export async function assertReachable(m: Pick<MonitorInput, 'type' | 'target'>) {
  try {
    await assertPublicHost(hostOf(m), { allowPrivate: config.ALLOW_PRIVATE_TARGETS });
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new HttpError(400, 'Monitors cannot point at private or internal addresses');
    }
    throw new HttpError(400, 'That host name could not be found');
  }
}

// A monitor can only be put in a client of the same agency.
export async function assertClientInOrganization(clientId: string | null, organizationId: string) {
  if (!clientId) return;
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } });
  if (!client) throw new HttpError(400, 'That client does not exist');
}

// When a monitor stops describing what it described (paused, or pointed elsewhere), an
// outage still open for it ends there; otherwise resuming would open a second one.
function closeOpenIncidents(monitorId: string) {
  return prisma.incident.updateMany({
    where: { monitorId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

type WithClient = Monitor & { client?: Pick<Client, 'id' | 'name' | 'brandColor'> | null };

export function serialize(m: WithClient) {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    target: m.target,
    intervalSec: m.intervalSec,
    timeoutMs: m.timeoutMs,
    retries: m.retries,
    clientId: m.clientId,
    client: m.client ?? null,
    keyword: m.keyword,
    keywordMode: m.keywordMode,
    keywordCaseSensitive: m.keywordCaseSensitive,
    isActive: m.isActive,
    state: m.state,
    lastCheckedAt: m.lastCheckedAt,
    createdAt: m.createdAt,
  };
}

const withClient = { client: { select: { id: true, name: true, brandColor: true } } };

export function monitorsRouter(scheduler: CheckScheduler) {
  const router = Router();
  router.use(requireAuth());
  router.use(importRouter(scheduler));

  // Every lookup goes through here: a monitor in another agency, or in another client
  // for a client viewer, is indistinguishable from one that does not exist.
  async function findScoped(req: Request) {
    const id = z.string().uuid().safeParse(req.params.id);
    const monitor = id.success
      ? await prisma.monitor.findFirst({
          where: { id: id.data, ...scoped(req) },
          include: withClient,
        })
      : null;
    if (!monitor) throw new HttpError(404, 'Monitor not found');
    return monitor;
  }

  router.get('/', async (req, res) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    const monitors = await prisma.monitor.findMany({
      // AND: the filter can only narrow the tenant scope, never replace part of it.
      where: { AND: [q.clientId ? { clientId: q.clientId } : {}, scoped(req)] },
      include: withClient,
      orderBy: { name: 'asc' },
    });
    const recent = await last24Hours(monitors.map((m) => m.id));
    res.json(
      monitors.map((m) => ({
        ...serialize(m),
        last24h: recent.get(m.id)?.cells ?? [],
        uptime24h: recent.get(m.id)?.uptime ?? null,
      })),
    );
  });

  router.get('/:id/stats', async (req, res) => {
    const monitor = await findScoped(req);
    const { range } = rangeQuery.parse(req.query);
    res.json(await monitorStats(monitor.id, range));
  });

  router.get('/:id/series', async (req, res) => {
    const monitor = await findScoped(req);
    const { range } = rangeQuery.parse(req.query);
    res.json(await monitorSeries(monitor.id, range));
  });

  // Raw checks, newest first. Older than seven days they have been rolled up, so the
  // window is capped there.
  router.get('/:id/checks', async (req, res) => {
    const monitor = await findScoped(req);
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50),
      })
      .parse(req.query);
    const checks = await prisma.checkResult.findMany({
      where: { monitorId: monitor.id, checkedAt: { gte: q.from, lte: q.to } },
      orderBy: { checkedAt: 'desc' },
      take: q.limit,
    });
    res.json(checks.map((c) => ({ ...c, id: c.id.toString() })));
  });

  router.post('/', requireAgency, async (req, res) => {
    const input = monitorInput.parse(req.body);
    const { organizationId } = tenant(req);
    await assertClientInOrganization(input.clientId, organizationId);
    await assertReachable(input);
    const monitor = await prisma.monitor.create({
      data: { ...input, ownerId: req.auth!.userId, organizationId },
      include: withClient,
    });
    await scheduler.schedule(monitor);
    res.status(201).json(serialize(monitor));
  });

  router.get('/:id', async (req, res) => {
    res.json(serialize(await findScoped(req)));
  });

  router.patch('/:id', requireAgency, async (req, res) => {
    const existing = await findScoped(req);
    const change = monitorPatch.parse(req.body);
    // Validate the result of the change as a whole, so a new timeout is checked
    // against the interval that will actually apply.
    const merged = monitorInput.parse({ ...existing, ...change });
    await assertClientInOrganization(merged.clientId, existing.organizationId);
    const retargeted = merged.target !== existing.target || merged.type !== existing.type;
    if (retargeted) await assertReachable(merged);
    const monitor = await prisma.monitor.update({
      where: { id: existing.id },
      // A changed address starts fresh: the old state described a different target.
      data: { ...merged, ...(retargeted ? { state: 'pending' as const } : {}) },
      include: withClient,
    });
    if (retargeted) await closeOpenIncidents(monitor.id);
    if (monitor.isActive) await scheduler.schedule(monitor);
    res.json(serialize(monitor));
  });

  router.delete('/:id', requireAgency, async (req, res) => {
    const monitor = await findScoped(req);
    await prisma.monitor.delete({ where: { id: monitor.id } });
    await scheduler.unschedule(monitor.id);
    res.status(204).end();
  });

  router.post('/:id/pause', requireAgency, async (req, res) => {
    const existing = await findScoped(req);
    const monitor = await prisma.monitor.update({
      where: { id: existing.id },
      data: { isActive: false, state: 'paused' },
      include: withClient,
    });
    await scheduler.unschedule(monitor.id);
    await closeOpenIncidents(monitor.id);
    res.json(serialize(monitor));
  });

  router.post('/:id/resume', requireAgency, async (req, res) => {
    const existing = await findScoped(req);
    const monitor = await prisma.monitor.update({
      where: { id: existing.id },
      data: { isActive: true, state: 'pending' },
      include: withClient,
    });
    await scheduler.schedule(monitor);
    res.json(serialize(monitor));
  });

  return router;
}
