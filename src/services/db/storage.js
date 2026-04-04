/**
 * StoryForge — Storage Manager
 *
 * Handles persistent storage quota for IndexedDB.
 * Default temporary storage is ~50MB. Requesting persistent storage
 * allows browsers to allocate significantly more (up to 60% of disk
 * on Chrome/Edge, more on Firefox).
 *
 * Usage: call `initStorage()` on app startup.
 * Call `getStorageInfo()` to display usage in the UI.
 */

const STORAGE_KEY = 'sf-storage-initialized';
const PERSIST_KEY = 'sf-storage-persistent';

/**
 * Request persistent storage from the browser.
 * This is the key to bypassing the ~50MB temporary quota.
 *
 * @returns {Promise<{success: boolean, persisted: boolean, error?: string}>}
 */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return { success: false, persisted: false, error: 'Storage API not supported' };
  }

  try {
    const persisted = await navigator.storage.persist();
    localStorage.setItem(PERSIST_KEY, persisted ? '1' : '0');
    return { success: true, persisted };
  } catch (err) {
    return { success: false, persisted: false, error: err.message };
  }
}

/**
 * Check if storage is already persisted.
 */
export async function isStoragePersisted() {
  if (!navigator.storage || !navigator.storage.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Get current storage usage and quota information.
 *
 * @returns {Promise<{usage: number, quota: number, percentUsed: number, persisted: boolean}>}
 */
export async function getStorageInfo() {
  const persisted = await isStoragePersisted();

  if (!navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0, percentUsed: 0, persisted };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
    return { usage, quota, percentUsed, persisted };
  } catch {
    return { usage: 0, quota: 0, percentUsed: 0, persisted };
  }
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if storage is running low (< 100MB remaining or < 20%).
 * @returns {Promise<{low: boolean, remainingMB: number, percentFree: number}>}
 */
export async function isStorageLow() {
  const info = await getStorageInfo();
  if (!info.quota) return { low: false, remainingMB: Infinity, percentFree: 100 };

  const remainingMB = (info.quota - info.usage) / (1024 * 1024);
  const percentFree = 100 - info.percentUsed;

  // Low if: < 100MB remaining OR < 10% free
  return {
    low: remainingMB < 100 || percentFree < 10,
    remainingMB: Math.round(remainingMB * 10) / 10,
    percentFree: Math.round(percentFree * 10) / 10,
  };
}

/**
 * Initialize storage on app startup.
 * Automatically requests persistent storage if not already granted.
 * Non-blocking — failures are silently handled.
 */
export async function initStorage() {
  // Skip if already initialized this session
  if (localStorage.getItem(STORAGE_KEY) === '1') return;

  try {
    const alreadyPersisted = await isStoragePersisted();
    if (!alreadyPersisted) {
      const result = await requestPersistentStorage();
      if (result.persisted) {
        console.log('[Storage] Persistent storage granted. Higher quota available.');
      } else {
        console.warn('[Storage] Persistent storage denied. Using default quota (~50MB).');
      }
    }
    localStorage.setItem(STORAGE_KEY, '1');
  } catch (err) {
    console.warn('[Storage] Initialization failed:', err);
  }
}

export default {
  initStorage,
  getStorageInfo,
  isStorageLow,
  isStoragePersisted,
  requestPersistentStorage,
  formatBytes,
};
