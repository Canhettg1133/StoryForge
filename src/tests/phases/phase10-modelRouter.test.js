import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  return import('../../services/ai/router.js');
}

describe('phase10 model router proxy model selection', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('keeps canon and background tasks on legacy proxy quality routing', async () => {
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

    expect(summaryRoute.model).toBe(PROXY_MODEL_PRESETS[1].id);
    expect(canonRoute.model).toBe(PROXY_MODEL_PRESETS[1].id);
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

  it('preserves Gemini Direct quality mapping', async () => {
    const {
      default: modelRouter,
      PROVIDERS,
      TASK_TYPES,
      QUALITY_MODES,
    } = await loadRouter();

    expect(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      qualityOverride: QUALITY_MODES.FAST,
    }).model).toBe('gemini-3.1-flash-lite-preview');

    expect(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      qualityOverride: QUALITY_MODES.BALANCED,
    }).model).toBe('gemini-2.5-flash');

    expect(modelRouter.route(TASK_TYPES.CONTINUE, {
      providerOverride: PROVIDERS.GEMINI_DIRECT,
      qualityOverride: QUALITY_MODES.BEST,
    }).model).toBe('gemini-3-flash-preview');
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
