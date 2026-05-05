import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadClientStack() {
  vi.resetModules();
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

function sendOnce(aiService, routerModule) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: routerModule.TASK_TYPES.FREE_PROMPT,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      chatSafetyOff: true,
      onComplete: resolve,
      onError: reject,
    });
  });
}

describe('OpenAI-compatible proxy client payloads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('does not send Gemini safety settings to custom proxy profiles', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'custom-json-model',
      models: ['custom-json-model'],
      supportsGeminiSafetySettings: false,
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendOnce(aiService, routerModule);

    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-test-custom-key');
    expect(payload.model).toBe('custom-json-model');
    expect(payload).not.toHaveProperty('safetySettings');
    expect(payload).not.toHaveProperty('safety_settings');
  });

  it('keeps Gemini safety settings for the ag preset when safety off is requested', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendOnce(aiService, routerModule);

    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-test-ag-key');
    expect(payload.safetySettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threshold: 'OFF' }),
      ]),
    );
    expect(payload.safety_settings).toEqual(payload.safetySettings);
  });

  it('fails before fetch when a custom proxy profile has no selected model', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: '',
      models: [],
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendOnce(aiService, routerModule)).rejects.toMatchObject({
      code: 'MISSING_MODEL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to direct chat when the same-origin relay route is missing', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'custom-json-model',
      models: ['custom-json-model'],
      transport: 'relay',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendOnce(aiService, routerModule);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    expect(fetchMock.mock.calls[1][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('custom-json-model');
  });
});
