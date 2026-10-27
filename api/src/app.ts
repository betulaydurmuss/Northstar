import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { bullProbe, type SystemProbe } from './admin/probe.js';
import { adminRouter } from './admin/router.js';
import { authRouter } from './auth/router.js';
import { defaultAuthLimits, type AuthLimits } from './auth/rate-limit.js';
import { clientsRouter } from './clients/router.js';
import { config } from './config.js';
import { expirationsRouter } from './expirations/router.js';
import { filesRouter } from './files.js';
import { healthRouter } from './health.js';
import { errorHandler, HttpError } from './http.js';
import { incidentsRouter } from './incidents/router.js';
import { invitesRouter } from './invites/router.js';
import { incidentUpdatesRouter, maintenanceRouter } from './maintenance/router.js';
import { monitorsRouter } from './monitors/router.js';
import { bullScheduler, type CheckScheduler } from './monitors/scheduler.js';
import { bullReportQueue, reportsRouter, type ReportQueue } from './reports/router.js';
import { publicRouter, statusPagesRouter } from './status-pages/router.js';

// Browsers only send a custom header cross-origin after a CORS preflight, which our
// CORS policy refuses for any origin but our own. Requiring it on every state-changing
// request therefore blocks forged form posts and image tags from other sites.
export const CSRF_HEADER = 'x-requested-with';
const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== 'northstar') throw new HttpError(403, 'Missing CSRF header');
  next();
};

type AppOptions = {
  authLimits?: AuthLimits;
  scheduler?: CheckScheduler;
  reportQueue?: ReportQueue;
  probe?: SystemProbe;
};

// Built separately from server.ts so tests can drive the app without opening a port.
export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  // A CSV of 500 sites is larger than any other request; only the import routes accept it.
  app.use('/api/monitors/import', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api/files', filesRouter());
  // Status pages are public and may be served from a client's own domain, so any origin
  // may read them. They carry no cookies and change nothing.
  app.use('/api/public', cors({ origin: '*' }), publicRouter());
  app.use('/api', csrfGuard);
  app.use('/api/auth', authRouter(options.authLimits ?? defaultAuthLimits));
  app.use('/api/monitors', monitorsRouter(options.scheduler ?? bullScheduler(config.REDIS_URL)));
  app.use('/api/clients', clientsRouter());
  app.use('/api/incidents', incidentsRouter());
  app.use('/api/incidents', incidentUpdatesRouter());
  app.use('/api/status-pages', statusPagesRouter());
  app.use('/api/maintenance-windows', maintenanceRouter());
  app.use('/api/reports', reportsRouter(options.reportQueue ?? bullReportQueue(config.REDIS_URL)));
  app.use('/api', expirationsRouter());
  app.use('/api', invitesRouter(options.authLimits ?? defaultAuthLimits));
  app.use('/api/admin', adminRouter(options.probe ?? bullProbe(config.REDIS_URL)));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  return app;
}
