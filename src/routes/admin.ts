import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { getDb } from '../analytics/db.js';
import {
  getOverviewStats,
  getRevenueStats,
  getLast24hStats,
  getDailyRevenue,
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
  res.sendFile(path.join(__dirname, '../../dashboard/admin.html'));
});

// ────────────────────────────────────────────────────────────────────
// Admin API endpoints
// ────────────────────────────────────────────────────────────────────

adminRouter.get('/admin/stats', requireAdminToken, (_req: Request, res: Response) => {
  const overview = getOverviewStats();
  const revenue = getRevenueStats();
  const last24h = getLast24hStats();

  res.json({
    overview,
    revenue,
    last24h,
    generatedAt: new Date().toISOString(),
  });
});

adminRouter.get('/admin/revenue/daily', requireAdminToken, (_req: Request, res: Response) => {
  const daily = getDailyRevenue();
  res.json({ daily });
});

adminRouter.get('/admin/recent-calls', requireAdminToken, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
  const db = getDb();
  const calls = db.prepare(`
    SELECT endpoint, success, latency_ms as latencyMs, error_type as errorType, created_at as timestamp
    FROM calls
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  res.json({ calls });
});

adminRouter.get('/admin/feedback', requireAdminToken, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const db = getDb();
  const feedback = db.prepare(`
    SELECT id, type, endpoint, message, contact, created_at as timestamp
    FROM feedback
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  res.json({ feedback });
});
