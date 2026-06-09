import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadKeyManager() {
  vi.resetModules();
  return (await import('../../services/ai/keyManager.js')).default;
}

async function loadKeyManagerModule() {
  vi.resetModules();
  return import('../../services/ai/keyManager.js');
}

describe('keyManager provider pools', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('keeps ag Gemini Proxy keys separate from Custom OpenAI-compatible keys', async () => {
    const keyManager = await loadKeyManager();

    keyManager.addKey('gemini_proxy', 'sk-ag-proxy-key');
    keyManager.addKey('openai_proxy', 'sk-custom-proxy-key');

    expect(keyManager.getKeys('gemini_proxy').map((item) => item.key)).toEqual(['sk-ag-proxy-key']);
    expect(keyManager.getKeys('openai_proxy').map((item) => item.key)).toEqual(['sk-custom-proxy-key']);
    expect(keyManager.getNextKey('gemini_proxy')).toBe('sk-ag-proxy-key');
    expect(keyManager.getNextKey('openai_proxy')).toBe('sk-custom-proxy-key');
  });

  it('migrates stored openai_proxy keys into the custom proxy pool only', async () => {
    localStorage.setItem('sf-api-keys-v2', JSON.stringify({
      gemini_proxy: [{ key: 'sk-ag-proxy-key', label: 'ag' }],
      openai_proxy: [{ key: 'sk-custom-proxy-key', label: 'custom' }],
    }));

    const keyManager = await loadKeyManager();

    expect(keyManager.getNextKey('gemini_proxy')).toBe('sk-ag-proxy-key');
    expect(keyManager.getNextKey('openai_proxy')).toBe('sk-custom-proxy-key');
  });

  it('defaults AI request reservations to 5 RPM per API key', async () => {
    const { DEFAULT_AI_RPM_PER_KEY, normalizeAiRpmPerKey } = await loadKeyManagerModule();

    expect(DEFAULT_AI_RPM_PER_KEY).toBe(5);
    expect(normalizeAiRpmPerKey()).toBe(5);
    expect(normalizeAiRpmPerKey('0')).toBe(5);
    expect(normalizeAiRpmPerKey('12')).toBe(12);
  });

  it('waits when one key has used every RPM slot in the current minute', async () => {
    vi.useFakeTimers();
    const keyManager = await loadKeyManager();
    keyManager.addKey('gemini_direct', 'sk-direct-key-one');

    await expect(keyManager.reserveNextKey('gemini_direct', { rpmPerKey: 2 })).resolves.toBe('sk-direct-key-one');
    await expect(keyManager.reserveNextKey('gemini_direct', { rpmPerKey: 2 })).resolves.toBe('sk-direct-key-one');

    let settled = false;
    const thirdReservation = keyManager
      .reserveNextKey('gemini_direct', { rpmPerKey: 2 })
      .then((key) => {
        settled = true;
        return key;
      });

    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    await expect(thirdReservation).resolves.toBe('sk-direct-key-one');
  });

  it('uses another key immediately instead of waiting on a full key', async () => {
    vi.useFakeTimers();
    const keyManager = await loadKeyManager();
    keyManager.addKey('openai_proxy', 'sk-custom-key-one');
    keyManager.addKey('openai_proxy', 'sk-custom-key-two');

    await expect(keyManager.reserveNextKey('openai_proxy', { rpmPerKey: 1 })).resolves.toBe('sk-custom-key-one');
    await expect(keyManager.reserveNextKey('openai_proxy', { rpmPerKey: 1 })).resolves.toBe('sk-custom-key-two');

    let settled = false;
    const thirdReservation = keyManager
      .reserveNextKey('openai_proxy', { rpmPerKey: 1 })
      .then((key) => {
        settled = true;
        return key;
      });

    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    await expect(thirdReservation).resolves.toBe('sk-custom-key-one');
  });
});
