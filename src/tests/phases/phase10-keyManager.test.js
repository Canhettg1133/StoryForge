import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadKeyManager() {
  vi.resetModules();
  return (await import('../../services/ai/keyManager.js')).default;
}

describe('keyManager provider pools', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
