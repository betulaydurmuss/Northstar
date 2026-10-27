import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireAdmin } from '../auth/middleware.js';
import { sendPasswordReset } from '../auth/router.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import type { SystemProbe } from './probe.js';

const startedAt = Date.now();

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function findUser(req: Request) {
  const id = z.string().uuid().safeParse(req.params.id);
  const user = id.success ? await prisma.user.findUnique({ where: { id: id.data } }) : null;
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}

// The platform's own console. Every route needs a super_admin who has passed two-factor,
// and every change is written to the audit log with the admin and their IP address.
export function adminRouter(probe: SystemProbe) {
  const router = Router();
  // Applied once to the whole router, so no admin endpoint can be added without it.
  router.use(requireAdmin);

  router.get('/overview', async (_req, res) => {
    const [users, monitors] = await Promise.all([prisma.user.count(), prisma.monitor.count()]);
    res.json({ users, monitors });
  });

  router.get('/users', async (req, res) => {
    const q = page.extend({ q: z.string().trim().max(200).optional() }).parse(req.query);
    const where = q.q
      ? {
          OR: [
            { email: { contains: q.q, mode: 'insensitive' as const } },
            { name: { contains: q.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: {
          membership: {
            select: { role: true, organization: { select: { id: true, name: true, plan: true } } },
          },
          sessions: { orderBy: { lastUsedAt: 'desc' }, take: 1, select: { lastUsedAt: true } },
        },
      }),
    ]);
    res.json({
      total,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        membership: u.membership,
        twoFactorEnabled: u.totpEnabled,
        lockedUntil: u.lockedUntil,
        suspendedAt: u.suspendedAt,
        createdAt: u.createdAt,
        lastActiveAt: u.sessions[0]?.lastUsedAt ?? null,
      })),
    });
  });

  router.get('/users/:id', async (req, res) => {
    const user = await findUser(req);
    const [sessions, history, membership] = await Promise.all([
      prisma.session.count({
        where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      prisma.auditLog.findMany({
        where: { target: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { actor: { select: { email: true } } },
      }),
      prisma.membership.findUnique({
        where: { userId: user.id },
        include: { organization: true, client: { select: { name: true } } },
      }),
    ]);
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorEnabled: user.totpEnabled,
      suspendedAt: user.suspendedAt,
      lockedUntil: user.lockedUntil,
      createdAt: user.createdAt,
      activeSessions: sessions,
      membership,
      history: history.map((h) => ({ ...h, id: h.id.toString() })),
    });
  });

  router.post('/users/:id/suspend', async (req, res) => {
    const user = await findUser(req);
    if (user.id === req.auth!.userId) throw new HttpError(400, 'You cannot suspend yourself');
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    // Suspension takes effect now, not when the current access token runs out.
    await revokeAllSessions(user.id);
    await audit(req, 'user.suspend', user.id, { email: user.email });
    res.status(204).end();
  });

  router.post('/users/:id/activate', async (req, res) => {
    const user = await findUser(req);
    await prisma.user.update({
      where: { id: user.id },
      data: { suspendedAt: null, failedLogins: 0, lockedUntil: null },
    });
    await audit(req, 'user.activate', user.id, { email: user.email });
    res.status(204).end();
  });

  router.post('/users/:id/password-reset', async (req, res) => {
    const user = await findUser(req);
    await sendPasswordReset(user);
    await audit(req, 'user.password_reset', user.id, { email: user.email });
    res.status(204).end();
  });

  router.get('/organizations', async (_req, res) => {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        planLimits: true,
        _count: { select: { monitors: true, clients: true, memberships: true } },
      },
    });
    res.json(
      orgs.map((o) => ({
        id: o.id,
        name: o.name,
        plan: o.plan,
        createdAt: o.createdAt,
        monitors: o._count.monitors,
        clients: o._count.clients,
        members: o._count.memberships,
        limits: { maxMonitors: o.planLimits.maxMonitors, maxClients: o.planLimits.maxClients },
      })),
    );
  });

  router.patch('/organizations/:id', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const { plan } = z.object({ plan: z.string().min(1) }).parse(req.body);
    const org = id.success
      ? await prisma.organization.findUnique({ where: { id: id.data } })
      : null;
    if (!org) throw new HttpError(404, 'Organization not found');
    if (!(await prisma.plan.findUnique({ where: { id: plan } }))) {
      throw new HttpError(400, 'No such plan');
    }
    await prisma.organization.update({ where: { id: org.id }, data: { plan } });
    await audit(req, 'organization.plan', org.id, { name: org.name, from: org.plan, to: plan });
    res.status(204).end();
  });

  router.get('/plans', async (_req, res) => {
    res.json(await prisma.plan.findMany({ orderBy: { maxMonitors: 'asc' } }));
  });

  router.patch('/plans/:id', async (req, res) => {
    const body = z
      .object({
        maxMonitors: z.coerce.number().int().min(1).max(100_000),
        maxClients: z.coerce.number().int().min(1).max(10_000),
      })
      .parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { id: String(req.params.id) } });
    if (!plan) throw new HttpError(404, 'Plan not found');
    const updated = await prisma.plan.update({ where: { id: plan.id }, data: body });
    await audit(req, 'plan.update', plan.id, {
      from: { maxMonitors: plan.maxMonitors, maxClients: plan.maxClients },
      to: body,
    });
    res.json(updated);
  });

  router.get('/audit-logs', async (req, res) => {
    const q = page.extend({ action: z.string().max(60).optional() }).parse(req.query);
    const where = q.action ? { action: q.action } : {};
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: { actor: { select: { email: true } } },
      }),
    ]);
    res.json({ total, entries: entries.map((e) => ({ ...e, id: e.id.toString() })) });
  });

  router.get('/system/health', async (_req, res) => {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [queues, redisMemory, checks, failed, activeMonitors, openIncidents, [db]] =
      await Promise.all([
        probe.queues().catch(() => null),
        probe.redisMemory().catch(() => null),
        prisma.checkResult.count({ where: { checkedAt: { gte: dayAgo } } }),
        prisma.checkResult.count({ where: { checkedAt: { gte: dayAgo }, status: 'down' } }),
        prisma.monitor.count({ where: { isActive: true } }),
        prisma.incident.count({ where: { resolvedAt: null } }),
        prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      ]);
    res.json({
      api: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), node: process.version },
      // null means Redis did not answer, which the page shows as a problem.
      queues,
      workersOnline: queues ? Math.max(0, ...queues.map((q) => q.workers)) : null,
      redisMemory,
      checks24h: checks,
      failedChecks24h: failed,
      activeMonitors,
      openIncidents,
      databaseBytes: Number(db?.size ?? 0),
    });
  });

  return router;
}
