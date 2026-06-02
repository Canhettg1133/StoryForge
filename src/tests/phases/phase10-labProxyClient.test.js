import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadLabClientStack() {
  vi.resetModules();
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    getSession: async () => ({ access_token: 'story-token' }),
    subscribe: () => () => {},
  }));
  const [labClientModule, routerModule, keyManagerModule, proxyConfigModule] = await Promise.all([
    import('../../pages/Lab/services/labClient.js'),
    import('../../services/ai/router.js'),
    import('../../services/ai/keyManager.js'),
    import('../../services/ai/openAIProxyConfig.js'),
  ]);

  labClientModule.default.setRouter(routerModule.default);

  return {
    labAIService: labClientModule.default,
    modelRouter: routerModule.default,
    keyManager: keyManagerModule.default,
    routerModule,
    proxyConfigModule,
  };
}

function sendLabOnce(labAIService, routerModule) {
  return new Promise((resolve, reject) => {
    labAIService.send({
      taskType: routerModule.TASK_TYPES.FREE_PROMPT,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      onComplete: resolve,
      onError: reject,
    });
  });
}

describe('Lab proxy client relay auth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sends StoryForge auth and provider key separately through the Vercel relay', async () => {
    const {
      labAIService,
      keyManager,
      modelRouter,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
      },
    } = await loadLabClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendLabOnce(labAIService, routerModule);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/openai-proxy');
    expect(request.headers.Authorization).toBe('Bearer story-token');
    expect(request.headers['X-StoryForge-Upstream-Key']).toBe('sk-test-ag-key');
  });
});
