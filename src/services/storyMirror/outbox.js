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

    const installationId = await getStoryMirrorInstallationId();
    const clientIds = buildMirrorClientIds({
      installationId,
      projectId: project.id,
      chapterId: chapter.id,
      sceneId: scene.id,
    });
    const event = await buildSceneMirrorEvent({ project, chapter, scene, clientIds });
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
      payload: event,
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
    try {
      await db.storyMirrorStatus?.put?.({
        id: `enqueue:${scene?.id || 'unknown'}`,
        project_id: Number(scene?.project_id || 0),
        status: 'failed',
        last_error: error.message || 'Không enqueue được story mirror.',
        updated_at: nowMs(),
      });
    } catch {
      // Mirror status is best-effort and must never affect local writing.
    }
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
    try {
      await db.storyMirrorStatus?.put?.({
        id: `enqueue:${sceneId}`,
        project_id: 0,
        status: 'failed',
        last_error: error.message || 'Không enqueue được story mirror.',
        updated_at: nowMs(),
      });
    } catch {
      // Mirror status is best-effort and must never affect local writing.
    }
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

export async function flushStoryMirrorOutbox() {
  if (!canUseOutbox()) return { sent: 0, skipped: true };
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    const items = await loadDueOutboxItems();
    if (items.length === 0) return { sent: 0 };

    try {
      const response = await postStoryMirrorBatch(items.map((item) => item.payload));
      const resultsByKey = new Map((response.results || []).map((item) => [item.idempotencyKey, item]));

      await Promise.all(items.map(async (item) => {
        const result = resultsByKey.get(item.idempotency_key) || {};
        if (shouldDropResult(result)) {
          await db.storyMirrorOutbox.delete(item.id);
          return;
        }
        const attempts = Number(item.attempts || 0) + 1;
        if (shouldStopRetry(result) || attempts >= STORY_MIRROR_MAX_ATTEMPTS) {
          await db.storyMirrorOutbox.delete(item.id);
          await db.storyMirrorStatus?.put?.({
            id: item.id,
            project_id: Number(item.project_id || 0),
            status: 'failed',
            last_error: result.error || result.code || 'Story mirror tạm dừng.',
            updated_at: nowMs(),
          });
          return;
        }
        await db.storyMirrorOutbox.update(item.id, {
          attempts,
          last_error: result.error || result.code || 'Story mirror chưa đồng bộ được.',
          next_attempt_at: nowMs() + getRetryDelayMs(attempts - 1),
          updated_at: nowMs(),
        });
      }));

      return { sent: items.length, results: response.results || [] };
    } catch (error) {
      await Promise.all(items.map(async (item) => {
        const attempts = Number(item.attempts || 0) + 1;
        if (attempts >= STORY_MIRROR_MAX_ATTEMPTS) {
          await db.storyMirrorOutbox.delete(item.id);
          return;
        }
        await db.storyMirrorOutbox.update(item.id, {
          attempts,
          last_error: error.message || 'Không gửi được story mirror.',
          next_attempt_at: nowMs() + getRetryDelayMs(attempts - 1),
          updated_at: nowMs(),
        });
      }));
      return { sent: 0, error: error.message || 'Không gửi được story mirror.' };
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
