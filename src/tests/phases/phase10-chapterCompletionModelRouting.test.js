import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRoutingStack() {
  vi.resetModules();
  const [completionModule, routerModule, proxyModule, modelOptionsModule] = await Promise.all([
    import('../../services/ai/chapterCompletionModelRouting.js'),
    import('../../services/ai/router.js'),
    import('../../services/ai/openAIProxyConfig.js'),
    import('../../services/ai/modelOptions.js'),
  ]);
  return {
    ...completionModule,
    ...proxyModule,
    ...modelOptionsModule,
    modelRouter: routerModule.default,
    routerModule,
  };
}

describe('phase10 chapter completion model routing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores independent completion models for AG and Custom proxy profiles', async () => {
    const {
      AG_PROXY_PROFILE_ID,
      CUSTOM_PROXY_PROFILE_ID,
      getChapterCompletionModelState,
      modelRouter,
      routerModule: { PROVIDERS, PROXY_MODEL_PRESETS },
      saveChapterCompletionModelPreference,
      setOpenAIProxyActiveProfile,
      updateCustomOpenAIProxyProfile,
    } = await loadRoutingStack();

    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    saveChapterCompletionModelPreference({
      provider: PROVIDERS.OPENAI_PROXY,
      proxyProfileId: AG_PROXY_PROFILE_ID,
      model: PROXY_MODEL_PRESETS[1].id,
    });

    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com',
      defaultModel: 'custom-default',
      models: ['custom-default', 'custom-fast'],
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    expect(getChapterCompletionModelState()).toMatchObject({
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      selectedModel: '',
      shouldPrompt: true,
    });

    saveChapterCompletionModelPreference({
      provider: PROVIDERS.OPENAI_PROXY,
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'custom-fast',
    });
    expect(getChapterCompletionModelState()).toMatchObject({
      selectedModel: 'custom-fast',
      shouldPrompt: false,
    });

    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    expect(getChapterCompletionModelState()).toMatchObject({
      selectedModel: PROXY_MODEL_PRESETS[1].id,
      shouldPrompt: false,
    });
  });

  it('falls back safely when the stored preference JSON is corrupt', async () => {
    const {
      CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY,
      getChapterCompletionModelState,
      modelRouter,
      routerModule: { PROVIDERS, QUALITY_MODES },
    } = await loadRoutingStack();

    localStorage.setItem(CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY, '{broken');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    modelRouter.setQualityMode(QUALITY_MODES.BEST);

    expect(getChapterCompletionModelState()).toMatchObject({
      provider: PROVIDERS.GEMINI_DIRECT,
      selectedModel: '',
      currentModel: 'gemini-2.5-flash',
      shouldPrompt: true,
      routeOptions: {
        providerOverride: PROVIDERS.GEMINI_DIRECT,
        modelOverride: 'gemini-2.5-flash',
      },
    });
  });

  it('invalidates a Custom proxy completion model that is absent from the active catalog', async () => {
    const {
      CUSTOM_PROXY_PROFILE_ID,
      getChapterCompletionModelState,
      modelRouter,
      routerModule: { PROVIDERS },
      saveChapterCompletionModelPreference,
      setOpenAIProxyActiveProfile,
      updateCustomOpenAIProxyProfile,
    } = await loadRoutingStack();

    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://old.example.com',
      defaultModel: 'old-model',
      models: ['old-model'],
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    saveChapterCompletionModelPreference({
      provider: PROVIDERS.OPENAI_PROXY,
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'old-model',
    });

    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://new.example.com',
      defaultModel: 'new-model',
      models: ['new-model'],
    });

    expect(getChapterCompletionModelState()).toMatchObject({
      selectedModel: '',
      currentModel: 'new-model',
      shouldPrompt: true,
      routeOptions: {
        providerOverride: PROVIDERS.OPENAI_PROXY,
        proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
        modelOverride: 'new-model',
      },
    });
  });

  it('returns one explicit route snapshot that does not change with later Settings edits', async () => {
    const {
      getChapterCompletionRouteOptions,
      modelRouter,
      routerModule: { PROVIDERS, QUALITY_MODES },
      saveChapterCompletionModelPreference,
    } = await loadRoutingStack();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    modelRouter.setQualityMode(QUALITY_MODES.BEST);
    saveChapterCompletionModelPreference({
      provider: PROVIDERS.GEMINI_DIRECT,
      model: 'gemini-2.5-flash',
    });

    const snapshot = getChapterCompletionRouteOptions();
    modelRouter.setQualityMode(QUALITY_MODES.FAST);

    expect(snapshot).toEqual({
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      modelOverride: 'gemini-2.5-flash',
    });
    expect(getChapterCompletionRouteOptions()).toEqual(snapshot);
  });

  it('reuses the persisted Ollama catalog for completion model choices', async () => {
    const {
      getAvailableModelOptions,
      modelRouter,
      routerModule: { PROVIDERS },
      setOllamaModelCatalog,
    } = await loadRoutingStack();

    modelRouter.setOllamaModel('qwen3:4b');
    setOllamaModelCatalog(['qwen3:4b', 'llama3.2:3b']);

    expect(getAvailableModelOptions(PROVIDERS.OLLAMA).map((option) => option.id))
      .toEqual(['qwen3:4b', 'llama3.2:3b']);
  });

  it('offers fetched and manual Gemini Direct models to completion model pickers', async () => {
    const {
      getAvailableModelOptions,
      modelRouter,
      routerModule: { PROVIDERS },
    } = await loadRoutingStack();

    modelRouter.setDirectModelCatalog([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    modelRouter.setDirectModel('gemini-custom-writing-preview');

    expect(getAvailableModelOptions(PROVIDERS.GEMINI_DIRECT)).toEqual([
      {
        id: 'gemini-custom-writing-preview',
        label: 'gemini-custom-writing-preview',
        meta: 'Nhập thủ công · chưa xác minh',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        meta: 'Đã lấy từ AI Studio',
      },
      {
        id: 'gemma-3-27b-it',
        label: 'Gemma 3 27B',
        meta: 'Đã lấy từ AI Studio',
      },
    ]);
  });

  it('builds exact completion overrides for AI Studio Relay and Ollama', async () => {
    const {
      getChapterCompletionModelState,
      modelRouter,
      routerModule: { PROVIDERS },
      saveChapterCompletionModelPreference,
      setOllamaModelCatalog,
    } = await loadRoutingStack();

    modelRouter.setPreferredProvider(PROVIDERS.AI_STUDIO_RELAY);
    saveChapterCompletionModelPreference({
      provider: PROVIDERS.AI_STUDIO_RELAY,
      model: 'gemini-flash-latest',
    });
    expect(getChapterCompletionModelState()).toMatchObject({
      shouldPrompt: false,
      routeOptions: {
        providerOverride: PROVIDERS.AI_STUDIO_RELAY,
        modelOverride: 'gemini-flash-latest',
      },
    });

    modelRouter.setPreferredProvider(PROVIDERS.OLLAMA);
    modelRouter.setOllamaModel('qwen3:4b');
    setOllamaModelCatalog(['qwen3:4b', 'llama3.2:3b']);
    saveChapterCompletionModelPreference({
      provider: PROVIDERS.OLLAMA,
      model: 'llama3.2:3b',
    });
    expect(getChapterCompletionModelState()).toMatchObject({
      shouldPrompt: false,
      routeOptions: {
        providerOverride: PROVIDERS.OLLAMA,
        modelOverride: 'llama3.2:3b',
      },
    });
  });
});
