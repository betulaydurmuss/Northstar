import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { prisma } from '../db.js';

export function adminRouter() {
  const router = Router();
  // Applied once to the whole router, so no admin endpoint can be added without it.
  router.use(requireAdmin);

  router.get('/overview', async (_req, res) => {
    const [users, monitors] = await Promise.all([prisma.user.count(), prisma.monitor.count()]);
    res.json({ users, monitors });
  });

  return router;
}
