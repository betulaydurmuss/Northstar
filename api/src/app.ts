import express from 'express';
import { healthRouter } from './health.js';

// Built separately from server.ts so tests can drive the app without opening a port.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
