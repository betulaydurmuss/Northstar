import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'northstar-api', time: new Date().toISOString() });
});
