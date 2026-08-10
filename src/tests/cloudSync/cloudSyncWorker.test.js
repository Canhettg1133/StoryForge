import { describe, expect, it, vi } from 'vitest';
import {
  buildCloudSnapshotObjectKey,
  createCloudSyncWorker,
  validateUploadRequest,
} from '../../../apps/cloud-sync-worker/src/index.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const UPLOAD_ID = '33333333-3333-4333-8333-333333333333';
const SHA256 = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

function manifest(overrides = {}) {
  return {
    id: SNAPSHOT_ID,
    scope: 'project',
    itemSlug: 'project-1',
    itemTitle: 'Project 1',
    payloadVersion: 8,
    sourceUpdatedAt: 1_700_000_000_000,
    sizeBytes: 2,
    metadata: {},
    payloadSha256: SHA256,
    revisionId: '44444444-4444-4444-8444-444444444444',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function uploadBody(overrides = {}) {
  return {
    writeId: '55555555-5555-4555-8555-555555555555',
    scope: 'project',
    itemSlug: 'project-1',
    itemTitle: 'Project 1',
    payloadVersion: 8,
    sourceUpdatedAt: 1_700_000_000_000,
    sizeBytes: 2,
    payloadSha256: SHA256,
    metadata: {},
    expectedRevisionId: null,
    ...overrides,
  };
}

function createRepository(overrides = {}) {
  return {
    listSnapshots: vi.fn(async () => [manifest()]),
    openUpload: vi.fn(async () => ({
      uploadId: UPLOAD_ID,
      snapshotId: SNAPSHOT_ID,
      uploadRequired: true,
      expiresAt: '2026-08-10T00:30:00.000Z',
    })),
    getUpload: vi.fn(async () => ({
      uploadId: UPLOAD_ID,
      snapshotId: SNAPSHOT_ID,
      scope: 'project',
      sizeBytes: 2,
      payloadSha256: SHA256,
      status: 'pending',
    })),
    commitUpload: vi.fn(async () => manifest()),
    abortUpload: vi.fn(async () => ({ deleteObject: true })),
    getSnapshot: vi.fn(async () => ({
      ...manifest(),
      objectKey: buildCloudSnapshotObjectKey({
        userId: USER_ID,
        scope: 'project',
        snapshotId: SNAPSHOT_ID,
        payloadSha256: SHA256,
      }),
    })),
    deleteSnapshot: vi.fn(async () => ({ deleted: true })),
    cleanupExpiredUploads: vi.fn(async () => []),
    claimGcObjects: vi.fn(async () => []),
    completeGcObject: vi.fn(async () => {}),
    failGcObject: vi.fn(async () => {}),
    ...overrides,
  };
}

function createBucket(overrides = {}) {
  return {
    put: vi.fn(async (_key, body, options) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      return {
        size: bytes.byteLength,
        etag: 'etag-1',
        version: 'version-1',
        checksums: { sha256: options.sha256 },
      };
    }),
    get: vi.fn(async () => ({
      size: 2,
      body: new Response('{}').body,
      checksums: { sha256: SHA256 },
      httpEtag: '"etag-1"',
    })),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

function createEnv(overrides = {}) {
  return {
    CLOUD_SYNC_ALLOWED_ORIGINS: 'https://app.storyforge.test,http://localhost:5173',
    CLOUD_SYNC_MODE: 'active',
    CLOUD_SYNC_BUCKET: createBucket(),
    SUPABASE_URL: 'https://storyforge.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    ...overrides,
  };
}

function createApp(repository = createRepository()) {
  return createCloudSyncWorker({
    authenticate: vi.fn(async () => ({ id: USER_ID, role: 'authenticated' })),
    createRepository: vi.fn(() => repository),
    createRequestId: () => 'request-1',
  });
}

function request(path, init = {}) {
  return new Request(`https://cloud-sync.storyforge.test${path}`, {
    ...init,
    headers: {
      Origin: 'https://app.storyforge.test',
      Authorization: 'Bearer token',
      ...(init.headers || {}),
    },
  });
}

describe('Cloud Sync Worker contracts', () => {
  it('builds immutable object keys without user-controlled title or slug', () => {
    expect(buildCloudSnapshotObjectKey({
      userId: USER_ID,
      scope: 'project',
      snapshotId: SNAPSHOT_ID,
      payloadSha256: SHA256,
    })).toBe(`users/${USER_ID}/snapshots/project/${SNAPSHOT_ID}/${SHA256}.json`);
  });

  it('validates exact limits and SHA-256 format', () => {
    expect(validateUploadRequest(uploadBody({ sizeBytes: 64 * 1024 * 1024 })).sizeBytes)
      .toBe(64 * 1024 * 1024);
    expect(() => validateUploadRequest(uploadBody({ sizeBytes: (64 * 1024 * 1024) + 1 })))
      .toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    expect(() => validateUploadRequest(uploadBody({ payloadSha256: 'forged' })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PAYLOAD_SHA256' }));
  });

  it('fails closed for wildcard or disallowed CORS origins', async () => {
    const app = createApp();
    const wildcard = await app.fetch(request('/cloud-sync/v1/health'), createEnv({
      CLOUD_SYNC_ALLOWED_ORIGINS: '*',
    }));
    expect(wildcard.status).toBe(500);
    expect(wildcard.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const disallowed = await app.fetch(new Request('https://cloud-sync.storyforge.test/cloud-sync/v1/health', {
      headers: { Origin: 'https://evil.example' },
    }), createEnv());
    expect(disallowed.status).toBe(403);
  });

  it('fails closed when the deployment mode is missing or misspelled', async () => {
    const missingMode = createEnv();
    delete missingMode.CLOUD_SYNC_MODE;
    const missing = await createApp().fetch(request('/cloud-sync/v1/health'), missingMode);
    expect(missing.status).toBe(500);

    const misspelled = await createApp().fetch(request('/cloud-sync/v1/health'), createEnv({
      CLOUD_SYNC_MODE: 'testonly',
    }));
    expect(misspelled.status).toBe(500);
  });

  it('requires authentication, enforces test-only users, and returns Retry-After on limits', async () => {
    const unauthorizedApp = createCloudSyncWorker({
      authenticate: vi.fn(async () => {
        const error = new Error('Authentication required.');
        error.code = 'UNAUTHORIZED';
        error.status = 401;
        throw error;
      }),
      createRepository: vi.fn(() => createRepository()),
      createRequestId: () => 'request-1',
    });
    const unauthorized = await unauthorizedApp.fetch(request('/cloud-sync/v1/snapshots'), createEnv());
    expect(unauthorized.status).toBe(401);

    const testOnly = await createApp().fetch(request('/cloud-sync/v1/snapshots'), createEnv({
      CLOUD_SYNC_MODE: 'test-only',
      CLOUD_SYNC_TEST_USER_IDS: '99999999-9999-4999-8999-999999999999',
    }));
    expect(testOnly.status).toBe(403);

    const limited = await createApp().fetch(request('/cloud-sync/v1/snapshots'), createEnv({
      CLOUD_SYNC_READ_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  });

  it('lists at most 200 public manifest fields in one repository call', async () => {
    const repository = createRepository({
      listSnapshots: vi.fn(async () => [manifest({ objectKey: 'secret', r2Etag: 'secret' })]),
    });
    const response = await createApp(repository).fetch(
      request('/cloud-sync/v1/snapshots'),
      createEnv(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(repository.listSnapshots).toHaveBeenCalledOnce();
    expect(repository.listSnapshots).toHaveBeenCalledWith(USER_ID, 200);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).not.toHaveProperty('objectKey');
    expect(payload.data[0]).not.toHaveProperty('r2Etag');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('caps R2 and legacy snapshot items at 200 combined', async () => {
    const repository = createRepository({
      listSnapshots: vi.fn(async () => ({
        items: Array.from({ length: 150 }, (_, index) => manifest({ id: `r2-${index}` })),
        tombstones: [],
        legacyItems: Array.from({ length: 100 }, (_, index) => manifest({ id: `legacy-${index}` })),
      })),
    });
    const response = await createApp(repository).fetch(
      request('/cloud-sync/v1/snapshots'),
      createEnv(),
    );
    const payload = await response.json();

    expect(payload.data).toHaveLength(150);
    expect(payload.legacyItems).toHaveLength(50);
  });

  it('streams the declared bytes into R2 with SHA verification before committing', async () => {
    const repository = createRepository();
    const env = createEnv();
    const app = createApp(repository);
    const originalFixedLengthStream = globalThis.FixedLengthStream;
    globalThis.FixedLengthStream = class extends TransformStream {
      constructor(length) {
        super();
        this.readable.fixedLength = length;
      }
    };
    const open = await app.fetch(request('/cloud-sync/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uploadBody()),
    }), env);
    expect(open.status).toBe(201);

    let response;
    try {
      response = await app.fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '2',
        },
        body: '{}',
      }), env);
    } finally {
      if (originalFixedLengthStream === undefined) delete globalThis.FixedLengthStream;
      else globalThis.FixedLengthStream = originalFixedLengthStream;
    }
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(env.CLOUD_SYNC_BUCKET.put).toHaveBeenCalledOnce();
    expect(env.CLOUD_SYNC_BUCKET.put.mock.calls[0][0]).toBe(
      `users/${USER_ID}/snapshots/project/${SNAPSHOT_ID}/${SHA256}.json`,
    );
    expect(env.CLOUD_SYNC_BUCKET.put.mock.calls[0][1].fixedLength).toBe(2);
    const r2Checksum = env.CLOUD_SYNC_BUCKET.put.mock.calls[0][2].sha256;
    expect(r2Checksum).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(r2Checksum).toString('hex')).toBe(SHA256);
    expect(repository.commitUpload).toHaveBeenCalledOnce();
    expect(payload.data).not.toHaveProperty('objectKey');
  });

  it('rejects oversized upload metadata JSON even without trusting Content-Length', async () => {
    const repository = createRepository();
    const response = await createApp(repository).fetch(request('/cloud-sync/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...uploadBody(), ignoredPadding: 'x'.repeat(100 * 1024) }),
    }), createEnv());

    expect(response.status).toBe(413);
    expect(repository.openUpload).not.toHaveBeenCalled();
  });

  it('rejects a forged Content-Length before writing R2', async () => {
    const repository = createRepository();
    const env = createEnv();
    const response = await createApp(repository).fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
      method: 'PUT',
      headers: { 'Content-Length': '1' },
      body: '{}',
    }), env);

    expect(response.status).toBe(422);
    expect(env.CLOUD_SYNC_BUCKET.put).not.toHaveBeenCalled();
    expect(repository.commitUpload).not.toHaveBeenCalled();
  });

  it('rejects a short body without Content-Length after streaming and aborts its object', async () => {
    const repository = createRepository();
    const bucket = createBucket({
      put: vi.fn(async (_key, body, options) => {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        return { size: bytes.byteLength, checksums: { sha256: options.sha256 } };
      }),
    });
    const response = await createApp(repository).fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
      method: 'PUT',
      body: '{',
    }), createEnv({ CLOUD_SYNC_BUCKET: bucket }));

    expect(response.status).toBe(422);
    expect(repository.abortUpload).toHaveBeenCalledOnce();
    expect(repository.commitUpload).not.toHaveBeenCalled();
  });

  it('maps an early R2 stream rejection to 502 without blaming the declared payload size', async () => {
    const repository = createRepository();
    const bucket = createBucket({
      put: vi.fn(async () => {
        throw new Error('put: Content-Length is required for this stream. (10033)');
      }),
    });
    const response = await createApp(repository).fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
      method: 'PUT',
      headers: { 'Content-Length': '2' },
      body: '{}',
    }), createEnv({ CLOUD_SYNC_BUCKET: bucket }));

    expect(response.status).toBe(502);
    expect(repository.abortUpload).not.toHaveBeenCalled();
    expect(repository.commitUpload).not.toHaveBeenCalled();
  });

  it('rejects non-UTF-8 upload bytes while streaming', async () => {
    const repository = createRepository({
      getUpload: vi.fn(async () => ({
        uploadId: UPLOAD_ID,
        snapshotId: SNAPSHOT_ID,
        scope: 'project',
        sizeBytes: 1,
        payloadSha256: SHA256,
        status: 'pending',
      })),
    });
    const bucket = createBucket({
      put: vi.fn(async (_key, body) => {
        await new Response(body).arrayBuffer();
        return { size: 1, checksums: { sha256: SHA256 } };
      }),
    });
    const response = await createApp(repository).fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
      method: 'PUT',
      body: new Uint8Array([0xff]),
    }), createEnv({ CLOUD_SYNC_BUCKET: bucket }));

    expect(response.status).toBe(422);
    expect(repository.abortUpload).toHaveBeenCalledOnce();
    expect(repository.commitUpload).not.toHaveBeenCalled();
  });

  it('returns 502 and never commits when R2 checksum differs', async () => {
    const repository = createRepository();
    const env = createEnv({
      CLOUD_SYNC_BUCKET: createBucket({
        put: vi.fn(async (_key, body) => {
          const bytes = new Uint8Array(await new Response(body).arrayBuffer());
          return {
            size: bytes.byteLength,
            checksums: { sha256: 'b'.repeat(64) },
          };
        }),
      }),
    });
    const response = await createApp(repository).fetch(request(`/cloud-sync/v1/uploads/${UPLOAD_ID}`, {
      method: 'PUT',
      headers: { 'Content-Length': '2' },
      body: '{}',
    }), env);

    expect(response.status).toBe(502);
    expect(repository.commitUpload).not.toHaveBeenCalled();
    expect(repository.abortUpload).toHaveBeenCalledOnce();
  });

  it('hides cross-user/missing snapshots as 404 and verifies download metadata', async () => {
    const missingRepository = createRepository({
      getSnapshot: vi.fn(async () => null),
    });
    const missing = await createApp(missingRepository).fetch(
      request(`/cloud-sync/v1/snapshots/${SNAPSHOT_ID}/content`),
      createEnv(),
    );
    expect(missing.status).toBe(404);

    const env = createEnv({
      CLOUD_SYNC_BUCKET: createBucket({
        get: vi.fn(async () => ({
          size: 3,
          body: new Response('bad').body,
          checksums: { sha256: SHA256 },
        })),
      }),
    });
    const corrupt = await createApp().fetch(
      request(`/cloud-sync/v1/snapshots/${SNAPSHOT_ID}/content`),
      env,
    );
    expect(corrupt.status).toBe(502);
  });

  it('accepts the SHA-256 custom metadata written by the legacy S3 backfill', async () => {
    const env = createEnv({
      CLOUD_SYNC_BUCKET: createBucket({
        get: vi.fn(async () => ({
          size: 2,
          body: new Response('{}').body,
          customMetadata: { 'payload-sha256': SHA256 },
        })),
      }),
    });

    const response = await createApp().fetch(
      request(`/cloud-sync/v1/snapshots/${SNAPSHOT_ID}/content`),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{}');
  });

  it('deletes the manifest through the GC outbox without exposing object keys', async () => {
    const repository = createRepository();
    const env = createEnv();
    const response = await createApp(repository).fetch(request(
      `/cloud-sync/v1/snapshots/${SNAPSHOT_ID}`,
      { method: 'DELETE' },
    ), env);

    expect(response.status).toBe(204);
    expect(repository.deleteSnapshot).toHaveBeenCalledWith(USER_ID, SNAPSHOT_ID);
    expect(env.CLOUD_SYNC_BUCKET.delete).not.toHaveBeenCalled();
  });
});
