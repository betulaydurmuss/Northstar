import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { requireAgency, scoped } from '../tenancy.js';

const DAY = 86_400_000;
const daysLeft = (d: Date | null) => (d ? Math.ceil((d.getTime() - Date.now()) / DAY) : null);

// Certificates and domain registrations on one list, the soonest to run out first.
export function expirationsRouter() {
  const router = Router();
  // Mounted at /api, so authentication is per route: router.use would also catch
  // unknown paths and answer 401 where a 404 is right.

  router.get('/expirations', requireAuth(), async (req, res) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    // AND, not object spread: the query filter and the tenant scope both apply, so a
    // client viewer asking for another client gets nothing rather than their own data.
    const byClient = q.clientId ? { clientId: q.clientId } : {};

    const [certificates, domains] = await Promise.all([
      prisma.certificate.findMany({
        where: { monitor: { AND: [byClient, scoped(req)] } },
        include: {
          monitor: {
            select: {
              id: true,
              name: true,
              target: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.domain.findMany({
        where: { AND: [byClient, scoped(req)] },
        include: { client: { select: { id: true, name: true } } },
      }),
    ]);

    const items = [
      ...certificates.map((c) => ({
        kind: 'certificate' as const,
        id: c.monitorId,
        name: new URL(c.monitor.target).hostname,
        monitor: { id: c.monitor.id, name: c.monitor.name },
        client: c.monitor.client,
        expiresAt: c.validTo,
        daysLeft: daysLeft(c.validTo),
        detail: c.issuer,
        error: c.authorized ? null : c.error,
        source: null,
        checkedAt: c.checkedAt,
      })),
      ...domains.map((d) => ({
        kind: 'domain' as const,
        id: d.id,
        name: d.domain,
        monitor: null,
        client: d.client,
        expiresAt: d.expiresAt,
        daysLeft: daysLeft(d.expiresAt),
        detail: d.source === 'manual' ? 'Entered by hand' : 'From the registry (RDAP)',
        error: d.error,
        source: d.source,
        checkedAt: d.checkedAt,
      })),
    ];
    // Unknown dates sort last: they need attention, but not before a real deadline.
    items.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
    res.json(items);
  });

  // For registries without RDAP (.tr, among others) the date is typed in by hand.
  // Sending null hands the domain back to automatic lookups.
  router.patch('/domains/:id', requireAuth(), requireAgency, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ expiresAt: z.coerce.date().nullable() }).parse(req.body);
    const domain = id.success
      ? await prisma.domain.findFirst({ where: { id: id.data, ...scoped(req) } })
      : null;
    if (!domain) throw new HttpError(404, 'Domain not found');

    const updated = await prisma.domain.update({
      where: { id: domain.id },
      data: body.expiresAt
        ? { expiresAt: body.expiresAt, source: 'manual', error: null, checkedAt: new Date() }
        : { expiresAt: null, source: 'rdap', checkedAt: null },
    });
    res.json(updated);
  });

  return router;
}
