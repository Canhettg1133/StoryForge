import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('../../services/ai/openAIProxyConfig.js');
}

describe('openAIProxyConfig legacy settings migration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
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
    expect(getActiveOpenAIProxyProfile().baseUrl).toBe('https://ag.beijixingxing.com');
  });

  it('resolves separate key pools for ag and custom proxy profiles', async () => {
    const {
      AG_PROXY_PROFILE_ID,
      CUSTOM_PROXY_PROFILE_ID,
      getAgOpenAIProxyProfile,
      getDefaultCustomOpenAIProxyProfile,
      getOpenAIProxyKeyProvider,
    } = await loadConfig();

    expect(getOpenAIProxyKeyProvider(AG_PROXY_PROFILE_ID)).toBe('gemini_proxy');
    expect(getOpenAIProxyKeyProvider(CUSTOM_PROXY_PROFILE_ID)).toBe('openai_proxy');
    expect(getOpenAIProxyKeyProvider(getAgOpenAIProxyProfile())).toBe('gemini_proxy');
    expect(getOpenAIProxyKeyProvider(getDefaultCustomOpenAIProxyProfile())).toBe('openai_proxy');
  });

  it('keeps the stable ag Flash model as the default model', async () => {
    localStorage.setItem('sf-proxy-model', 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]');

    const {
      DEFAULT_AG_PROXY_MODEL,
      getAgProxyModel,
    } = await loadConfig();

    expect(getAgProxyModel()).toBe(DEFAULT_AG_PROXY_MODEL);
    expect(localStorage.getItem('sf-proxy-model')).toBe(DEFAULT_AG_PROXY_MODEL);
  });

  it('migrates the accidental ag 3.1 Pro default back to stable Flash only once', async () => {
    const accidentalProDefault = 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]';
    localStorage.setItem('sf-proxy-model', accidentalProDefault);

    const {
      DEFAULT_AG_PROXY_MODEL,
      getAgProxyModel,
      setAgProxyModel,
    } = await loadConfig();

    expect(getAgProxyModel()).toBe(DEFAULT_AG_PROXY_MODEL);
    expect(localStorage.getItem('sf-proxy-model')).toBe(DEFAULT_AG_PROXY_MODEL);

    setAgProxyModel(accidentalProDefault);

    expect(getAgProxyModel()).toBe(accidentalProDefault);
    expect(localStorage.getItem('sf-proxy-model')).toBe(accidentalProDefault);
  });

  it('stores fetched ag proxy models on the ag profile', async () => {
    const {
      getAgOpenAIProxyProfile,
      setAgProxyModels,
    } = await loadConfig();

    setAgProxyModels([
      ' gcli-gemini-3.1-pro-preview-live ',
      'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
      'gcli-gemini-3.1-pro-preview-live',
      '',
    ]);

    expect(getAgOpenAIProxyProfile().models).toEqual([
      'gcli-gemini-3.1-pro-preview-live',
      'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    ]);
  });

  it('falls back to direct model fetch when the same-origin relay route is missing', async () => {
    const {
      DEFAULT_PROXY_MODELS_PATH,
      fetchOpenAIProxyModels,
      getDefaultCustomOpenAIProxyProfile,
    } = await loadConfig();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'custom-model' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchOpenAIProxyModels({
      profile: {
        ...getDefaultCustomOpenAIProxyProfile(),
        baseUrl: 'https://proxy.example.com/v1',
        modelsPath: DEFAULT_PROXY_MODELS_PATH,
        transport: 'relay',
      },
      apiKey: 'sk-custom-key',
    });

    expect(models).toEqual(['custom-model']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    expect(fetchMock.mock.calls[1][0]).toBe('https://proxy.example.com/v1/models');
  });

  it('blocks public HTTP model fetches before the browser can hit mixed content', async () => {
    const {
      DEFAULT_PROXY_MODELS_PATH,
      fetchOpenAIProxyModels,
      getDefaultCustomOpenAIProxyProfile,
    } = await loadConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchOpenAIProxyModels({
      profile: {
        ...getDefaultCustomOpenAIProxyProfile(),
        baseUrl: 'http://proxy.example.com/v1',
        modelsPath: DEFAULT_PROXY_MODELS_PATH,
        transport: 'auto',
      },
      apiKey: 'sk-custom-key',
      pageProtocol: 'https:',
    })).rejects.toThrow(/OPENAI_PROXY_MIXED_CONTENT_BLOCKED/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
