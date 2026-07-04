import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

  it('classifies current proxy model families for search and filtering', async () => {
    const {
      CUSTOM_PROXY_PROFILE_ID,
      classifyProxyModel,
    } = await loadConfig();
    const context = { profileId: CUSTOM_PROXY_PROFILE_ID };

    expect(classifyProxyModel('deepseek-ai/deepseek-v4-flash', context).family).toBe('DeepSeek');
    expect(classifyProxyModel('moonshotai/kimi-k2-instruct', context).family).toBe('Kimi');
    expect(classifyProxyModel('kimi-k2-thinking', context).family).toBe('Kimi');
    expect(classifyProxyModel('MiniMax-M3', context).family).toBe('MiniMax');
    expect(classifyProxyModel('abab6.5s-chat', context).family).toBe('MiniMax');
    expect(classifyProxyModel('x-ai/grok-4.3', context).family).toBe('Grok');
    expect(classifyProxyModel('01-ai/yi-large', context).family).toBe('Yi');
    expect(classifyProxyModel('bytedance/seed-oss-36b-instruct', context).family).toBe('Doubao/Seed');
  });

  it('keeps the Settings model picker filters aligned with current proxy families', () => {
    const settingsSource = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/Settings/Settings.jsx'),
      'utf8',
    );

    ['DeepSeek', 'Kimi', 'MiniMax', 'Qwen', 'Grok'].forEach((family) => {
      expect(settingsSource).toContain(`'${family}'`);
    });
  });

  it('keeps fetched ag proxy models provider-agnostic because ag can expose Claude', () => {
    const settingsSource = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/Settings/Settings.jsx'),
      'utf8',
    );
    const agFetchStart = settingsSource.indexOf('const handleFetchAgProxyModels');
    const customFetchStart = settingsSource.indexOf('const handleFetchCustomProxyModels');
    const agFetchBody = settingsSource.slice(agFetchStart, customFetchStart);

    expect(agFetchBody).toContain('normalizeAgProxyModelList(allModels)');
    expect(agFetchBody).not.toContain('normalizeGeminiProxyModelList(allModels)');
    expect(agFetchBody).not.toContain('filterGeminiModelIds');
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

  it('upgrades public HTTP model fetches to HTTPS before the browser can hit mixed content', async () => {
    const {
      DEFAULT_PROXY_MODELS_PATH,
      fetchOpenAIProxyModels,
      getDefaultCustomOpenAIProxyProfile,
    } = await loadConfig();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'upgraded-model' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchOpenAIProxyModels({
      profile: {
        ...getDefaultCustomOpenAIProxyProfile(),
        baseUrl: 'http://proxy.example.com/v1',
        modelsPath: DEFAULT_PROXY_MODELS_PATH,
        transport: 'auto',
      },
      apiKey: 'sk-custom-key',
      pageProtocol: 'https:',
    });

    expect(models).toEqual(['upgraded-model']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).baseUrl).toBe('https://proxy.example.com/v1');
  });
});
