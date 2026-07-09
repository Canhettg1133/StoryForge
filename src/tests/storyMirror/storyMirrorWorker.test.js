import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STORY_MIRROR_QUOTA_BYTES,
  processStoryMirrorEvent,
} from '../../../apps/story-mirror-worker/src/eventProcessor.js';
import storyMirrorWorker, {
  clearStoryMirrorAccessCaches,
} from '../../../apps/story-mirror-worker/src/index.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createWorkerEnv() {
  return {
    SUPABASE_URL: 'https://storyforge.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    STORY_MIRROR_ALLOWED_ORIGINS: 'https://app.storyforge.test',
    STORY_MIRROR_BUCKET: {
      put: vi.fn(async () => null),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    },
  };
}

function mirrorRequest(path, init = {}) {
  return new Request(`https://mirror.storyforge.test${path}`, {
    ...init,
    headers: {
      Origin: 'https://app.storyforge.test',
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function createProcessorDeps(overrides = {}) {
  const repo = {
    findEventByKey: vi.fn(async () => null),
    recordEvent: vi.fn(async (row) => row),
    upsertProject: vi.fn(async (_userId, project) => ({ id: 'project-server-1', ...project })),
    upsertChapter: vi.fn(async (_userId, chapter) => ({ id: 'chapter-server-1', ...chapter })),
    findScene: vi.fn(async () => null),
    upsertScene: vi.fn(async (_userId, scene) => ({ id: 'scene-server-1', ...scene })),
    listProjectScenes: vi.fn(async () => []),
    getUserUsageBytes: vi.fn(async () => 0),
    updateProjectStorageBytes: vi.fn(async () => {}),
    ...overrides.repo,
  };
  const bucket = {
    put: vi.fn(async () => null),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => null),
    ...overrides.bucket,
  };
  return { repo, bucket };
}

const baseEvent = {
  idempotencyKey: 'scene-33-hash-1',
  resourceType: 'scene.upsert',
  clientUpdatedAt: '2026-07-03T00:00:00.000Z',
  project: {
    clientProjectId: '11',
    title: 'Dự án thử',
    genre: 'fantasy',
    status: 'active',
    wordCount: 2,
    updatedAt: '2026-07-03T00:00:00.000Z',
  },
  chapter: {
    clientChapterId: '22',
    title: 'Chương 1',
    orderIndex: 0,
    status: 'draft',
    wordCount: 2,
  },
  scene: {
    clientSceneId: '33',
    title: 'Cảnh 1',
    orderIndex: 0,
    status: 'draft',
    content: '<p>Nội dung mới</p>',
    contentHash: 'sha256:abc',
    sizeBytes: 19,
    updatedAt: '2026-07-03T00:00:00.000Z',
  },
};

afterEach(() => {
  clearStoryMirrorAccessCaches();
  vi.unstubAllGlobals();
});

describe('story mirror event processor', () => {
  it('is idempotent and does not write R2 again for duplicate keys', async () => {
    const deps = createProcessorDeps({
      repo: {
        findEventByKey: vi.fn(async () => ({ idempotency_key: baseEvent.idempotencyKey, status: 'synced' })),
      },
    });

    const result = await processStoryMirrorEvent({
      event: baseEvent,
      user: { id: 'user-1' },
      quotaBytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
      ...deps,
    });

    expect(result.status).toBe('duplicate');
    expect(deps.bucket.put).not.toHaveBeenCalled();
    expect(deps.repo.upsertScene).not.toHaveBeenCalled();
  });

  it('skips stale events so an older clientUpdatedAt cannot overwrite the latest scene', async () => {
    const deps = createProcessorDeps({
      repo: {
        findScene: vi.fn(async () => ({
          id: 'scene-server-1',
          client_updated_at: '2026-07-04T00:00:00.000Z',
          content_hash: 'sha256:newer',
          size_bytes: 25,
        })),
      },
    });

    const result = await processStoryMirrorEvent({
      event: baseEvent,
      user: { id: 'user-1' },
      quotaBytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
      ...deps,
    });

    expect(result.status).toBe('stale');
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('rejects quota overflow before writing raw story content to R2', async () => {
    const deps = createProcessorDeps({
      repo: {
        getUserUsageBytes: vi.fn(async () => DEFAULT_STORY_MIRROR_QUOTA_BYTES - 5),
      },
    });

    const result = await processStoryMirrorEvent({
      event: {
        ...baseEvent,
        scene: { ...baseEvent.scene, sizeBytes: 20 },
      },
      user: { id: 'user-1' },
      quotaBytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
      ...deps,
    });

    expect(result.status).toBe('failed');
    expect(result.code).toBe('STORY_MIRROR_QUOTA_EXCEEDED');
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('computes quota from raw scene content instead of trusting client sizeBytes', async () => {
    const deps = createProcessorDeps();

    const result = await processStoryMirrorEvent({
      event: {
        ...baseEvent,
        idempotencyKey: 'scene-forged-size',
        scene: {
          ...baseEvent.scene,
          content: 'x'.repeat(64),
          contentHash: 'sha256:client-forged-small',
          sizeBytes: 1,
        },
      },
      user: { id: 'user-1' },
      quotaBytes: 10,
      ...deps,
    });

    expect(result.status).toBe('failed');
    expect(result.code).toBe('STORY_MIRROR_QUOTA_EXCEEDED');
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('recomputes contentHash before deciding a changed scene is unchanged', async () => {
    const deps = createProcessorDeps({
      repo: {
        findScene: vi.fn(async () => ({
          id: 'scene-server-1',
          client_updated_at: '2026-07-02T00:00:00.000Z',
          content_hash: 'sha256:client-forged-old-hash',
          size_bytes: 9,
        })),
      },
    });

    const result = await processStoryMirrorEvent({
      event: {
        ...baseEvent,
        idempotencyKey: 'scene-forged-hash',
        scene: {
          ...baseEvent.scene,
          content: '<p>changed content that must be mirrored</p>',
          contentHash: 'sha256:client-forged-old-hash',
          sizeBytes: 1,
        },
      },
      user: { id: 'user-1' },
      quotaBytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
      ...deps,
    });

    expect(result.status).toBe('synced');
    expect(deps.bucket.put).toHaveBeenCalled();
    const upsertedScene = deps.repo.upsertScene.mock.calls.at(-1)?.[1];
    expect(upsertedScene.content_hash).toBeTruthy();
    expect(upsertedScene.content_hash).not.toBe('sha256:client-forged-old-hash');
  });

  it('records synced events against the authenticated Supabase user', async () => {
    const deps = createProcessorDeps();

    const result = await processStoryMirrorEvent({
      event: baseEvent,
      user: { id: 'user-1' },
      quotaBytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
      ...deps,
    });

    expect(result.status).toBe('synced');
    expect(deps.repo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      idempotency_key: baseEvent.idempotencyKey,
      status: 'synced',
    }));
    expect(deps.bucket.put).toHaveBeenCalledWith(
      'users/user-1/projects/11/scenes/33.json',
      expect.any(String),
      expect.any(Object),
    );
  });
});

describe('story mirror worker access control', () => {
  it('does not process batch events when the authenticated user lacks story mirror access', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'free-user-1', email: 'free@example.com' });
      }
      if (target.includes('/rest/v1/story_mirror_settings')) {
        return jsonResponse([{
          key: 'global',
          enabled: true,
          test_only: false,
          test_user_ids: [],
          per_user_quota_bytes: DEFAULT_STORY_MIRROR_QUOTA_BYTES,
          updated_at: '2026-07-09T00:00:00.000Z',
        }]);
      }
      if (target.includes('/rest/v1/profiles')) {
        return jsonResponse([{
          user_id: 'free-user-1',
          email: 'free@example.com',
          system_role: 'user',
          status: 'active',
        }]);
      }
      if (target.includes('/rest/v1/access_versions')) {
        return jsonResponse([{ version: 1, updated_at: '2026-07-09T00:00:00.000Z' }]);
      }
      if (target.includes('/rest/v1/features')) {
        return jsonResponse([{ key: 'story_mirror.access', active: true }]);
      }
      if (target.includes('/rest/v1/plan_features')) {
        return jsonResponse([{ plan_id: 'plan-vip', feature_key: 'story_mirror.access', enabled: true }]);
      }
      if (target.includes('/rest/v1/consent_versions')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/user_plans')) {
        return jsonResponse([{
          id: 'plan-row-free',
          user_id: 'free-user-1',
          plan_id: 'plan-free',
          status: 'active',
          plans: { key: 'free', name: 'Free' },
        }]);
      }
      if (target.includes('/rest/v1/user_entitlement_overrides')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const response = await storyMirrorWorker.fetch(mirrorRequest('/mirror/v1/events/batch', {
      method: 'POST',
      body: JSON.stringify({ events: [baseEvent] }),
    }), createWorkerEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([expect.objectContaining({
      idempotencyKey: baseEvent.idempotencyKey,
      status: 'disabled',
      code: 'FEATURE_NOT_ALLOWED',
    })]);
    expect(calls.some((call) => call.url.includes('/rest/v1/story_mirror_events') && call.method === 'POST')).toBe(false);
    expect(calls.some((call) => call.url.includes('/rest/v1/story_mirror_projects') && call.method === 'POST')).toBe(false);
  });
});
