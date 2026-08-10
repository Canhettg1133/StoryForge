import { afterEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function importStore({
  mode = 'hybrid',
  apiUrl = 'https://cloud-sync.storyforge.test',
  fetchImpl,
  getSupabaseClient = vi.fn(),
} = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_CLOUD_SYNC_API_URL', apiUrl);
  vi.stubEnv('VITE_CLOUD_SYNC_STORAGE_MODE', mode);
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    getSession: vi.fn(async () => ({ user: { id: USER_ID } })),
    getCloudAccessToken: vi.fn(async () => 'access-token'),
  }));
  vi.doMock('../../services/cloud/supabaseClient.js', () => ({ getSupabaseClient }));
  vi.stubGlobal('fetch', fetchImpl || vi.fn());
  return import('../../services/cloud/cloudSnapshotStore.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('Cloud Snapshot Store rollout modes', () => {
  it('merges one Worker list without exposing shadowed or tombstoned legacy rows', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{
        id: SNAPSHOT_ID,
        scope: 'project',
        itemSlug: 'r2-project',
        itemTitle: 'R2 project',
        sizeBytes: 2,
        metadata: {},
        payloadSha256: 'a'.repeat(64),
        revisionId: REVISION_ID,
        updatedAt: '2026-08-10T00:00:00.000Z',
      }],
      tombstones: [{ scope: 'chat', itemSlug: 'deleted-chat' }],
      legacyItems: [
        { id: 'legacy-shadowed', scope: 'project', itemSlug: 'r2-project', metadata: {} },
        { id: 'legacy-deleted', scope: 'chat', itemSlug: 'deleted-chat', metadata: {} },
        { id: 'legacy-visible', scope: 'chat', itemSlug: 'visible-chat', metadata: {} },
      ],
    }));
    const getSupabaseClient = vi.fn();
    const store = await importStore({ fetchImpl, getSupabaseClient });

    const items = await store.listCloudSnapshotMetadata();

    expect(items.map((item) => item.itemSlug).sort()).toEqual(['r2-project', 'visible-chat']);
    expect(items.find((item) => item.itemSlug === 'visible-chat')?.storageBackend).toBe('legacy');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('writes only through the Worker in hybrid mode when the API is configured', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith('/uploads')) {
        return jsonResponse({
          data: {
            uploadId: '44444444-4444-4444-8444-444444444444',
            snapshotId: SNAPSHOT_ID,
            uploadRequired: true,
          },
        }, 201);
      }
      return jsonResponse({
        data: {
          id: SNAPSHOT_ID,
          scope: 'project',
          itemSlug: 'project-1',
          itemTitle: 'Project 1',
          sizeBytes: 2,
          metadata: {},
          payloadSha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
          revisionId: REVISION_ID,
        },
      });
    });
    const getSupabaseClient = vi.fn();
    const store = await importStore({ fetchImpl, getSupabaseClient });

    const saved = await store.putCloudSnapshot({
      writeId: '55555555-5555-4555-8555-555555555555',
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project 1',
      payloadText: '{}',
      payloadVersion: 8,
      sourceUpdatedAt: 1,
      metadata: {},
      expectedRevisionId: null,
    });

    expect(saved.id).toBe(SNAPSHOT_ID);
    expect(calls).toHaveLength(2);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[1].init.method).toBe('PUT');
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('never falls back to a known legacy row in r2-only mode', async () => {
    const fetchImpl = vi.fn();
    const getSupabaseClient = vi.fn();
    const store = await importStore({ mode: 'r2-only', fetchImpl, getSupabaseClient });

    await expect(store.getCloudSnapshot('project', 'legacy-project', {
      id: 'legacy-id',
      scope: 'project',
      itemSlug: 'legacy-project',
      storageBackend: 'legacy',
    })).rejects.toThrow('R2-only');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('fails closed instead of writing legacy Supabase when an R2 mode has no API URL', async () => {
    const getSupabaseClient = vi.fn();
    const store = await importStore({ apiUrl: '', mode: 'hybrid', getSupabaseClient });

    await expect(store.putCloudSnapshot({
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project 1',
      payloadText: '{}',
      sizeBytes: 2,
      metadata: {},
    })).rejects.toMatchObject({ code: 'CLOUD_SYNC_API_NOT_CONFIGURED' });
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});
