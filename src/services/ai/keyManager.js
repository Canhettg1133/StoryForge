/**
 * StoryForge — Key Manager
 * 
 * Quản lý API keys RIÊNG BIỆT cho từng provider:
 *   - gemini_direct: keys từ Google AI Studio (free tier)
 *   - gemini_proxy: keys từ 星星公益站 proxy
 *   - openai_proxy: keys từ Custom OpenAI-compatible proxy
 * 
 * Mỗi pool có rotation riêng, rate limit riêng.
 * Hoạt động tối ưu: 1 key (no overhead) hoặc N keys (round-robin).
 */

const STORAGE_KEY = 'sf-api-keys-v2';
const RATE_LIMIT_COOLDOWN = 60000;
const RESERVATION_WINDOW_MS = 60000;

export const DEFAULT_AI_RPM_PER_KEY = 5;

export function normalizeAiRpmPerKey(value = DEFAULT_AI_RPM_PER_KEY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_AI_RPM_PER_KEY;
  return Math.floor(parsed);
}

function normalizeProviderKey(provider) {
  const key = String(provider || '').trim();
  if (key === 'custom_openai_proxy') return 'openai_proxy';
  return key;
}

class KeyManager {
  constructor() {
    // Separate key pools per provider
    this.pools = {
      gemini_direct: [],  // [{ key, label }]
      gemini_proxy: [],   // [{ key, label }]
      openai_proxy: [],   // [{ key, label }]
      cloudflare_workers_ai: [], // [{ key, label }]
    };
    this.currentIndex = {
      gemini_direct: 0,
      gemini_proxy: 0,
      openai_proxy: 0,
      cloudflare_workers_ai: 0,
    };
    this.rateLimited = new Map(); // key → timestamp
    this.reservations = new Map(); // key -> request timestamps in the current minute
    this._load();
  }

  // --- Storage ---
  _load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const openAIProxyKeys = Array.isArray(parsed.openai_proxy) && parsed.openai_proxy.length > 0
          ? parsed.openai_proxy
          : (parsed.custom_openai_proxy || []);
        this.pools = {
          gemini_direct: parsed.gemini_direct || [],
          gemini_proxy: parsed.gemini_proxy || [],
          openai_proxy: openAIProxyKeys,
          cloudflare_workers_ai: parsed.cloudflare_workers_ai || [],
        };
      }
    } catch (e) {
      console.warn('KeyManager: Failed to load keys', e);
    }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pools));
  }

  // --- Get/Set keys for a specific provider ---
  getKeys(provider) {
    return this.pools[normalizeProviderKey(provider)] || [];
  }

  getKeyCount(provider) {
    return (this.pools[normalizeProviderKey(provider)] || []).length;
  }

  /**
   * Add keys for a provider (bulk import) — APPENDS, does not replace.
   * Skips duplicates.
   * @param {string} provider - 'gemini_direct' | 'gemini_proxy'
   * @param {string[]} keys - array of key strings
   * @returns {{ added: number, skipped: number }}
   */
  setKeys(provider, keys) {
    const poolKey = normalizeProviderKey(provider);
    if (!this.pools[poolKey]) this.pools[poolKey] = [];
    const existing = new Set(this.pools[poolKey].map(k => k.key));
    let added = 0;
    let skipped = 0;
    for (const raw of keys) {
      const key = raw.trim();
      if (!key || (poolKey !== 'gemini_direct' && key.length < 10)) continue;
      if (existing.has(key)) {
        skipped++;
        continue;
      }
      existing.add(key);
      this.pools[poolKey].push({
        key,
        label: `Key ${this.pools[poolKey].length + 1}`,
      });
      added++;
    }
    this._save();
    return { added, skipped };
  }

  /**
   * Replace one provider pool in a single persisted write.
   * Used when switching a saved provider set so URL and keys stay paired.
   */
  replaceKeys(provider, keys = []) {
    const poolKey = normalizeProviderKey(provider);
    const previousKeys = new Set((this.pools[poolKey] || []).map((entry) => entry.key));
    const seen = new Set();
    const normalized = [];

    for (const rawEntry of Array.isArray(keys) ? keys : []) {
      const rawKey = typeof rawEntry === 'string' ? rawEntry : rawEntry?.key;
      const key = String(rawKey || '').trim();
      if (!key || seen.has(key) || (poolKey !== 'gemini_direct' && key.length < 10)) continue;
      seen.add(key);
      normalized.push({
        key,
        label: String(typeof rawEntry === 'string' ? '' : rawEntry?.label || '').trim()
          || `Key ${normalized.length + 1}`,
      });
    }

    this.pools[poolKey] = normalized;
    this.currentIndex[poolKey] = 0;
    new Set([...previousKeys, ...seen]).forEach((key) => {
      this.rateLimited.delete(key);
      this.reservations.delete(key);
    });
    this._save();
    return [...normalized];
  }

  /**
   * Add a single key. Returns false if duplicate.
   */
  addKey(provider, key, label = '') {
    const poolKey = normalizeProviderKey(provider);
    if (!this.pools[poolKey]) this.pools[poolKey] = [];
    const trimmed = key.trim();
    if (!trimmed) return false;
    if (this.pools[poolKey].some(k => k.key === trimmed)) {
      return false; // duplicate
    }
    this.pools[poolKey].push({
      key: trimmed,
      label: label || `Key ${this.pools[poolKey].length + 1}`,
    });
    this._save();
    return true;
  }

  removeKey(provider, index) {
    const poolKey = normalizeProviderKey(provider);
    if (this.pools[poolKey]) {
      this.pools[poolKey].splice(index, 1);
      this._save();
    }
  }

  /**
   * Get displayed keys (masked).
   */
  getDisplayKeys(provider) {
    return (this.pools[normalizeProviderKey(provider)] || []).map((k, i) => ({
      ...k,
      index: i,
      masked: k.key.slice(0, 8) + '•••' + k.key.slice(-4),
      isRateLimited: this.isRateLimited(k.key),
    }));
  }

  /**
   * Export keys as plain text (one per line), full key values.
   */
  exportKeys(provider) {
    return (this.pools[normalizeProviderKey(provider)] || []).map(k => k.key).join('\n');
  }

  // --- Key Selection ---
  /**
   * Get next available key for a provider.
   * @param {string} provider - 'gemini_direct' | 'gemini_proxy'
   */
  getNextKey(provider) {
    const poolKey = normalizeProviderKey(provider);
    const pool = this.pools[poolKey] || [];
    if (pool.length === 0) return null;

    // Single key mode
    if (pool.length === 1) {
      const k = pool[0];
      if (this.isRateLimited(k.key)) return null;
      return k.key;
    }

    // Multi-key round-robin
    const startIdx = this.currentIndex[poolKey] || 0;
    for (let i = 0; i < pool.length; i++) {
      const idx = (startIdx + i) % pool.length;
      const k = pool[idx];
      if (!this.isRateLimited(k.key)) {
        this.currentIndex[poolKey] = (idx + 1) % pool.length;
        return k.key;
      }
    }

    return null; // All rate limited
  }

  _getPrunedReservations(key, now = Date.now()) {
    const slots = this.reservations.get(key) || [];
    const fresh = slots.filter((timestamp) => now - timestamp < RESERVATION_WINDOW_MS);
    if (fresh.length > 0) {
      this.reservations.set(key, fresh);
    } else {
      this.reservations.delete(key);
    }
    return fresh;
  }

  _reserveKey(key, now = Date.now()) {
    const slots = this._getPrunedReservations(key, now);
    slots.push(now);
    this.reservations.set(key, slots);
  }

  _getNextReservableKey(poolKey, rpmPerKey, now = Date.now()) {
    const pool = this.pools[poolKey] || [];
    if (pool.length === 0) return null;

    const startIdx = this.currentIndex[poolKey] || 0;
    for (let i = 0; i < pool.length; i++) {
      const idx = (startIdx + i) % pool.length;
      const { key } = pool[idx];
      if (this.isRateLimited(key)) continue;
      if (this._getPrunedReservations(key, now).length >= rpmPerKey) continue;

      this.currentIndex[poolKey] = (idx + 1) % pool.length;
      this._reserveKey(key, now);
      return key;
    }

    return null;
  }

  _getNextReservationDelay(poolKey, rpmPerKey, now = Date.now()) {
    const pool = this.pools[poolKey] || [];
    let delay = Infinity;

    for (const { key } of pool) {
      const rateLimitedUntil = this.rateLimited.get(key);
      if (rateLimitedUntil && rateLimitedUntil > now) {
        delay = Math.min(delay, rateLimitedUntil - now);
        continue;
      }

      const slots = this._getPrunedReservations(key, now);
      if (slots.length < rpmPerKey) return 0;
      delay = Math.min(delay, slots[0] + RESERVATION_WINDOW_MS - now);
    }

    return Number.isFinite(delay) ? Math.max(delay, 0) : 0;
  }

  async reserveNextKey(provider, options = {}) {
    const poolKey = normalizeProviderKey(provider);
    const pool = this.pools[poolKey] || [];
    if (pool.length === 0) return null;

    const rpmPerKey = normalizeAiRpmPerKey(options.rpmPerKey);
    while (true) {
      const now = Date.now();
      const key = this._getNextReservableKey(poolKey, rpmPerKey, now);
      if (key) return key;

      const waitMs = this._getNextReservationDelay(poolKey, rpmPerKey, now);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // --- Rate Limiting ---
  markRateLimited(key, retryAfterMs = RATE_LIMIT_COOLDOWN) {
    this.rateLimited.set(key, Date.now() + retryAfterMs);
  }

  isRateLimited(key) {
    const until = this.rateLimited.get(key);
    if (!until) return false;
    if (Date.now() >= until) {
      this.rateLimited.delete(key);
      return false;
    }
    return true;
  }

  // --- Status ---
  getStatus(provider) {
    const pool = this.pools[normalizeProviderKey(provider)] || [];
    const total = pool.length;
    const available = pool.filter(k => !this.isRateLimited(k.key)).length;
    return { total, available, rateLimited: total - available };
  }

  getTotalKeys() {
    return (
      (this.pools.gemini_direct?.length || 0)
      + (this.pools.gemini_proxy?.length || 0)
      + (this.pools.openai_proxy?.length || 0)
      + (this.pools.cloudflare_workers_ai?.length || 0)
    );
  }
}

const keyManager = new KeyManager();
export default keyManager;
