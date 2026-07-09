import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  readJsonBody,
  sendPublicError,
} from '../../../api/_lib/http.js';
import { sendAccessDenied } from '../../../api/_lib/access-control.js';

function createRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
    },
  };
}

describe('shared API hardening helpers', () => {
  it('rejects oversized JSON strings before parsing', async () => {
    await expect(readJsonBody({ body: '{"value":"too-large"}' }, { maxBytes: 8 }))
      .rejects.toMatchObject({
        code: 'JSON_BODY_TOO_LARGE',
        status: 413,
      });
  });

  it('rejects oversized streamed JSON bodies while reading chunks', async () => {
    const req = Readable.from([
      Buffer.from('{"value":'),
      Buffer.from('"too-large"}'),
    ]);

    await expect(readJsonBody(req, { maxBytes: 8 }))
      .rejects.toMatchObject({
        code: 'JSON_BODY_TOO_LARGE',
        status: 413,
      });
  });

  it('sends public errors with a request id and no internal decision details', () => {
    const req = { headers: { 'x-request-id': 'req-test-1' } };
    const res = createRes();

    sendPublicError(req, res, 429, {
      code: 'RATE_LIMITED',
      error: 'Too many requests.',
      retryAfterSeconds: 12,
      details: { internal: true },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['x-request-id']).toBe('req-test-1');
    expect(res.headers['retry-after']).toBe('12');
    expect(JSON.parse(res.body)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Too many requests.',
      requestId: 'req-test-1',
    });
  });

  it('does not leak access-control decision internals to public API responses', () => {
    const res = createRes();

    sendAccessDenied(res, {
      status: 403,
      reason: 'FEATURE_NOT_ALLOWED',
      decision: {
        allowed: false,
        reason: 'FEATURE_NOT_ALLOWED',
        feature: 'admin.access',
        plan: 'vip',
      },
    });

    expect(res.statusCode).toBe(403);
    const payload = JSON.parse(res.body);
    expect(payload).toMatchObject({
      ok: false,
      code: 'FEATURE_NOT_ALLOWED',
      error: 'FEATURE_NOT_ALLOWED',
    });
    expect(payload).not.toHaveProperty('decision');
    expect(payload).not.toHaveProperty('feature');
  });
});
