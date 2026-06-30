'use strict';

/**
 * Tiny fixed-window rate limiter (in-memory, per instance). Enough to blunt
 * brute-force on the auth endpoints. For multi-instance production, back this
 * with a shared store (Redis); the interface stays the same.
 */
const buckets = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 60000, max = 10, name = 'rl' } = {}) {
  // The integration test server runs with TF_RATELIMIT=off so its many logins
  // don't trip the limiter; the mechanism itself is unit-tested separately.
  if (process.env.TF_RATELIMIT === 'off') return (req, res, next) => next();
  return function (req, res, next) {
    const id = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(id, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: { message: 'Too many attempts. Please wait a moment and try again.' } });
    }
    next();
  };
}

// Periodically clear stale buckets (no-op safe on serverless).
if (typeof setInterval === 'function') {
  const t = setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 5 * 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = { rateLimit };
