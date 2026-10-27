import { readLimited, safeFetch } from '@northstar/shared/fetch';
import { LIMITS, monitorInput, parseHttpTarget } from '@northstar/shared/monitor';
import { assertPublicHost, SsrfError } from '@northstar/shared/net';
import { parse } from 'csv-parse/sync';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { assertClientRoom, assertMonitorRoom, lockOrganization } from '../limits.js';
import { requireAgency, tenant } from '../tenancy.js';
import type { CheckScheduler } from './scheduler.js';

// Bulk import in two steps. Preview parses and checks every row and says what would
// happen; commit takes the rows the person confirmed, checks them all again (the
// browser is not trusted), and creates everything in one transaction or nothing.

export const MAX_IMPORT_ROWS = 500;
const MAX_SITEMAPS = 10;

export type ImportRow = { name: string; url: string; client: string; intervalSec: number };

export type CheckedRow = ImportRow & {
  line: number;
  errors: string[];
  newClient: boolean;
};

const rowShape = z.object({
  name: z.string().trim().max(120).default(''),
  url: z.string().trim().max(2048),
  client: z.string().trim().max(120).default(''),
  intervalSec: z.coerce.number().int().default(LIMITS.intervalSec.default),
});

// "Harbor & Pine Coffee" from https://www.harborpine.coffee/menu when no name is given.
function nameFromUrl(url: string) {
  const parsed = parseHttpTarget(url);
  if (!parsed) return url;
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${parsed.hostname.replace(/^www\./, '')}${path}`.slice(0, 120);
}

export function parseCsv(csv: string): ImportRow[] {
  const records = parse(csv, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
  if (records.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  }
  return records.map((r) => ({
    name: r.name ?? '',
    url: r.url ?? '',
    client: r.client ?? '',
    intervalSec: Number(r.interval || LIMITS.intervalSec.default),
  }));
}

// Runs at most `limit` checks at once, so 500 DNS lookups do not go out together.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

export async function checkRows(rows: ImportRow[], organizationId: string): Promise<CheckedRow[]> {
  const [clients, existing] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { name: true } }),
    prisma.monitor.findMany({ where: { organizationId }, select: { target: true } }),
  ]);
  const clientNames = new Set(clients.map((c) => c.name.toLowerCase()));
  const monitored = new Set(existing.map((m) => m.target));
  const seen = new Set<string>();

  return mapLimit(rows, 10, async (raw, i) => {
    const row = { ...raw, name: raw.name.trim() || nameFromUrl(raw.url.trim()) };
    const errors: string[] = [];

    const parsed = monitorInput.safeParse({
      name: row.name,
      type: 'http',
      target: row.url,
      intervalSec: row.intervalSec,
      timeoutMs: LIMITS.timeoutMs.default,
      retries: LIMITS.retries.default,
    });
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((issue) => issue.message));
    } else {
      const host = parseHttpTarget(parsed.data.target)!.hostname;
      try {
        await assertPublicHost(host, { allowPrivate: config.ALLOW_PRIVATE_TARGETS });
      } catch (err) {
        errors.push(
          err instanceof SsrfError
            ? 'Points at a private or internal address'
            : 'The host name could not be found',
        );
      }
    }

    const url = row.url.trim();
    if (monitored.has(url)) errors.push('Already monitored');
    else if (seen.has(url)) errors.push('Appears twice in this file');
    seen.add(url);

    const client = row.client.trim();
    return {
      ...row,
      url,
      client,
      line: i + 2, // the header is line 1
      errors,
      newClient: Boolean(client) && !clientNames.has(client.toLowerCase()),
    };
  });
}

function extractLocs(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) =>
    m[1]!
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}

async function fetchXml(url: string) {
  const { res } = await safeFetch(url, {
    signal: AbortSignal.timeout(15_000),
    allowPrivate: config.ALLOW_PRIVATE_TARGETS,
    accept: 'application/xml, text/xml, */*',
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(400, `The sitemap answered ${res.status}`);
  }
  return (await readLimited(res, 5 * 1024 * 1024)).text;
}

// Follows a sitemap index one level down, which is how large sites split theirs.
export async function readSitemap(url: string) {
  const parsed = parseHttpTarget(url);
  if (!parsed) throw new HttpError(400, 'Enter a full http:// or https:// address');
  let xml: string;
  try {
    xml = await fetchXml(parsed.toString());
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof SsrfError || (err as Error).cause instanceof SsrfError) {
      throw new HttpError(400, 'Sitemaps cannot be read from private or internal addresses');
    }
    throw new HttpError(400, 'The sitemap could not be downloaded');
  }

  const urls = new Set<string>();
  if (/<sitemapindex[\s>]/i.test(xml)) {
    for (const child of extractLocs(xml).slice(0, MAX_SITEMAPS)) {
      const childXml = await fetchXml(child).catch(() => '');
      for (const loc of extractLocs(childXml)) urls.add(loc);
      if (urls.size >= MAX_IMPORT_ROWS) break;
    }
  } else {
    for (const loc of extractLocs(xml)) urls.add(loc);
  }
  return [...urls].filter((u) => parseHttpTarget(u)).slice(0, MAX_IMPORT_ROWS);
}

export function importRouter(scheduler: CheckScheduler) {
  const router = Router();

  router.post('/import/preview', requireAgency, async (req, res) => {
    const { csv } = z.object({ csv: z.string().max(1024 * 1024) }).parse(req.body);
    const rows = await checkRows(parseCsv(csv), tenant(req).organizationId);
    res.json({ rows, valid: rows.filter((r) => r.errors.length === 0).length });
  });

  router.post('/sitemap/preview', requireAgency, async (req, res) => {
    const { url } = z.object({ url: z.string().trim().max(2048) }).parse(req.body);
    const urls = await readSitemap(url);
    const existing = await prisma.monitor.findMany({
      where: { organizationId: tenant(req).organizationId, target: { in: urls } },
      select: { target: true },
    });
    const monitored = new Set(existing.map((m) => m.target));
    res.json({ urls: urls.map((u) => ({ url: u, alreadyMonitored: monitored.has(u) })) });
  });

  router.post('/import/commit', requireAgency, async (req, res) => {
    const { rows } = z
      .object({ rows: z.array(rowShape).min(1).max(MAX_IMPORT_ROWS) })
      .parse(req.body);
    const { organizationId } = tenant(req);
    const checked = await checkRows(rows, organizationId);
    const invalid = checked.filter((r) => r.errors.length > 0);
    if (invalid.length > 0) {
      res.status(400).json({ error: `${invalid.length} rows have problems`, rows: invalid });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      // Limits are checked under the organization lock, together with the inserts.
      await lockOrganization(tx, organizationId);
      await assertMonitorRoom(tx, organizationId, checked.length);
      await assertClientRoom(
        tx,
        organizationId,
        new Set(checked.filter((r) => r.newClient).map((r) => r.client.toLowerCase())).size,
      );
      const clients = new Map<string, string>();
      for (const c of await tx.client.findMany({ where: { organizationId } })) {
        clients.set(c.name.toLowerCase(), c.id);
      }
      for (const name of new Set(checked.filter((r) => r.newClient).map((r) => r.client))) {
        if (clients.has(name.toLowerCase())) continue;
        const client = await tx.client.create({ data: { organizationId, name } });
        clients.set(name.toLowerCase(), client.id);
      }
      return tx.monitor.createManyAndReturn({
        data: checked.map((r) => ({
          organizationId,
          ownerId: req.auth!.userId,
          clientId: r.client ? clients.get(r.client.toLowerCase()) : null,
          name: r.name,
          target: r.url,
          intervalSec: r.intervalSec,
        })),
      });
    });

    for (const m of created) await scheduler.schedule(m);
    res.status(201).json({
      created: created.length,
      clientsCreated: new Set(checked.filter((r) => r.newClient).map((r) => r.client.toLowerCase()))
        .size,
    });
  });

  return router;
}
