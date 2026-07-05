export const DEFAULT_STORY_MIRROR_QUOTA_BYTES = 100 * 1024 * 1024;
export const MAX_STORY_MIRROR_SCENE_BYTES = 2 * 1024 * 1024;

const TEXT_ENCODER = new TextEncoder();

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

function byteSize(value) {
  return TEXT_ENCODER.encode(String(value || '')).length;
}

function fallbackHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function sha256(value) {
  const text = String(value || '');
  if (!globalThis.crypto?.subtle) return fallbackHash(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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
    throw new Error('Invalid story mirror event.');
  }
  if (!toText(event.idempotencyKey)) throw new Error('Missing idempotencyKey.');
  if (!toText(event.project?.clientProjectId)) throw new Error('Missing clientProjectId.');
  if (!toText(event.chapter?.clientChapterId)) throw new Error('Missing clientChapterId.');
  if (!toText(event.scene?.clientSceneId)) throw new Error('Missing clientSceneId.');
  if (typeof event.scene?.content !== 'string') throw new Error('Missing scene content.');
  if (byteSize(event.scene.content) > MAX_STORY_MIRROR_SCENE_BYTES) {
    throw new Error('Scene content exceeds the Story Mirror limit.');
  }
}

function buildTrustedEvent(event) {
  const content = String(event.scene.content || '');
  return sha256(content).then((contentHash) => ({
    ...event,
    scene: {
      ...event.scene,
      content,
      contentHash,
      sizeBytes: byteSize(content),
    },
  }));
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
  if (!userId) throw new Error('Missing user for story mirror processing.');
  assertSceneEvent(event);
  const trustedEvent = await buildTrustedEvent(event);
  const sizeBytes = toNumber(trustedEvent.scene.sizeBytes);

  const existingEvent = await repo.findEventByKey(userId, trustedEvent.idempotencyKey);
  if (existingEvent) {
    return { idempotencyKey: trustedEvent.idempotencyKey, status: 'duplicate' };
  }

  const project = await repo.upsertProject(userId, {
    user_id: userId,
    client_project_id: trustedEvent.project.clientProjectId,
    title: trustedEvent.project.title || '',
    genre: trustedEvent.project.genre || '',
    status: trustedEvent.project.status || 'active',
    word_count: toNumber(trustedEvent.project.wordCount),
    client_updated_at: toIso(trustedEvent.project.updatedAt || trustedEvent.clientUpdatedAt),
  });

  const chapter = await repo.upsertChapter(userId, {
    user_id: userId,
    project_id: project.id,
    client_project_id: trustedEvent.project.clientProjectId,
    client_chapter_id: trustedEvent.chapter.clientChapterId,
    title: trustedEvent.chapter.title || '',
    order_index: toNumber(trustedEvent.chapter.orderIndex),
    status: trustedEvent.chapter.status || 'draft',
    word_count: toNumber(trustedEvent.chapter.wordCount),
  });

  const existingScene = await repo.findScene(userId, project.id, trustedEvent.scene.clientSceneId);
  if (existingScene?.client_updated_at && compareTime(existingScene.client_updated_at, trustedEvent.scene.updatedAt || trustedEvent.clientUpdatedAt) > 0) {
    await record(repo, userId, trustedEvent, 'stale', { metadata: { existingUpdatedAt: existingScene.client_updated_at } });
    return { idempotencyKey: trustedEvent.idempotencyKey, status: 'stale' };
  }

  const existingSize = toNumber(existingScene?.size_bytes);
  const currentUsage = await repo.getUserUsageBytes(userId);
  if ((currentUsage - existingSize + sizeBytes) > quotaBytes) {
    await record(repo, userId, trustedEvent, 'failed', { code: 'STORY_MIRROR_QUOTA_EXCEEDED' });
    return {
      idempotencyKey: trustedEvent.idempotencyKey,
      status: 'failed',
      code: 'STORY_MIRROR_QUOTA_EXCEEDED',
    };
  }

  if (existingScene?.content_hash && existingScene.content_hash === trustedEvent.scene.contentHash) {
    await record(repo, userId, trustedEvent, 'skipped', { metadata: { reason: 'hash-unchanged' } });
    return { idempotencyKey: trustedEvent.idempotencyKey, status: 'skipped' };
  }

  const storageKey = sceneStorageKey(userId, trustedEvent.project.clientProjectId, trustedEvent.scene.clientSceneId);
  const sceneObject = buildSceneObject({ event: trustedEvent, userId, storageKey });
  await bucket.put(storageKey, JSON.stringify(sceneObject), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      userId,
      clientProjectId: trustedEvent.project.clientProjectId,
      clientSceneId: trustedEvent.scene.clientSceneId,
    },
  });

  const scene = await repo.upsertScene(userId, {
    user_id: userId,
    project_id: project.id,
    chapter_id: chapter.id,
    client_project_id: trustedEvent.project.clientProjectId,
    client_chapter_id: trustedEvent.chapter.clientChapterId,
    client_scene_id: trustedEvent.scene.clientSceneId,
    title: trustedEvent.scene.title || '',
    order_index: toNumber(trustedEvent.scene.orderIndex),
    status: trustedEvent.scene.status || 'draft',
    word_count: toNumber(trustedEvent.scene.wordCount),
    content_hash: trustedEvent.scene.contentHash,
    size_bytes: sizeBytes,
    storage_key: storageKey,
    client_updated_at: toIso(trustedEvent.scene.updatedAt || trustedEvent.clientUpdatedAt),
  });

  const scenes = await repo.listProjectScenes(userId, project.id);
  const manifestKey = manifestStorageKey(userId, trustedEvent.project.clientProjectId);
  await bucket.put(manifestKey, JSON.stringify(buildManifest({ event: trustedEvent, userId, scenes })), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { userId, clientProjectId: trustedEvent.project.clientProjectId },
  });
  await repo.updateProjectStorageBytes(project.id, scenes.reduce((sum, item) => sum + toNumber(item.size_bytes), 0));
  await record(repo, userId, trustedEvent, 'synced', { metadata: { sceneId: scene.id } });
  return {
    idempotencyKey: trustedEvent.idempotencyKey,
    status: 'synced',
    projectId: project.id,
    sceneId: scene.id,
  };
}

export default {
  processStoryMirrorEvent,
};
