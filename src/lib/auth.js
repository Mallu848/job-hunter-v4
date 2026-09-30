import crypto from 'node:crypto';

// Requires the `x-app-secret` header to match process.env.APP_SECRET.
// Mounted on all /api routes except /api/health (see server.js for the
// router ordering that exempts it).
//
// Brute-force guard: after MAX_FAILS bad attempts from one IP inside
// WINDOW_MS, that IP gets 429 until the window expires (even with the
// right secret). In-memory, which is fine for a single-instance app.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map(); // ip -> { count, resetAt }

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function _resetAuthLimiter() {
  fails.clear();
}

export function requireAppSecret(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const rec = fails.get(ip);
  if (rec && rec.resetAt <= now) fails.delete(ip);
  const cur = fails.get(ip);

  if (cur && cur.count >= MAX_FAILS) {
    res.set('Retry-After', String(Math.ceil((cur.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many attempts' });
  }

  const provided = req.header('x-app-secret');
  const expected = process.env.APP_SECRET;
  if (!provided || !expected || !safeEqual(provided, expected)) {
    const r = cur || { count: 0, resetAt: now + WINDOW_MS };
    r.count += 1;
    fails.set(ip, r);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  fails.delete(ip);
  next();
}

// Keep the map from growing forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of fails) if (r.resetAt <= now) fails.delete(ip);
}, WINDOW_MS).unref();
