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

const AUTO_SYNC_INTERVAL_MS = 45000;

export default function CloudAutoSyncAgent() {
  useEffect(() => {
    if (!PRODUCT_SURFACE.enableCloudSync) {
      return undefined;
    }

    let stopped = false;

    const maybeRun = async (reason) => {
      if (stopped) return;
      const prefs = getCloudSyncPreferences();
      if (!prefs.autoSyncEnabled) return;

      const session = await getSession();
      if (!session?.user?.id) return;

      try {
        await runAutoSyncCycle({ reason });
      } catch (error) {
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
