import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadClientStack() {
  vi.resetModules();
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    getSession: async () => ({ access_token: 'story-token' }),
    subscribe: () => () => {},
  }));
  const [clientModule, routerModule, keyManagerModule, proxyConfigModule] = await Promise.all([
    import('../../services/ai/client.js'),
    import('../../services/ai/router.js'),
    import('../../services/ai/keyManager.js'),
    import('../../services/ai/openAIProxyConfig.js'),
  ]);

  clientModule.default.setRouter(routerModule.default);

  return {
    aiService: clientModule.default,
    modelRouter: routerModule.default,
    keyManager: keyManagerModule.default,
    routerModule,
    proxyConfigModule,
  };
}

describe('OpenAI proxy usage context', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sends task metadata on the relay envelope without putting it in the upstream payload', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS, TASK_TYPES },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await new Promise((resolve, reject) => {
      aiService.send({
        taskType: TASK_TYPES.CONTINUE,
        messages: [{ role: 'user', content: 'viet tiep canh nay' }],
        stream: false,
        chatSafetyOff: true,
        onComplete: resolve,
        onError: reject,
      });
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.usage).toMatchObject({
      taskType: 'continue',
      taskGroup: 'story_writing',
      taskLabel: 'Viết truyện',
    });
    expect(body.payload).not.toHaveProperty('usage');
    expect(body.payload).not.toHaveProperty('usageContext');
  });
});
