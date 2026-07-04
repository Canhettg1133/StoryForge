export const DEFAULT_STORY_MIRROR_QUOTA_BYTES = 100 * 1024 * 1024;

function toText(value) {
  return String(value ?? '').trim();
}

function toIso(value, fallback = Date.now()) {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date(fallback).toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareTime(left, right) {
  return Date.parse(toIso(left, 0)) - Date.parse(toIso(right, 0));
}

function sceneStorageKey(userId, clientProjectId, clientSceneId) {
  return [
    'users',
    encodeURIComponent(userId),
    'projects',
    encodeURIComponent(clientProjectId),
    'scenes',
    `${encodeURIComponent(clientSceneId)}.json`,
  ].join('/');
}

function manifestStorageKey(userId, clientProjectId) {
  return [
    'users',
    encodeURIComponent(userId),
    'projects',
    encodeURIComponent(clientProjectId),
    'manifest.json',
  ].join('/');
}

function assertSceneEvent(event) {
  if (!event || event.resourceType !== 'scene.upsert') {
    throw new Error('Event story mirror không hợp lệ.');
  }
  if (!toText(event.idempotencyKey)) throw new Error('Thiếu idempotencyKey.');
  if (!toText(event.project?.clientProjectId)) throw new Error('Thiếu clientProjectId.');
  if (!toText(event.chapter?.clientChapterId)) throw new Error('Thiếu clientChapterId.');
  if (!toText(event.scene?.clientSceneId)) throw new Error('Thiếu clientSceneId.');
  if (!toText(event.scene?.contentHash)) throw new Error('Thiếu contentHash.');
}

function buildSceneObject({ event, userId, storageKey }) {
  return {
    payloadVersion: 1,
    userId,
    project: event.project,
    chapter: event.chapter,
    scene: {
      ...event.scene,
      storageKey,
    },
    mirroredAt: new Date().toISOString(),
  };
}

function buildManifest({ event, userId, scenes = [] }) {
  return {
    payloadVersion: 1,
    userId,
    project: event.project,
    chapters: [event.chapter],
    scenes: scenes.map((scene) => ({
      id: scene.id,
      clientSceneId: scene.client_scene_id,
      clientChapterId: scene.client_chapter_id,
      title: scene.title,
      orderIndex: scene.order_index,
      status: scene.status,
      contentHash: scene.content_hash,
      sizeBytes: scene.size_bytes,
      storageKey: scene.storage_key,
      updatedAt: scene.client_updated_at,
    })),
    updatedAt: event.clientUpdatedAt || event.scene.updatedAt,
  };
}

async function record(repo, userId, event, status, extra = {}) {
  await repo.recordEvent({
    user_id: userId,
    idempotency_key: event.idempotencyKey,
    resource_type: event.resourceType,
    client_project_id: event.project?.clientProjectId || '',
    client_scene_id: event.scene?.clientSceneId || '',
    status,
    error_code: extra.code || '',
    error_message: extra.error || '',
    metadata: extra.metadata || {},
  });
}

export async function processStoryMirrorEvent({
  event,
  user,
  quotaBytes = DEFAULT_STORY_MIRROR_QUOTA_BYTES,
  repo,
  bucket,
} = {}) {
  const userId = toText(user?.id);
  if (!userId) throw new Error('Thiếu user để xử lý story mirror.');
  assertSceneEvent(event);

  const existingEvent = await repo.findEventByKey(userId, event.idempotencyKey);
  if (existingEvent) {
    return { idempotencyKey: event.idempotencyKey, status: 'duplicate' };
  }

  const project = await repo.upsertProject(userId, {
    user_id: userId,
    client_project_id: event.project.clientProjectId,
    title: event.project.title || '',
    genre: event.project.genre || '',
    status: event.project.status || 'active',
    word_count: toNumber(event.project.wordCount),
    client_updated_at: toIso(event.project.updatedAt || event.clientUpdatedAt),
  });

  const chapter = await repo.upsertChapter(userId, {
    user_id: userId,
    project_id: project.id,
    client_project_id: event.project.clientProjectId,
    client_chapter_id: event.chapter.clientChapterId,
    title: event.chapter.title || '',
    order_index: toNumber(event.chapter.orderIndex),
    status: event.chapter.status || 'draft',
    word_count: toNumber(event.chapter.wordCount),
  });

  const existingScene = await repo.findScene(userId, project.id, event.scene.clientSceneId);
  if (existingScene?.client_updated_at && compareTime(existingScene.client_updated_at, event.scene.updatedAt || event.clientUpdatedAt) > 0) {
    await record(repo, userId, event, 'stale', { metadata: { existingUpdatedAt: existingScene.client_updated_at } });
    return { idempotencyKey: event.idempotencyKey, status: 'stale' };
  }

  const sizeBytes = toNumber(event.scene.sizeBytes, new TextEncoder().encode(event.scene.content || '').length);
  const existingSize = toNumber(existingScene?.size_bytes);
  const currentUsage = await repo.getUserUsageBytes(userId);
  if ((currentUsage - existingSize + sizeBytes) > quotaBytes) {
    await record(repo, userId, event, 'failed', { code: 'STORY_MIRROR_QUOTA_EXCEEDED' });
    return {
      idempotencyKey: event.idempotencyKey,
      status: 'failed',
      code: 'STORY_MIRROR_QUOTA_EXCEEDED',
    };
  }

  if (existingScene?.content_hash && existingScene.content_hash === event.scene.contentHash) {
    await record(repo, userId, event, 'skipped', { metadata: { reason: 'hash-unchanged' } });
    return { idempotencyKey: event.idempotencyKey, status: 'skipped' };
  }

  const storageKey = sceneStorageKey(userId, event.project.clientProjectId, event.scene.clientSceneId);
  const sceneObject = buildSceneObject({ event, userId, storageKey });
  await bucket.put(storageKey, JSON.stringify(sceneObject), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      userId,
      clientProjectId: event.project.clientProjectId,
      clientSceneId: event.scene.clientSceneId,
    },
  });

  const scene = await repo.upsertScene(userId, {
    user_id: userId,
    project_id: project.id,
    chapter_id: chapter.id,
    client_project_id: event.project.clientProjectId,
    client_chapter_id: event.chapter.clientChapterId,
    client_scene_id: event.scene.clientSceneId,
    title: event.scene.title || '',
    order_index: toNumber(event.scene.orderIndex),
    status: event.scene.status || 'draft',
    word_count: toNumber(event.scene.wordCount),
    content_hash: event.scene.contentHash,
    size_bytes: sizeBytes,
    storage_key: storageKey,
    client_updated_at: toIso(event.scene.updatedAt || event.clientUpdatedAt),
  });

  const scenes = await repo.listProjectScenes(userId, project.id);
  const manifestKey = manifestStorageKey(userId, event.project.clientProjectId);
  await bucket.put(manifestKey, JSON.stringify(buildManifest({ event, userId, scenes })), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { userId, clientProjectId: event.project.clientProjectId },
  });
  await repo.updateProjectStorageBytes(project.id, scenes.reduce((sum, item) => sum + toNumber(item.size_bytes), 0));
  await record(repo, userId, event, 'synced', { metadata: { sceneId: scene.id, storageKey } });
  return {
    idempotencyKey: event.idempotencyKey,
    status: 'synced',
    projectId: project.id,
    sceneId: scene.id,
    storageKey,
  };
}

export default {
  processStoryMirrorEvent,
};
