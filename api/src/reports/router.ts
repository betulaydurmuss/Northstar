import { REPORTS_QUEUE, type ReportJob } from '@northstar/shared/queues';
import { Queue } from 'bullmq';
import { Router, type Request } from 'express';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { REPORTS_DIR } from '../files.js';
import { HttpError } from '../http.js';
import { requireAgency, scopedClients } from '../tenancy.js';

// Rendering a PDF takes a headless browser and a few seconds, so the api only queues the
// work; the worker renders and stores it, and the page polls until it is ready.
export interface ReportQueue {
  enqueue(job: ReportJob): Promise<void>;
}

export function bullReportQueue(redisUrl: string): ReportQueue {
  let queue: Queue<ReportJob> | undefined;
  return {
    async enqueue(job) {
      queue ??= new Queue<ReportJob>(REPORTS_QUEUE, {
        connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      });
      await queue.add('render', job, { attempts: 2, removeOnComplete: true, removeOnFail: 100 });
    },
  };
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// A report covers a month that has already ended.
function lastCompleteMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

export function reportsRouter(queue: ReportQueue) {
  const router = Router();
  router.use(requireAuth());

  async function findReport(req: Request) {
    const id = z.string().uuid().safeParse(req.params.id);
    const report = id.success
      ? await prisma.report.findFirst({ where: { id: id.data, client: scopedClients(req) } })
      : null;
    if (!report) throw new HttpError(404, 'Report not found');
    return report;
  }

  router.get('/', async (req, res) => {
    const q = z.object({ clientId: z.string().uuid().optional() }).parse(req.query);
    const reports = await prisma.report.findMany({
      where: { AND: [q.clientId ? { clientId: q.clientId } : {}, { client: scopedClients(req) }] },
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    res.json(
      reports.map((r) => ({
        id: r.id,
        client: r.client,
        period: r.period,
        status: r.status,
        error: r.error,
        createdAt: r.createdAt,
        sentAt: r.sentAt,
      })),
    );
  });

  // Creating a report for a month that already has one renders it again.
  router.post('/', requireAgency, async (req, res) => {
    const body = z
      .object({
        clientId: z.string().uuid(),
        period: z.string().regex(PERIOD, 'Use YYYY-MM').default(lastCompleteMonth()),
      })
      .parse(req.body);
    if (body.period > new Date().toISOString().slice(0, 7)) {
      throw new HttpError(400, 'Choose a month that has started');
    }
    const client = await prisma.client.findFirst({
      where: { AND: [{ id: body.clientId }, scopedClients(req)] },
    });
    if (!client) throw new HttpError(404, 'Client not found');

    const report = await prisma.report.upsert({
      where: { clientId_period: { clientId: client.id, period: body.period } },
      create: { clientId: client.id, period: body.period },
      update: { status: 'queued', error: null },
    });
    await queue.enqueue({ reportId: report.id, send: false });
    res.status(202).json(report);
  });

  router.get('/:id/pdf', async (req, res) => {
    const report = await findReport(req);
    if (report.status !== 'ready' || !report.filePath) {
      throw new HttpError(409, 'This report is not ready yet');
    }
    const client = await prisma.client.findUniqueOrThrow({ where: { id: report.clientId } });
    const filename = `${client.name.replace(/[^\w-]+/g, '-')}-${report.period}-uptime-report.pdf`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(report.filePath, { root: REPORTS_DIR }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Report file is missing' });
    });
  });

  return router;
}
