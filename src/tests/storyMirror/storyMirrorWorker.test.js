import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STORY_MIRROR_QUOTA_BYTES,
  processStoryMirrorEvent,
} from '../../../apps/story-mirror-worker/src/eventProcessor.js';

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
