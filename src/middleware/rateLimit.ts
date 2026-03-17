import type { Request, Response, NextFunction } from 'express';

const windowMs = 60_000; // 1 minute
const maxRequests = 60;  // Per IP per minute

const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();

  const entry = requests.get(ip);
  if (!entry || now > entry.resetAt) {
    requests.set(ip, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  if (entry.count >= maxRequests) {
    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Try again shortly.',
    });
    return;
  }

  entry.count++;
  next();
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requests) {
    if (now > entry.resetAt) requests.delete(ip);
  }
}, 300_000).unref();
