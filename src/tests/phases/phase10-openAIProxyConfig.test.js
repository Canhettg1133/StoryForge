import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('../../services/ai/openAIProxyConfig.js');
}

describe('openAIProxyConfig legacy settings migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates a legacy custom proxyUrl into the custom profile', async () => {
    localStorage.setItem('sf-ai-settings', JSON.stringify({
      proxyUrl: 'https://proxy.example.com/v1',
    }));

    const {
      CUSTOM_PROXY_PROFILE_ID,
      getOpenAIProxySettings,
    } = await loadConfig();

    const settings = getOpenAIProxySettings();

    expect(settings.activeProfileId).toBe(CUSTOM_PROXY_PROFILE_ID);
    expect(settings.customProfile.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('keeps legacy ag proxyUrl on the default ag preset', async () => {
    localStorage.setItem('sf-ai-settings', JSON.stringify({
      proxyUrl: 'https://ag.beijixingxing.com/v1/chat/completions',
    }));

    const {
      AG_PROXY_PROFILE_ID,
      getOpenAIProxySettings,
      getActiveOpenAIProxyProfile,
    } = await loadConfig();

    expect(getOpenAIProxySettings().activeProfileId).toBe(AG_PROXY_PROFILE_ID);
    expect(getActiveOpenAIProxyProfile().baseUrl).toBe('/api/proxy');
  });
});
