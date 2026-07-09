import { describe, expect, it } from 'vitest';

import {
  checkRateLimit,
  clearRateLimitState,
} from '../../../api/_lib/rate-limit.js';

describe('API soft rate limiter', () => {
  it('allows requests within the route budget and blocks the next burst without Supabase writes', () => {
    clearRateLimitState();
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        authorization: 'Bearer user-token',
      },
    };

    const first = checkRateLimit(req, {
      keyPrefix: 'openai-proxy',
      limit: 2,
      windowMs: 60_000,
    });
    const second = checkRateLimit(req, {
      keyPrefix: 'openai-proxy',
      limit: 2,
      windowMs: 60_000,
    });
    const third = checkRateLimit(req, {
      keyPrefix: 'openai-proxy',
      limit: 2,
      windowMs: 60_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.headers['X-RateLimit-Limit']).toBe('2');
    expect(third.headers['X-RateLimit-Remaining']).toBe('0');
  });
});
