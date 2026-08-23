import {
  DEFAULT_PUBLIC_SETUP_GUIDES,
  SETUP_GUIDES_CACHE_TTL_MS,
  normalizePublicSetupGuideConfig,
} from '../../../packages/access/src/setupGuides.js';

const STORAGE_KEY = 'storyforge.setup-guides.v1';
let memoryCache = null;
let inFlightRequest = null;

function cloneConfig(config) {
  return {
    revision: config.revision,
    items: config.items.map((item) => ({ ...item })),
  };
}

function readStorage(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null');
    if (!parsed || !Number.isFinite(Number(parsed.cachedAt))) return null;
    return {
      cachedAt: Number(parsed.cachedAt),
      setupGuides: normalizePublicSetupGuideConfig(parsed.setupGuides),
    };
  } catch {
    return null;
  }
}

function writeStorage(storage, entry) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Storage can be unavailable in privacy mode; the in-memory cache remains valid.
  }
}

function resolveNow(now) {
  return typeof now === 'function' ? Number(now()) : Number(now ?? Date.now());
}

function getCachedEntry(storage) {
  if (memoryCache) return memoryCache;
  memoryCache = readStorage(storage);
  return memoryCache;
}

function isFreshCacheEntry(entry, nowMs) {
  if (!entry) return false;
  const ageMs = nowMs - entry.cachedAt;
  return ageMs >= 0 && ageMs < SETUP_GUIDES_CACHE_TTL_MS;
}

export async function getSetupGuides({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  now = Date.now,
} = {}) {
  const nowMs = resolveNow(now);
  const cached = getCachedEntry(storage);
  if (isFreshCacheEntry(cached, nowMs)) {
    return cloneConfig(cached.setupGuides);
  }

  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = (async () => {
    try {
      const response = await fetchImpl('/api/setup-guides', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response?.ok) throw new Error(`SETUP_GUIDES_HTTP_${response?.status || 0}`);
      const payload = await response.json();
      const setupGuides = normalizePublicSetupGuideConfig(payload?.setupGuides);
      const entry = { cachedAt: nowMs, setupGuides };
      memoryCache = entry;
      writeStorage(storage, entry);
      return cloneConfig(setupGuides);
    } catch {
      if (cached) return cloneConfig(cached.setupGuides);
      return cloneConfig(DEFAULT_PUBLIC_SETUP_GUIDES);
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}

export function clearSetupGuidesClientCacheForTests() {
  memoryCache = null;
  inFlightRequest = null;
}


