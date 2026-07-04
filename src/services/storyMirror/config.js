export const STORY_MIRROR_OUTBOX_LIMIT = 25;
export const STORY_MIRROR_DEBOUNCE_MS = 45_000;
export const STORY_MIRROR_MAX_ATTEMPTS = 5;
export const STORY_MIRROR_BACKFILL_BATCH_SIZE = 25;
export const STORY_MIRROR_BACKFILL_IDLE_DELAY_MS = 15_000;

const DEFAULT_BASE_URL = String(import.meta.env.VITE_STORY_MIRROR_BASE_URL || '').trim();
const ENABLED = import.meta.env.VITE_ENABLE_STORY_MIRROR === 'true';

export function isStoryMirrorEnabled() {
  return Boolean(ENABLED && DEFAULT_BASE_URL);
}

export function getStoryMirrorBaseUrl() {
  return DEFAULT_BASE_URL.replace(/\/+$/u, '');
}

export function getRetryDelayMs(attempts = 0) {
  const schedule = [60_000, 300_000, 900_000, 3_600_000];
  return schedule[Math.min(Math.max(Number(attempts) || 0, 0), schedule.length - 1)];
}

export default {
  isStoryMirrorEnabled,
  getStoryMirrorBaseUrl,
  getRetryDelayMs,
};
