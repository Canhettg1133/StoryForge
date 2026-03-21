/**
 * StoryForge — Key Manager
 * 
 * Quản lý API keys RIÊNG BIỆT cho từng provider:
 *   - gemini_direct: keys từ Google AI Studio (free tier)
 *   - gemini_proxy: keys từ 星星公益站 proxy
 * 
 * Mỗi pool có rotation riêng, rate limit riêng.
 * Hoạt động tối ưu: 1 key (no overhead) hoặc N keys (round-robin).
 */

const STORAGE_KEY = 'sf-api-keys-v2';
const RATE_LIMIT_COOLDOWN = 60000;

class KeyManager {
  constructor() {
    // Separate key pools per provider
    this.pools = {
      gemini_direct: [],  // [{ key, label }]
      gemini_proxy: [],   // [{ key, label }]
    };
    this.currentIndex = {
      gemini_direct: 0,
      gemini_proxy: 0,
    };
    this.rateLimited = new Map(); // key → timestamp
    this._load();
  }

  // --- Storage ---
  _load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.pools = {
          gemini_direct: parsed.gemini_direct || [],
          gemini_proxy: parsed.gemini_proxy || [],
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
    return this.pools[provider] || [];
  }

  getKeyCount(provider) {
    return (this.pools[provider] || []).length;
  }

  /**
   * Add keys for a provider (bulk import) — APPENDS, does not replace.
   * Skips duplicates.
   * @param {string} provider - 'gemini_direct' | 'gemini_proxy'
   * @param {string[]} keys - array of key strings
   * @returns {{ added: number, skipped: number }}
   */
  setKeys(provider, keys) {
    if (!this.pools[provider]) this.pools[provider] = [];
    const existing = new Set(this.pools[provider].map(k => k.key));
    let added = 0;
    let skipped = 0;
    for (const raw of keys) {
      const key = raw.trim();
      if (!key || key.length < 10) continue;
      if (existing.has(key)) {
        skipped++;
        continue;
      }
      existing.add(key);
      this.pools[provider].push({
        key,
        label: `Key ${this.pools[provider].length + 1}`,
      });
      added++;
    }
    this._save();
    return { added, skipped };
  }

  /**
   * Add a single key. Returns false if duplicate.
   */
  addKey(provider, key, label = '') {
    if (!this.pools[provider]) this.pools[provider] = [];
    const trimmed = key.trim();
    if (this.pools[provider].some(k => k.key === trimmed)) {
      return false; // duplicate
    }
    this.pools[provider].push({
      key: trimmed,
      label: label || `Key ${this.pools[provider].length + 1}`,
    });
    this._save();
    return true;
  }

  removeKey(provider, index) {
    if (this.pools[provider]) {
      this.pools[provider].splice(index, 1);
      this._save();
    }
  }

  /**
   * Get displayed keys (masked).
   */
  getDisplayKeys(provider) {
    return (this.pools[provider] || []).map((k, i) => ({
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
    return (this.pools[provider] || []).map(k => k.key).join('\n');
  }

  // --- Key Selection ---
  /**
   * Get next available key for a provider.
   * @param {string} provider - 'gemini_direct' | 'gemini_proxy'
   */
  getNextKey(provider) {
    const pool = this.pools[provider] || [];
    if (pool.length === 0) return null;

    // Single key mode
    if (pool.length === 1) {
      const k = pool[0];
      if (this.isRateLimited(k.key)) return null;
      return k.key;
    }

    // Multi-key round-robin
    const startIdx = this.currentIndex[provider] || 0;
    for (let i = 0; i < pool.length; i++) {
      const idx = (startIdx + i) % pool.length;
      const k = pool[idx];
      if (!this.isRateLimited(k.key)) {
        this.currentIndex[provider] = (idx + 1) % pool.length;
        return k.key;
      }
    }

    return null; // All rate limited
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
    const pool = this.pools[provider] || [];
    const total = pool.length;
    const available = pool.filter(k => !this.isRateLimited(k.key)).length;
    return { total, available, rateLimited: total - available };
  }

  getTotalKeys() {
    return (this.pools.gemini_direct?.length || 0) + (this.pools.gemini_proxy?.length || 0);
  }
}

const keyManager = new KeyManager();
export default keyManager;
