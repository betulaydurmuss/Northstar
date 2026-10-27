import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { adminRouter } from './admin/router.js';
import { authRouter } from './auth/router.js';
import { defaultAuthLimits, type AuthLimits } from './auth/rate-limit.js';
import { config } from './config.js';
import { healthRouter } from './health.js';
import { errorHandler, HttpError } from './http.js';
import { incidentsRouter } from './incidents/router.js';
import { monitorsRouter } from './monitors/router.js';
import { bullScheduler, type CheckScheduler } from './monitors/scheduler.js';

// Browsers only send a custom header cross-origin after a CORS preflight, which our
// CORS policy refuses for any origin but our own. Requiring it on every state-changing
// request therefore blocks forged form posts and image tags from other sites.
export const CSRF_HEADER = 'x-requested-with';
const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== 'northstar') throw new HttpError(403, 'Missing CSRF header');
  next();
};

type AppOptions = { authLimits?: AuthLimits; scheduler?: CheckScheduler };

// Built separately from server.ts so tests can drive the app without opening a port.
export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api', csrfGuard);
  app.use('/api/auth', authRouter(options.authLimits ?? defaultAuthLimits));
  app.use('/api/monitors', monitorsRouter(options.scheduler ?? bullScheduler(config.REDIS_URL)));
  app.use('/api/incidents', incidentsRouter());
  app.use('/api/admin', adminRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  return app;
}
