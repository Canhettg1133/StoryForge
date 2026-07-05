import db from '../db/database.js';
import { buildSceneMirrorEvent } from './payloadBuilder.js';
import { postStoryMirrorBatch } from './apiClient.js';
import { buildMirrorClientIds, getStoryMirrorInstallationId } from './identity.js';
import {
  STORY_MIRROR_DEBOUNCE_MS,
  STORY_MIRROR_MAX_ATTEMPTS,
  STORY_MIRROR_OUTBOX_LIMIT,
  getRetryDelayMs,
  isStoryMirrorEnabled,
} from './config.js';

let flushTimer = null;
let flushPromise = null;

function nowMs() {
  return Date.now();
}

function canUseOutbox() {
  return Boolean(isStoryMirrorEnabled() && db?.storyMirrorOutbox);
}

function shouldDropResult(result = {}) {
  return ['synced', 'duplicate', 'stale', 'skipped', 'disabled'].includes(String(result.status || '').toLowerCase());
}

function shouldStopRetry(result = {}) {
  return ['STORY_MIRROR_QUOTA_EXCEEDED', 'STORY_MIRROR_DISABLED', 'STORY_MIRROR_TEST_ONLY'].includes(result.code);
}

async function buildEventFromRecords({ project, chapter, scene } = {}) {
  const installationId = await getStoryMirrorInstallationId();
  const clientIds = buildMirrorClientIds({
    installationId,
    projectId: project.id,
    chapterId: chapter.id,
    sceneId: scene.id,
  });
  return buildSceneMirrorEvent({ project, chapter, scene, clientIds });
}

async function buildEventForOutboxItem(item = {}) {
  const sceneId = Number(item.scene_id || 0);
  const scene = sceneId ? await db.scenes.get(sceneId) : null;
  if (!scene?.project_id || !scene?.chapter_id) return null;

  const [project, chapter] = await Promise.all([
    db.projects.get(scene.project_id),
    db.chapters.get(scene.chapter_id),
  ]);
  if (!project || !chapter) return null;

  return buildEventFromRecords({ project, chapter, scene });
}

async function putMirrorStatus(row) {
  await db.storyMirrorStatus?.put?.({
    ...row,
    updated_at: nowMs(),
  }).catch(() => null);
}

export function scheduleStoryMirrorFlush(delayMs = STORY_MIRROR_DEBOUNCE_MS) {
  if (!canUseOutbox() || typeof window === 'undefined') return;
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushStoryMirrorOutbox({ reason: 'debounce' });
  }, delayMs);
}

export async function queueSceneMirrorRecord({
  project,
  chapter,
  scene,
  scheduleFlush = true,
} = {}) {
  if (!canUseOutbox()) return { queued: false, reason: 'disabled' };

  try {
    if (!scene?.project_id || !scene?.chapter_id) return { queued: false, reason: 'missing-scene' };
    if (!project || !chapter) return { queued: false, reason: 'missing-parent' };

    const event = await buildEventFromRecords({ project, chapter, scene });
    const outboxId = `scene:${event.project.clientProjectId}:${event.scene.clientSceneId}`;
    const createdAt = nowMs();
    await db.storyMirrorOutbox.put({
      id: outboxId,
      resource_type: event.resourceType,
      project_id: Number(scene.project_id),
      chapter_id: Number(scene.chapter_id),
      scene_id: Number(scene.id),
      content_hash: event.scene.contentHash,
      idempotency_key: event.idempotencyKey,
      attempts: 0,
      status: 'queued',
      last_error: '',
      next_attempt_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (scheduleFlush) scheduleStoryMirrorFlush();
    return { queued: true, id: outboxId };
  } catch (error) {
    await putMirrorStatus({
      id: `enqueue:${scene?.id || 'unknown'}`,
      project_id: Number(scene?.project_id || 0),
      status: 'failed',
      last_error: error.message || 'Story mirror enqueue failed.',
    });
    return { queued: false, reason: 'error' };
  }
}

export async function enqueueSceneMirror(sceneId, options = {}) {
  if (!canUseOutbox()) return { queued: false, reason: 'disabled' };

  try {
    const scene = await db.scenes.get(sceneId);
    if (!scene?.project_id || !scene?.chapter_id) return { queued: false, reason: 'missing-scene' };
    const [project, chapter] = await Promise.all([
      db.projects.get(scene.project_id),
      db.chapters.get(scene.chapter_id),
    ]);
    if (!project || !chapter) return { queued: false, reason: 'missing-parent' };

    return queueSceneMirrorRecord({ project, chapter, scene, ...options });
  } catch (error) {
    await putMirrorStatus({
      id: `enqueue:${sceneId}`,
      project_id: 0,
      status: 'failed',
      last_error: error.message || 'Story mirror enqueue failed.',
    });
    return { queued: false, reason: 'error' };
  }
}

async function loadDueOutboxItems(limit = STORY_MIRROR_OUTBOX_LIMIT) {
  const current = nowMs();
  const items = await db.storyMirrorOutbox.toArray();
  return items
    .filter((item) => String(item.status || 'queued') === 'queued')
    .filter((item) => Number(item.next_attempt_at || 0) <= current)
    .sort((left, right) => Number(left.updated_at || 0) - Number(right.updated_at || 0))
    .slice(0, limit);
}

async function prepareOutboxEvents(items) {
  const prepared = [];
  for (const item of items) {
    try {
      const event = await buildEventForOutboxItem(item);
      if (!event) {
        await db.storyMirrorOutbox.delete(item.id);
        await putMirrorStatus({
          id: item.id,
          project_id: Number(item.project_id || 0),
          status: 'failed',
          last_error: 'Story mirror parent records are missing.',
        });
        continue;
      }
      prepared.push({ item, event });
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      await db.storyMirrorOutbox.update(item.id, {
        attempts,
        last_error: error.message || 'Story mirror payload rebuild failed.',
        next_attempt_at: nowMs() + getRetryDelayMs(attempts - 1),
        updated_at: nowMs(),
      });
    }
  }
  return prepared;
}

export async function flushStoryMirrorOutbox() {
  if (!canUseOutbox()) return { sent: 0, skipped: true };
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    const items = await loadDueOutboxItems();
    if (items.length === 0) return { sent: 0 };

    const prepared = await prepareOutboxEvents(items);
    if (prepared.length === 0) return { sent: 0 };

    try {
      const response = await postStoryMirrorBatch(prepared.map(({ event }) => event));
      const resultsByKey = new Map((response.results || []).map((item) => [item.idempotencyKey, item]));

      await Promise.all(prepared.map(async ({ item, event }) => {
        const result = resultsByKey.get(event.idempotencyKey) || {};
        if (shouldDropResult(result)) {
          await db.storyMirrorOutbox.delete(item.id);
          return;
        }
        const attempts = Number(item.attempts || 0) + 1;
        if (shouldStopRetry(result) || attempts >= STORY_MIRROR_MAX_ATTEMPTS) {
          await db.storyMirrorOutbox.delete(item.id);
          await putMirrorStatus({
            id: item.id,
            project_id: Number(item.project_id || 0),
            status: 'failed',
            last_error: result.error || result.code || 'Story mirror paused.',
          });
          return;
        }
        await db.storyMirrorOutbox.update(item.id, {
          attempts,
          content_hash: event.scene.contentHash,
          idempotency_key: event.idempotencyKey,
          last_error: result.error || result.code || 'Story mirror has not synced yet.',
          next_attempt_at: nowMs() + getRetryDelayMs(attempts - 1),
          updated_at: nowMs(),
        });
      }));

      return { sent: prepared.length, results: response.results || [] };
    } catch (error) {
      await Promise.all(prepared.map(async ({ item, event }) => {
        const attempts = Number(item.attempts || 0) + 1;
        if (attempts >= STORY_MIRROR_MAX_ATTEMPTS) {
          await db.storyMirrorOutbox.delete(item.id);
          return;
        }
        await db.storyMirrorOutbox.update(item.id, {
          attempts,
          content_hash: event.scene.contentHash,
          idempotency_key: event.idempotencyKey,
          last_error: error.message || 'Story mirror send failed.',
          next_attempt_at: nowMs() + getRetryDelayMs(attempts - 1),
          updated_at: nowMs(),
        });
      }));
      return { sent: 0, error: error.message || 'Story mirror send failed.' };
    }
  })();

  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
}

export default {
  enqueueSceneMirror,
  flushStoryMirrorOutbox,
  scheduleStoryMirrorFlush,
};
