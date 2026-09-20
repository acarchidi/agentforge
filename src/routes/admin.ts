import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { getStore } from '../analytics/store.js';
import {
  getOverviewStats,
  getRevenueStats,
  getLast24hStats,
  getDailyRevenue,
  getRecentCalls,
  getFeedback,
  getDailySummary,
} from '../analytics/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const adminRouter = Router();

// ────────────────────────────────────────────────────────────────────
// Brute-force protection: 5 failures → 1 hour lockout per IP
// ────────────────────────────────────────────────────────────────────

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

function isLockedOut(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() < entry.lockedUntil) return true;
  // Lockout expired — clear
  failedAttempts.delete(ip);
  return false;
}

function recordFailure(ip: string): void {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  failedAttempts.set(ip, entry);
}

function clearFailures(ip: string): void {
  failedAttempts.delete(ip);
}

// ────────────────────────────────────────────────────────────────────
// Timing-safe token comparison
// ────────────────────────────────────────────────────────────────────

function tokenMatches(provided: string): boolean {
  const expected = config.ADMIN_TOKEN;
  if (provided.length !== expected.length) {
    // Still do a constant-time compare to avoid leaking length info via timing
    crypto.timingSafeEqual(
      Buffer.from(provided.padEnd(expected.length, '\0')),
      Buffer.from(expected),
    );
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ────────────────────────────────────────────────────────────────────
// Auth middleware with brute-force protection
// ────────────────────────────────────────────────────────────────────

function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);

  if (isLockedOut(ip)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    return;
  }

  const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
  if (!token || !tokenMatches(token)) {
    recordFailure(ip);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  clearFailures(ip);
  next();
}

// ────────────────────────────────────────────────────────────────────
// Admin dashboard page (separate from public landing)
// ────────────────────────────────────────────────────────────────────

adminRouter.get('/admin', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/admin.html'), { dotfiles: 'allow' });
});

// ────────────────────────────────────────────────────────────────────
// Admin API endpoints
// ────────────────────────────────────────────────────────────────────

function wrap(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      console.error('admin query failed:', error);
      res.status(500).json({ error: 'ANALYTICS_UNAVAILABLE', message: error instanceof Error ? error.message : 'query failed' });
    }
  };
}

adminRouter.get('/admin/stats', requireAdminToken, wrap(async () => {
  const [overview, revenue, last24h] = await Promise.all([
    getOverviewStats(),
    getRevenueStats(),
    getLast24hStats(),
  ]);
  return {
    overview,
    revenue,
    last24h,
    backend: getStore().backend,
    generatedAt: new Date().toISOString(),
  };
}));

adminRouter.get('/admin/revenue/daily', requireAdminToken, wrap(async () => ({ daily: await getDailyRevenue(30) })));

adminRouter.get('/admin/recent-calls', requireAdminToken, wrap(async (req) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
  return { calls: await getRecentCalls(limit) };
}));

adminRouter.get('/admin/feedback', requireAdminToken, wrap(async (req) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  return { feedback: await getFeedback(limit) };
}));

/**
 * Daily summary: calls + unique clients per endpoint/tool per day, MCP vs paid
 * split (with cap hits), top 10 tools by volume, and repeat-payer stats.
 */
adminRouter.get('/admin/daily', requireAdminToken, wrap(async (req) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
  return getDailySummary(days);
}));
