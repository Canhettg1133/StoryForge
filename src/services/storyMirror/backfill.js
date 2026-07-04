import db from '../db/database.js';
import { isCloudAuthConfigured } from '../cloud/cloudAuthService.js';
import { getStoryMirrorStatus } from './apiClient.js';
import {
  STORY_MIRROR_BACKFILL_BATCH_SIZE,
  STORY_MIRROR_BACKFILL_IDLE_DELAY_MS,
  isStoryMirrorEnabled,
} from './config.js';
import { hasMirrorText } from './payloadBuilder.js';
import { queueSceneMirrorRecord, scheduleStoryMirrorFlush } from './outbox.js';

export const STORY_MIRROR_BACKFILL_STATUS_KEY = 'backfill:v1';
export const STORY_MIRROR_BACKFILL_EVENT = 'story-mirror-backfill-status';

let runningPromise = null;
let scheduled = false;

function nowMs() {
  return Date.now();
}

function defaultStatus() {
  return {
    id: STORY_MIRROR_BACKFILL_STATUS_KEY,
    project_id: 0,
    status: isStoryMirrorEnabled() && isCloudAuthConfigured() ? 'idle' : 'disabled',
    scanned_count: 0,
    queued_count: 0,
    skipped_count: 0,
    last_error: '',
    reason: '',
    updated_at: 0,
  };
}

function toPublicStatus(row = {}) {
  return {
    ...row,
    scannedCount: Number(row.scanned_count ?? row.scannedCount ?? 0),
    queuedCount: Number(row.queued_count ?? row.queuedCount ?? 0),
    skippedCount: Number(row.skipped_count ?? row.skippedCount ?? 0),
    lastError: String(row.last_error ?? row.lastError ?? ''),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0),
  };
}

function emitStatus(row) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORY_MIRROR_BACKFILL_EVENT, { detail: toPublicStatus(row) }));
}

async function saveStatus(patch = {}) {
  const previous = await db?.storyMirrorStatus?.get?.(STORY_MIRROR_BACKFILL_STATUS_KEY).catch(() => null);
  const row = {
    ...defaultStatus(),
    ...(previous || {}),
    ...patch,
    id: STORY_MIRROR_BACKFILL_STATUS_KEY,
    project_id: 0,
    updated_at: nowMs(),
  };
  await db?.storyMirrorStatus?.put?.(row);
  emitStatus(row);
  return toPublicStatus(row);
}

function waitForIdle() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (typeof window.requestIdleCallback === 'function') {
    return new Promise((resolve) => window.requestIdleCallback(() => resolve(), { timeout: 500 }));
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function readRemoteAccess() {
  if (!isStoryMirrorEnabled()) {
    return { ok: false, reason: 'STORY_MIRROR_DISABLED_LOCAL', message: 'Story Mirror chưa được bật trên bản build này.' };
  }
  if (!isCloudAuthConfigured()) {
    return {
      ok: false,
      reason: 'STORY_MIRROR_AUTH_UNCONFIGURED',
      message: 'Supabase Auth chưa được cấu hình trong môi trường hiện tại.',
    };
  }

  try {
    const status = await getStoryMirrorStatus();
    if (!status?.enabled) {
      return {
        ok: false,
        reason: status?.disabledCode || 'STORY_MIRROR_DISABLED',
        message: 'Story Mirror chưa được bật cho tài khoản này.',
      };
    }
    if (Number(status.quotaBytes || 0) > 0 && Number(status.usedBytes || 0) >= Number(status.quotaBytes || 0)) {
      return {
        ok: false,
        reason: 'STORY_MIRROR_QUOTA_EXCEEDED',
        message: 'Dung lượng mirror đã hết.',
      };
    }
    return { ok: true, status };
  } catch (error) {
    return {
      ok: false,
      reason: error.code || 'STORY_MIRROR_STATUS_FAILED',
      message: error.message || 'Không kiểm tra được trạng thái Story Mirror.',
    };
  }
}

async function loadProjectScenes(projectId) {
  const [chapters, scenes] = await Promise.all([
    db.chapters.where('project_id').equals(projectId).toArray(),
    db.scenes.where('project_id').equals(projectId).toArray(),
  ]);
  const chaptersById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  return scenes
    .map((scene) => ({ scene, chapter: chaptersById.get(scene.chapter_id) }))
    .filter((item) => item.chapter)
    .sort((left, right) => {
      const chapterOrder = Number(left.chapter.order_index || 0) - Number(right.chapter.order_index || 0);
      if (chapterOrder !== 0) return chapterOrder;
      return Number(left.scene.order_index || 0) - Number(right.scene.order_index || 0);
    });
}

export async function readStoryMirrorBackfillStatus() {
  const row = await db?.storyMirrorStatus?.get?.(STORY_MIRROR_BACKFILL_STATUS_KEY).catch(() => null);
  return toPublicStatus({ ...defaultStatus(), ...(row || {}) });
}

export async function runStoryMirrorBackfill({ force = false, reason = 'manual' } = {}) {
  if (runningPromise) return runningPromise;

  runningPromise = (async () => {
    try {
      const previous = await readStoryMirrorBackfillStatus();
      if (!force && previous.status === 'completed') {
        return previous;
      }

      const access = await readRemoteAccess();
      if (!access.ok) {
        return saveStatus({
          status: 'paused',
          reason: access.reason,
          last_error: access.message,
        });
      }

      let scannedCount = 0;
      let queuedCount = 0;
      let skippedCount = 0;
      const batchSize = Math.max(Number(STORY_MIRROR_BACKFILL_BATCH_SIZE) || 25, 1);
      await saveStatus({
        status: 'scanning',
        reason,
        last_error: '',
        scanned_count: scannedCount,
        queued_count: queuedCount,
        skipped_count: skippedCount,
        started_at: nowMs(),
      });

      const projects = await db.projects.toArray();
      for (const project of projects) {
        const sceneItems = await loadProjectScenes(project.id);
        for (const { scene, chapter } of sceneItems) {
          scannedCount += 1;
          if (!hasMirrorText(scene.draft_text, scene.final_text)) {
            skippedCount += 1;
          } else {
            const result = await queueSceneMirrorRecord({
              project,
              chapter,
              scene,
              scheduleFlush: false,
            });
            if (result.queued) queuedCount += 1;
            else skippedCount += 1;
          }

          if (scannedCount % batchSize === 0) {
            await saveStatus({
              status: 'scanning',
              reason,
              scanned_count: scannedCount,
              queued_count: queuedCount,
              skipped_count: skippedCount,
            });
            scheduleStoryMirrorFlush(0);
            await waitForIdle();
          }
        }
      }

      scheduleStoryMirrorFlush(0);
      return saveStatus({
        status: 'completed',
        reason,
        scanned_count: scannedCount,
        queued_count: queuedCount,
        skipped_count: skippedCount,
        completed_at: nowMs(),
        last_error: '',
      });
    } catch (error) {
      return saveStatus({
        status: 'failed',
        reason: error.code || 'STORY_MIRROR_BACKFILL_FAILED',
        last_error: error.message || 'Không đồng bộ được truyện cũ.',
      });
    } finally {
      runningPromise = null;
    }
  })();

  return runningPromise;
}

export function scheduleStoryMirrorBackfill({ force = false, delayMs = STORY_MIRROR_BACKFILL_IDLE_DELAY_MS } = {}) {
  if (scheduled || !isStoryMirrorEnabled() || !isCloudAuthConfigured() || typeof window === 'undefined') return;
  scheduled = true;

  const run = () => {
    scheduled = false;
    void runStoryMirrorBackfill({ force, reason: 'auto' });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: Math.max(Number(delayMs) || 0, 1) });
    return;
  }
  window.setTimeout(run, Math.max(Number(delayMs) || 0, 0));
}

export default {
  STORY_MIRROR_BACKFILL_EVENT,
  STORY_MIRROR_BACKFILL_STATUS_KEY,
  readStoryMirrorBackfillStatus,
  runStoryMirrorBackfill,
  scheduleStoryMirrorBackfill,
};
