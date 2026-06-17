import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadClientStack() {
  vi.resetModules();
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    getSession: async () => ({ access_token: 'story-token' }),
    subscribe: () => () => {},
  }));
  const [clientModule, routerModule, keyManagerModule, accessClientModule] = await Promise.all([
    import('../../services/ai/client.js'),
    import('../../services/ai/router.js'),
    import('../../services/ai/keyManager.js'),
    import('../../services/access/accessClient.js'),
  ]);

  clientModule.default.setRouter(routerModule.default);

  return {
    aiService: clientModule.default,
    modelRouter: routerModule.default,
    keyManager: keyManagerModule.default,
    routerModule,
    accessClientModule,
  };
}

function cacheFeatureDecision(accessClientModule, featureKey, decision = {}) {
  accessClientModule.setCachedAccessSnapshot({
    authenticated: true,
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'StoryForge User',
      systemRole: 'user',
      status: 'active',
    },
    plan: null,
    features: {
      [featureKey]: {
        allowed: true,
        status: 200,
        reason: accessClientModule.ACCESS_REASONS.ALLOWED,
        feature: featureKey,
        limits: {},
        ...decision,
      },
    },
    admin: {
      allowed: false,
      status: 403,
      reason: accessClientModule.ACCESS_REASONS.ADMIN_REQUIRED,
      feature: 'admin',
      limits: {},
    },
    accessVersion: 1,
  }, 'story-token');
}

describe('phase10 AI abort diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('settles with REQUEST_ABORTED when a concurrent Gemini Direct request is aborted', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      accessClientModule,
    } = await loadClientStack();
    const { PROVIDERS, TASK_TYPES } = routerModule;
    const onComplete = vi.fn();
    const onError = vi.fn();
    const fetchMock = vi.fn((_url, request = {}) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_DIRECT, 'gemini-direct-key');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    cacheFeatureDecision(
      accessClientModule,
      accessClientModule.ACCESS_FEATURES.GEMINI_DIRECT,
    );

    const request = aiService.send({
      taskType: TASK_TYPES.CHAPTER_SUMMARY,
      messages: [{ role: 'user', content: 'Tóm tắt chương.' }],
      stream: false,
      allowConcurrent: true,
      onComplete,
      onError,
    });
    request.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'REQUEST_ABORTED',
    }));
  });

  it('settles even when the aborted provider request never resolves or rejects', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      accessClientModule,
    } = await loadClientStack();
    const { PROVIDERS, TASK_TYPES } = routerModule;
    const onComplete = vi.fn();
    const onError = vi.fn();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_DIRECT, 'gemini-direct-key');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    cacheFeatureDecision(
      accessClientModule,
      accessClientModule.ACCESS_FEATURES.GEMINI_DIRECT,
    );

    const request = aiService.send({
      taskType: TASK_TYPES.CHAPTER_SUMMARY,
      messages: [{ role: 'user', content: 'Tom tat chuong.' }],
      stream: false,
      allowConcurrent: true,
      onComplete,
      onError,
    });
    request.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'REQUEST_ABORTED',
    }));
  });
});
