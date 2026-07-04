import { flushStoryMirrorOutbox } from './outbox.js';
import { scheduleStoryMirrorBackfill } from './backfill.js';
import { isStoryMirrorEnabled } from './config.js';

let initialized = false;

export function initStoryMirrorRuntime() {
  if (initialized || !isStoryMirrorEnabled() || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('online', () => {
    void flushStoryMirrorOutbox({ reason: 'online' });
    scheduleStoryMirrorBackfill();
  });

  window.addEventListener('beforeunload', () => {
    void flushStoryMirrorOutbox({ reason: 'beforeunload' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushStoryMirrorOutbox({ reason: 'hidden' });
    }
  });

  scheduleStoryMirrorBackfill();
}

export default {
  initStoryMirrorRuntime,
};
