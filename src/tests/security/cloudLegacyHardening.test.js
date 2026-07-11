import { describe, expect, it } from 'vitest';

function createRes() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
    },
  };
}

describe('legacy cloud sync API hardening', () => {
  it.each(['GET', 'POST', 'DELETE', 'OPTIONS'])('retires %s without opening a database connection', async (method) => {
    const { default: handler } = await import('../../../api/cloud.js');
    const res = createRes();
    const req = {
      method,
      headers: {
        'x-request-id': 'cloud-retired-test',
      },
      query: {},
      body: { ignored: true },
    };

    await handler(req, res);

    expect(res.statusCode).toBe(410);
    expect(res.headers['x-request-id']).toBe('cloud-retired-test');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({
      ok: false,
      error: 'Cloud Sync legacy đã ngừng hoạt động. Hãy dùng Cloud Sync trong tài khoản StoryForge.',
      code: 'CLOUD_SYNC_LEGACY_RETIRED',
      requestId: 'cloud-retired-test',
    });
  });
});
