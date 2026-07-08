import { useEffect } from 'react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import {
  getCloudSyncPreferences,
  runAutoSyncCycle,
} from '../../services/cloud/cloudAutoSyncService.js';
import {
  getSession,
  subscribe,
} from '../../services/cloud/cloudAuthService.js';

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_SYNC_SUCCESS_COOLDOWN_MS = 5 * 60 * 1000;
const AUTO_SYNC_ERROR_BACKOFF_STEPS_MS = [
  5 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
];

let autoSyncBackoffUntil = 0;
let autoSyncCooldownUntil = 0;
let autoSyncFailureCount = 0;

function isCloudAutoSyncEnabled() {
  const raw = import.meta.env?.VITE_CLOUD_AUTO_SYNC_ENABLED
    ?? import.meta.env?.CLOUD_AUTO_SYNC_ENABLED
    ?? 'true';
  return String(raw).trim().toLowerCase() !== 'false';
}

export function getCloudAutoSyncBackoffUntil() {
  return autoSyncBackoffUntil;
}

export function isCloudAutoSyncBackoffActive(now = Date.now()) {
  return Number(now || 0) < autoSyncBackoffUntil;
}

export function noteCloudAutoSyncFailure(now = Date.now(), backoffMs = null) {
  const explicitBackoff = Number(backoffMs || 0);
  const progressiveBackoff = AUTO_SYNC_ERROR_BACKOFF_STEPS_MS[
    Math.min(autoSyncFailureCount, AUTO_SYNC_ERROR_BACKOFF_STEPS_MS.length - 1)
  ];
  const nextBackoffMs = explicitBackoff > 0 ? explicitBackoff : progressiveBackoff;
  autoSyncFailureCount += 1;
  const nextBackoffUntil = Number(now || 0) + nextBackoffMs;
  autoSyncBackoffUntil = Math.max(autoSyncBackoffUntil, nextBackoffUntil);
  return autoSyncBackoffUntil;
}

export function clearCloudAutoSyncBackoff() {
  autoSyncBackoffUntil = 0;
  autoSyncFailureCount = 0;
}

export function getCloudAutoSyncCooldownUntil() {
  return autoSyncCooldownUntil;
}

export function isCloudAutoSyncCooldownActive(now = Date.now()) {
  return Number(now || 0) < autoSyncCooldownUntil;
}

export function noteCloudAutoSyncSuccess(now = Date.now()) {
  autoSyncFailureCount = 0;
  autoSyncBackoffUntil = 0;
  autoSyncCooldownUntil = Number(now || 0) + AUTO_SYNC_SUCCESS_COOLDOWN_MS;
  return autoSyncCooldownUntil;
}

export function clearCloudAutoSyncCooldown() {
  autoSyncCooldownUntil = 0;
}

export default function CloudAutoSyncAgent() {
  useEffect(() => {
    if (!PRODUCT_SURFACE.enableCloudSync) {
      return undefined;
    }

    let stopped = false;

    const maybeRun = async (reason) => {
      if (stopped) return;
      if (!isCloudAutoSyncEnabled()) return;
      const prefs = getCloudSyncPreferences();
      if (!prefs.autoSyncEnabled) return;
      if (isCloudAutoSyncBackoffActive()) return;
      if (isCloudAutoSyncCooldownActive()) return;

      const session = await getSession();
      if (!session?.user?.id) return;

      try {
        await runAutoSyncCycle({ reason });
        noteCloudAutoSyncSuccess();
      } catch (error) {
        noteCloudAutoSyncFailure();
        console.warn('[CloudSync] Auto sync failed:', error);
      }
    };

    maybeRun('agent-mount').catch(() => {});
    const intervalId = window.setInterval(() => {
      maybeRun('interval').catch(() => {});
    }, AUTO_SYNC_INTERVAL_MS);

    const handleFocus = () => {
      maybeRun('focus').catch(() => {});
    };
    const handleOnline = () => {
      maybeRun('online').catch(() => {});
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        maybeRun('visible').catch(() => {});
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    const unsubscribe = subscribe((session) => {
      if (session?.user?.id) {
        maybeRun('auth-change').catch(() => {});
      }
    });

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
    };
  }, []);

  return null;
}
