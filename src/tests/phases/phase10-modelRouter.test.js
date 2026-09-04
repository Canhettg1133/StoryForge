import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  return import('../../services/ai/router.js');
}

describe('phase10 model router proxy model selection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults the ag Gemini Proxy preset to the stable Flash model', async () => {
    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
    } = await loadRouter();

    expect(modelRouter.getProxyModel()).toBe(PROXY_MODEL_PRESETS[1].id);
    expect(localStorage.getItem('sf-proxy-model')).toBe(PROXY_MODEL_PRESETS[1].id);
  });

  it('routes normal proxy tasks to the selected proxy model instead of task quality map', async () => {
    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
      PROVIDERS,
      TASK_TYPES,
      QUALITY_MODES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setQualityMode(QUALITY_MODES.BALANCED);
    modelRouter.setProxyModel(PROXY_MODEL_PRESETS[4].id);

    expect(modelRouter.route(TASK_TYPES.ARC_OUTLINE).model).toBe(PROXY_MODEL_PRESETS[4].id);
    expect(modelRouter.route(TASK_TYPES.ARC_CHAPTER_DRAFT).model).toBe(PROXY_MODEL_PRESETS[4].id);
    expect(modelRouter.route(TASK_TYPES.CONTINUE).model).toBe(PROXY_MODEL_PRESETS[4].id);
    expect(modelRouter.route(TASK_TYPES.FREE_PROMPT).model).toBe(PROXY_MODEL_PRESETS[4].id);
  });

  it('keeps canon and background tasks on the selected proxy model by default', async () => {
    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
      PROVIDERS,
      TASK_TYPES,
      QUALITY_MODES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setProxyModel(PROXY_MODEL_PRESETS[4].id);

    const summaryRoute = modelRouter.route(TASK_TYPES.CHAPTER_SUMMARY, {
      qualityOverride: QUALITY_MODES.BEST,
    });
    const canonRoute = modelRouter.route(TASK_TYPES.CANON_EXTRACT_OPS, {
      qualityOverride: QUALITY_MODES.BALANCED,
    });

    expect(summaryRoute.model).toBe(PROXY_MODEL_PRESETS[4].id);
    expect(canonRoute.model).toBe(PROXY_MODEL_PRESETS[4].id);
  });

  it('routes custom OpenAI-compatible proxies to the custom model instead of ag presets', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();
    const {
      CUSTOM_PROXY_PROFILE_ID,
      setOpenAIProxyActiveProfile,
      updateCustomOpenAIProxyProfile,
    } = await import('../../services/ai/openAIProxyConfig.js');

    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com',
      defaultModel: 'custom-gemini-model',
      models: ['custom-gemini-model'],
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const route = modelRouter.route(TASK_TYPES.CANON_EXTRACT_OPS, {
      qualityOverride: 'best',
      useProxyQualityRouting: true,
    });

    expect(route.provider).toBe(PROVIDERS.OPENAI_PROXY);
    expect(route.model).toBe('custom-gemini-model');
    expect(route.proxyProfileId).toBe(CUSTOM_PROXY_PROFILE_ID);
  });

  it('does not silently fall back to an ag model when a custom proxy has no model configured', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();
    const {
      CUSTOM_PROXY_PROFILE_ID,
      setOpenAIProxyActiveProfile,
      updateCustomOpenAIProxyProfile,
    } = await import('../../services/ai/openAIProxyConfig.js');

    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com',
      defaultModel: '',
      models: [],
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const route = modelRouter.route(TASK_TYPES.FREE_PROMPT);

    expect(route.provider).toBe(PROVIDERS.OPENAI_PROXY);
    expect(route.model).toBe('');
    expect(route.proxyProfileId).toBe(CUSTOM_PROXY_PROFILE_ID);
  });

  it('lets explicit modelOverride win over proxyModelOverride and stored proxy model', async () => {
    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setProxyModel(PROXY_MODEL_PRESETS[4].id);

    const route = modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_PROXY,
      modelOverride: PROXY_MODEL_PRESETS[0].id,
      proxyModelOverride: PROXY_MODEL_PRESETS[3].id,
    });

    expect(route.model).toBe(PROXY_MODEL_PRESETS[0].id);
    expect(route.tier).toBe('custom');
  });

  it('preserves fetched ag proxy model ids instead of forcing them back to built-in presets', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    const fetchedAgModel = 'gcli-gemini-3.1-pro-preview-live';

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setProxyModel(fetchedAgModel);

    const route = modelRouter.route(TASK_TYPES.FREE_PROMPT);

    expect(modelRouter.getProxyModel()).toBe(fetchedAgModel);
    expect(localStorage.getItem('sf-proxy-model')).toBe(fetchedAgModel);
    expect(route.provider).toBe(PROVIDERS.OPENAI_PROXY);
    expect(route.model).toBe(fetchedAgModel);
    expect(route.proxyProfileId).toBe('ag-gemini-proxy');
  });

  it.each([
    ['fast', 'gemini-3.1-flash-lite-preview'],
    ['balanced', 'gemini-2.5-flash'],
    ['best', 'gemini-3-flash-preview'],
  ])('migrates legacy Gemini Direct quality %s to the same effective model', async (quality, expectedModel) => {
    localStorage.setItem('sf-quality-mode', quality);

    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    expect(modelRouter.getDirectModel()).toBe(expectedModel);
    expect(localStorage.getItem('sf-direct-model')).toBe(expectedModel);
    expect(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      qualityOverride: quality === 'fast' ? 'best' : 'fast',
    }).model).toBe(expectedModel);
  });

  it('persists an exact fetched or manual Gemini Direct model and ignores quality overrides', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
      QUALITY_MODES,
    } = await loadRouter();

    modelRouter.setDirectModelCatalog([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    modelRouter.setDirectModel('models/gemma-3-27b-it');

    expect(modelRouter.getDirectModel()).toBe('gemma-3-27b-it');
    expect(localStorage.getItem('sf-direct-model')).toBe('gemma-3-27b-it');
    expect(modelRouter.getDirectModelCatalog()).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    expect(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      qualityOverride: QUALITY_MODES.BEST,
    })).toEqual({
      provider: PROVIDERS.GEMINI_DIRECT,
      model: 'gemma-3-27b-it',
      tier: 'free',
    });
  });

  it('does not silently retry Gemini Direct with another Gemini model', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    modelRouter.setDirectModel('gemini-2.5-pro');
    expect(modelRouter.getFallbacks(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
    }))).toEqual([]);

    modelRouter.setOllamaModel('qwen3:4b');
    expect(modelRouter.getFallbacks(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
    }))).toEqual([
      { provider: PROVIDERS.OLLAMA, model: 'qwen3:4b', tier: 'local' },
    ]);
  });

  it('migrates missing proxy model from legacy quality mode', async () => {
    localStorage.setItem('sf-quality-mode', 'best');

    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
    } = await loadRouter();

    expect(modelRouter.getProxyModel()).toBe(PROXY_MODEL_PRESETS[2].id);
    expect(localStorage.getItem('sf-proxy-model')).toBe(PROXY_MODEL_PRESETS[2].id);
  });

  it('keeps Lab-style proxy quality routing when requested', async () => {
    const {
      default: modelRouter,
      PROXY_MODEL_PRESETS,
      PROVIDERS,
      TASK_TYPES,
      QUALITY_MODES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setProxyModel(PROXY_MODEL_PRESETS[4].id);

    const route = modelRouter.route(TASK_TYPES.FREE_PROMPT, {
      qualityOverride: QUALITY_MODES.BALANCED,
      useProxyQualityRouting: true,
    });

    expect(route.model).toBe(PROXY_MODEL_PRESETS[2].id);
  });

  it('routes AI Studio Relay to the stored relay model without requiring keys', async () => {
    const {
      default: modelRouter,
      AI_STUDIO_RELAY_MODELS,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.AI_STUDIO_RELAY);

    const route = modelRouter.route(TASK_TYPES.CONTINUE);

    expect(route).toEqual({
      provider: PROVIDERS.AI_STUDIO_RELAY,
      model: AI_STUDIO_RELAY_MODELS[0].id,
      tier: 'relay',
    });
  });

  it('lets an explicit AI Studio Relay provider override win over the global provider', async () => {
    const {
      default: modelRouter,
      AI_STUDIO_RELAY_MODELS,
      PROVIDERS,
      TASK_TYPES,
    } = await loadRouter();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);

    const route = modelRouter.route(TASK_TYPES.FREE_PROMPT, {
      providerOverride: PROVIDERS.AI_STUDIO_RELAY,
    });

    expect(route.provider).toBe(PROVIDERS.AI_STUDIO_RELAY);
    expect(route.model).toBe(AI_STUDIO_RELAY_MODELS[0].id);
    expect(route.tier).toBe('relay');
  });
});
