/**
 * Scheduled jobs (Vercel Cron). Auth: `Authorization: Bearer <CRON_SECRET>`,
 * which Vercel sends automatically when the CRON_SECRET env var exists.
 *
 * Watches stay off (no database access at all) until WATCHES_ENABLED=true,
 * because every run wakes Neon.
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { runWatchCycle } from '../watches/runner.js';

export const cronRouter = Router();

cronRouter.get('/internal/cron/watches', async (req: Request, res: Response) => {
  if (!config.CRON_SECRET) {
    res.status(503).json({ error: 'CRON_DISABLED' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${config.CRON_SECRET}`) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  if (config.WATCHES_ENABLED !== 'true' || !config.WATCH_MASTER_KEY) {
    res.json({ skipped: 'disabled' });
    return;
  }
  try {
    res.json(await runWatchCycle());
  } catch (e) {
    console.error('cron: watch cycle failed', e);
    res.status(500).json({ error: 'CYCLE_FAILED' });
  }
});
