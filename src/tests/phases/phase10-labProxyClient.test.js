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

function sendLabStreamOnce(labAIService, routerModule) {
  return new Promise((resolve, reject) => {
    labAIService.send({
      taskType: routerModule.TASK_TYPES.FREE_PROMPT,
      messages: [{ role: 'user', content: 'write a long lab scene' }],
      stream: true,
      onComplete: resolve,
      onError: reject,
    });
  });
}

function sseResponse(chunks = []) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

  it('does not complete Lab output when a proxy stream hits the output length limit', async () => {
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
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Lab partial "}}]}\n\n',
      'data: {"choices":[{"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendLabStreamOnce(labAIService, routerModule)).rejects.toMatchObject({
      code: 'INCOMPLETE_OUTPUT',
      partialText: 'Lab partial ',
    });
  });
});
