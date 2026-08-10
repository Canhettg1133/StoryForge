import { describe, expect, it, vi } from 'vitest';
import {
  createCloudSyncApiClient,
  encodeCloudPayload,
} from '../../services/cloud/cloudR2ApiClient.js';

const SHA256_EMPTY_OBJECT = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('Cloud Sync R2 API client', () => {
  it('encodes once and hashes the exact UTF-8 bytes that will be uploaded', async () => {
    const encoded = await encodeCloudPayload('{}');
    expect([...encoded.bytes]).toEqual([123, 125]);
    expect(encoded.sizeBytes).toBe(2);
    expect(encoded.payloadSha256).toBe(SHA256_EMPTY_OBJECT);
  });

  it('coalesces concurrent manifest lists into one HTTP request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl,
    });

    const [first, second] = await Promise.all([
      client.listSnapshots(),
      client.listSnapshots(),
    ]);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never reuses a manifest cache after the access token changes', async () => {
    let accessToken = 'user-one-token';
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{
        id: accessToken,
        scope: 'project',
        itemSlug: accessToken,
        metadata: {},
      }],
    }));
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => accessToken),
      fetchImpl,
    });

    const first = await client.listSnapshots();
    accessToken = 'user-two-token';
    const second = await client.listSnapshots();

    expect(first[0].itemSlug).toBe('user-one-token');
    expect(second[0].itemSlug).toBe('user-two-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not let an older in-flight list repopulate cache after a write', async () => {
    let releaseFirstList;
    let listCalls = 0;
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/snapshots')) {
        listCalls += 1;
        if (listCalls === 1) {
          await new Promise((resolve) => { releaseFirstList = resolve; });
        }
        return jsonResponse({ data: [{
          id: `snapshot-list-${listCalls}`,
          scope: 'project',
          itemSlug: 'project-1',
          metadata: {},
        }] });
      }
      if (url.endsWith('/uploads')) {
        return jsonResponse({
          data: {
            uploadRequired: false,
            manifest: {
              id: 'snapshot-write',
              revisionId: 'revision-write',
              scope: 'project',
              itemSlug: 'project-1',
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl,
    });

    const staleList = client.listSnapshots();
    await vi.waitFor(() => expect(releaseFirstList).toBeTypeOf('function'));
    await client.uploadSnapshot({
      writeId: 'write-1',
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project 1',
      payloadText: '{}',
      metadata: {},
    });
    const freshList = await client.listSnapshots();
    releaseFirstList();
    await staleList;

    expect(freshList[0].id).toBe('snapshot-list-2');
    expect(listCalls).toBe(2);
  });

  it('rejects remote plain HTTP API URLs before sending the bearer token', async () => {
    const fetchImpl = vi.fn();
    const client = createCloudSyncApiClient({
      baseUrl: 'http://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl,
    });

    await expect(client.listSnapshots()).rejects.toMatchObject({
      code: 'CLOUD_SYNC_API_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries only transient failures, preserves writeId, and uploads raw bytes', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      calls.push({ input: String(input), init });
      if (calls.length === 1) return jsonResponse({ error: { code: 'UPSTREAM_UNAVAILABLE' } }, 503);
      if (String(input).endsWith('/uploads')) {
        return jsonResponse({
          data: { uploadId: 'upload-1', uploadRequired: true },
        }, 201);
      }
      return jsonResponse({ data: { id: 'snapshot-1', revisionId: 'revision-1' } });
    });
    const sleep = vi.fn(async () => {});
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl,
      sleep,
    });

    const result = await client.uploadSnapshot({
      writeId: 'write-1',
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project 1',
      payloadText: '{}',
      payloadVersion: 8,
      sourceUpdatedAt: 1,
      metadata: {},
      expectedRevisionId: null,
    });

    expect(result.id).toBe('snapshot-1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const firstOpen = JSON.parse(calls[0].init.body);
    const retriedOpen = JSON.parse(calls[1].init.body);
    expect(firstOpen.writeId).toBe('write-1');
    expect(retriedOpen.writeId).toBe('write-1');
    expect(ArrayBuffer.isView(calls[2].init.body)).toBe(true);
    expect([...calls[2].init.body]).toEqual([123, 125]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('refreshes the Supabase session once after 401', async () => {
    const getAccessToken = vi.fn(async ({ refresh = false } = {}) => (refresh ? 'fresh' : 'stale'));
    const fetchImpl = vi.fn(async (_input, init) => {
      if (new Headers(init.headers).get('Authorization') === 'Bearer stale') {
        return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
      }
      return jsonResponse({ data: [] });
    });
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken,
      fetchImpl,
    });

    await expect(client.listSnapshots({ force: true })).resolves.toEqual([]);
    expect(getAccessToken).toHaveBeenCalledWith({ refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses 20 second metadata and 5 minute transfer timeouts', () => {
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl: vi.fn(),
    });

    expect(client.timeouts).toEqual({ metadataMs: 20_000, transferMs: 300_000 });
  });

  it('rejects a download whose byte length differs from the manifest', async () => {
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl: vi.fn(async () => new Response('{}')),
    });

    await expect(client.downloadSnapshot({ id: 'snapshot-1', sizeBytes: 3 }))
      .rejects.toMatchObject({ code: 'CLOUD_SYNC_SIZE_MISMATCH', status: 502 });
  });

  it('keeps the transfer timeout and retry boundary active while reading the body', async () => {
    const brokenBody = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('stream interrupted'));
      },
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(brokenBody))
      .mockResolvedValueOnce(new Response('{}'));
    const sleep = vi.fn(async () => {});
    const client = createCloudSyncApiClient({
      baseUrl: 'https://cloud-sync.storyforge.test',
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl,
      sleep,
    });

    await expect(client.downloadSnapshot({
      id: 'snapshot-1',
      sizeBytes: 2,
      payloadSha256: SHA256_EMPTY_OBJECT,
    })).resolves.toBe('{}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });
});
