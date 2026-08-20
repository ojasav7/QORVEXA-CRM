// General API rate limiting — in-memory sliding window per IP.
// Public form routes have their own tighter limits; this covers the
// authenticated API surface to prevent brute-force and abuse.
//
// Strategy: fixed-window counters with automatic cleanup. Good enough for a
// single-instance deployment; a Redis-backed limiter would be needed for
// horizontal scaling (future phase).

type WindowEntry = { count: number; resetAt: number };

const buckets = new Map<string, WindowEntry>();

// Clean up expired entries every 5 minutes to prevent memory leak.
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Create a rate limiter middleware.
 * @param windowMs  Time window in milliseconds (default: 60 000 = 1 min)
 * @param max        Maximum requests per window per IP
 */
export function rateLimit(windowMs = 60_000, max = 100) {
  return (req: any, res: any, next: any) => {
    cleanup();

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${ip}:${req.baseUrl || ""}`;
    const now = Date.now();
    let entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count++;

    // Set standard rate-limit headers.
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetSeconds);

    if (entry.count > max) {
      res.setHeader("Retry-After", resetSeconds);
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

// Convenience presets for different route categories.
export const apiRateLimit = rateLimit(60_000, 200); // 200 req/min for general API
export const authRateLimit = rateLimit(60_000, 20); // 20 attempts/min for auth
export const webhookRateLimit = rateLimit(60_000, 500); // 500/min for provider webhooks
