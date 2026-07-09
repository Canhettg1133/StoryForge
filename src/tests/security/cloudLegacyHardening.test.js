import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pgMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return {
    query: pgMock.query,
    };
  }),
}));

const ORIGINAL_DATABASE_URL = process.env.STORYFORGE_DATABASE_URL;

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
  beforeEach(() => {
    vi.resetModules();
    pgMock.query.mockReset();
    pgMock.query.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.STORYFORGE_DATABASE_URL = 'postgres://storyforge:test@localhost:5432/storyforge';
  });

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env.STORYFORGE_DATABASE_URL;
    } else {
      process.env.STORYFORGE_DATABASE_URL = ORIGINAL_DATABASE_URL;
    }
  });

  it('rejects oversized POST bodies before querying snapshot rows', async () => {
    const { default: handler } = await import('../../../api/cloud.js');
    const res = createRes();
    const req = {
      method: 'POST',
      headers: {
        'x-request-id': 'cloud-oversize-test',
        'x-storyforge-workspace': 'demo',
        'x-storyforge-access-key': 'secret',
      },
      query: {},
      body: 'x'.repeat(4_500_001),
    };

    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(res.headers['x-request-id']).toBe('cloud-oversize-test');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({
      error: 'Cloud Sync payload vuot gioi han an toan.',
      code: 'CLOUD_SYNC_BODY_TOO_LARGE',
    });
    expect(pgMock.query).toHaveBeenCalledTimes(1);
    expect(pgMock.query.mock.calls[0][0]).toContain('create table if not exists storyforge_cloud_snapshots');
  });
});
