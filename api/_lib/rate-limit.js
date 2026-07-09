import { getBearerToken, getClientIp, getHeader } from './http.js';

const buckets = new Map();

function nowMs() {
  return Date.now();
}

function identityFromRequest(req) {
  const bearer = getBearerToken(req);
  if (bearer) return `bearer:${bearer.length}:${bearer.slice(0, 12)}:${bearer.slice(-8)}`;
  return `ip:${getClientIp(req) || getHeader(req, 'cf-connecting-ip') || 'unknown'}`;
}

function buildHeaders({ limit, remaining, resetAt }) {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
}

export function clearRateLimitState() {
  buckets.clear();
}

export function checkRateLimit(req, {
  keyPrefix,
  limit,
  windowMs,
  identity,
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);
  const key = `${keyPrefix || 'api'}:${identity || identityFromRequest(req)}`;
  const now = nowMs();
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + safeWindowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = safeLimit - bucket.count;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= safeLimit,
    limit: safeLimit,
    remaining: Math.max(0, remaining),
    retryAfterSeconds,
    resetAt: bucket.resetAt,
    headers: buildHeaders({
      limit: safeLimit,
      remaining,
      resetAt: bucket.resetAt,
    }),
  };
}

export function writeRateLimitHeaders(res, result) {
  Object.entries(result?.headers || {}).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}
