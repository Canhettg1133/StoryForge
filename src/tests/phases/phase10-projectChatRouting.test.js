import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadProjectChatHelpers() {
  vi.resetModules();
  return Promise.all([
    import('../../pages/ProjectChat/ProjectChat.jsx'),
    import('../../services/ai/router.js'),
  ]).then(([projectChatModule, routerModule]) => ({
    ...projectChatModule,
    routerModule,
    modelRouter: routerModule.default,
  }));
}

describe('phase10 ProjectChat routing inheritance', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps new thread payload on router defaults instead of hardcoding a provider override', async () => {
    const { buildThreadPayload } = await loadProjectChatHelpers();

    const payload = buildThreadPayload({
      scopedProjectId: 7,
      mode: 'free',
      projectScopeEnabled: false,
      project: null,
      now: 123,
    });

    expect(payload.provider_override).toBe('');
    expect(payload.model_override).toBe('');
  });

  it('keeps legacy threads without provider_override inheriting the global Ollama route', async () => {
    const {
      getThreadRouting,
      normalizeThread,
      modelRouter,
      routerModule: { PROVIDERS },
    } = await loadProjectChatHelpers();

    modelRouter.setPreferredProvider(PROVIDERS.OLLAMA);
    modelRouter.setOllamaModel('phi3:mini');

    const thread = normalizeThread({
      id: 101,
      provider_override: '',
      model_override: '',
    }, false, null);
    const routing = getThreadRouting(thread);

    expect(thread.provider_override).toBe('');
    expect(routing.routeOptions).toEqual({});
    expect(routing.route.provider).toBe(PROVIDERS.OLLAMA);
    expect(routing.route.model).toBe('phi3:mini');
  });

  it('keeps legacy threads without provider_override inheriting the global Gemini Direct route', async () => {
    const {
      getThreadRouting,
      normalizeThread,
      modelRouter,
      routerModule: { PROVIDERS, QUALITY_MODES },
    } = await loadProjectChatHelpers();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    modelRouter.setQualityMode(QUALITY_MODES.BEST);

    const thread = normalizeThread({
      id: 102,
      provider_override: '',
      model_override: '',
    }, false, null);
    const routing = getThreadRouting(thread);

    expect(thread.provider_override).toBe('');
    expect(routing.routeOptions).toEqual({});
    expect(routing.route.provider).toBe(PROVIDERS.GEMINI_DIRECT);
    expect(routing.route.model).toBe('gemini-3-flash-preview');
  });

  it('keeps legacy threads without provider_override inheriting the selected proxy model from Settings', async () => {
    const {
      getThreadRouting,
      normalizeThread,
      modelRouter,
      routerModule: { PROVIDERS, PROXY_MODEL_PRESETS },
    } = await loadProjectChatHelpers();

    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_PROXY);
    modelRouter.setProxyModel(PROXY_MODEL_PRESETS[4].id);

    const thread = normalizeThread({
      id: 103,
      provider_override: '',
      model_override: '',
    }, false, null);
    const routing = getThreadRouting(thread);

    expect(thread.provider_override).toBe('');
    expect(routing.routeOptions).toEqual({});
    expect(routing.route.provider).toBe(PROVIDERS.GEMINI_PROXY);
    expect(routing.route.model).toBe(PROXY_MODEL_PRESETS[4].id);
  });

  it('treats model_override = empty string as no override and uses the real router default', async () => {
    const {
      getThreadRouting,
      modelRouter,
      routerModule: { PROVIDERS, QUALITY_MODES },
    } = await loadProjectChatHelpers();

    modelRouter.setQualityMode(QUALITY_MODES.BEST);

    const routing = getThreadRouting({
      id: 104,
      provider_override: PROVIDERS.GEMINI_DIRECT,
      model_override: '',
    });

    expect(routing.routeOptions).toEqual({ providerOverride: PROVIDERS.GEMINI_DIRECT });
    expect(routing.route.provider).toBe(PROVIDERS.GEMINI_DIRECT);
    expect(routing.route.model).toBe('gemini-3-flash-preview');
  });

  it('preserves blank overrides in the persisted config patch for inherited threads', async () => {
    const { buildThreadConfigPatch } = await loadProjectChatHelpers();

    const patch = buildThreadConfigPatch({
      id: 105,
      chat_mode: 'free',
      provider_override: '',
      model_override: '',
      system_prompt: '',
    }, {
      activeThreadMode: 'free',
      projectScopeEnabled: false,
      project: null,
    });

    expect(patch.provider_override).toBe('');
    expect(patch.model_override).toBe('');
  });
});
