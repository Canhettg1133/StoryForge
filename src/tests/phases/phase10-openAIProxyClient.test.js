import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadClientStack() {
  vi.resetModules();
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    getSession: async () => ({ access_token: 'story-token' }),
    subscribe: () => () => {},
  }));
  const [clientModule, routerModule, keyManagerModule, proxyConfigModule, accessClientModule] = await Promise.all([
    import('../../services/ai/client.js'),
    import('../../services/ai/router.js'),
    import('../../services/ai/keyManager.js'),
    import('../../services/ai/openAIProxyConfig.js'),
    import('../../services/access/accessClient.js'),
  ]);

  clientModule.default.setRouter(routerModule.default);

  return {
    aiService: clientModule.default,
    modelRouter: routerModule.default,
    keyManager: keyManagerModule.default,
    routerModule,
    proxyConfigModule,
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
        allowed: false,
        status: 403,
        reason: accessClientModule.ACCESS_REASONS.FEATURE_NOT_ALLOWED,
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

function sendStreamOnce(aiService, routerModule, { taskType = routerModule.TASK_TYPES.FREE_PROMPT } = {}) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType,
      messages: [{ role: 'user', content: 'write a long scene' }],
      stream: true,
      chatSafetyOff: true,
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

describe('OpenAI-compatible proxy client payloads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('reports missing ag proxy keys as Gemini Proxy, not Custom OpenAI-compatible', async () => {
    const {
      aiService,
      modelRouter,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    try {
      await sendOnce(aiService, routerModule);
      throw new Error('Expected sendOnce to reject.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MISSING_API_KEY',
        message: expect.stringContaining('Gemini Proxy'),
      });
      expect(error.message).not.toContain('OpenAI-compatible Proxy');
    }
    expect(fetchMock).not.toHaveBeenCalled();
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
    const body = JSON.parse(request.body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    expect(request.headers.Authorization).toBe('Bearer story-token');
    expect(request.headers['X-StoryForge-Upstream-Key']).toBe('sk-test-ag-key');
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://ag.beijixingxing.com');
    expect(body.chatCompletionsPath).toBe('/v1/chat/completions');
    expect(body.payload.safetySettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threshold: 'OFF' }),
      ]),
    );
    expect(body.payload.safety_settings).toEqual(body.payload.safetySettings);
  });

  it('forwards OpenAI-compatible image_url message parts to the ag proxy unchanged', async () => {
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
      choices: [{ message: { content: [{ type: 'text', text: 'IMG_OK' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const imageContent = [
      { type: 'text', text: 'Describe this image.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ];

    const result = await new Promise((resolve, reject) => {
      aiService.send({
        taskType: routerModule.TASK_TYPES.FREE_PROMPT,
        messages: [{ role: 'user', content: imageContent }],
        stream: false,
        chatSafetyOff: true,
        onComplete: resolve,
        onError: reject,
      });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(result).toBe('IMG_OK');
    expect(body.payload.messages[0].content).toEqual(imageContent);
    expect(JSON.stringify(body.payload.messages[0].content)).not.toContain('"source"');
  });

  it('forwards OpenAI image_url message parts to custom proxy profiles unchanged', async () => {
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
      choices: [{ message: { content: [{ type: 'text', text: 'IMG_OK' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'custom-vision-model',
      models: ['custom-vision-model'],
      supportsGeminiSafetySettings: false,
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const imageContent = [
      { type: 'text', text: 'Mô tả ảnh này.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } },
    ];

    const result = await new Promise((resolve, reject) => {
      aiService.send({
        taskType: routerModule.TASK_TYPES.FREE_PROMPT,
        messages: [{ role: 'user', content: imageContent }],
        stream: false,
        chatSafetyOff: true,
        onComplete: resolve,
        onError: reject,
      });
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(result).toBe('IMG_OK');
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(payload.messages[0].content).toEqual(imageContent);
  });

  it('forwards OpenAI image_url message parts to custom proxy relay profiles unchanged', async () => {
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
      choices: [{ message: { content: [{ type: 'text', text: 'IMG_OK' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'custom-vision-model',
      models: ['custom-vision-model'],
      supportsGeminiSafetySettings: false,
      transport: 'relay',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const imageContent = [
      { type: 'text', text: 'Mô tả ảnh này.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } },
    ];

    const result = await new Promise((resolve, reject) => {
      aiService.send({
        taskType: routerModule.TASK_TYPES.FREE_PROMPT,
        messages: [{ role: 'user', content: imageContent }],
        stream: false,
        chatSafetyOff: true,
        onComplete: resolve,
        onError: reject,
      });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(result).toBe('IMG_OK');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
    expect(body.payload.messages[0].content).toEqual(imageContent);
    expect(JSON.stringify(body.payload.messages[0].content)).not.toContain('"source"');
  });

  it('does not send Gemini safety settings to Claude models through the ag preset', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setAgProxyModel,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setAgProxyModel('anthropic/claude-3-5-sonnet');
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendOnce(aiService, routerModule);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.payload.model).toBe('anthropic/claude-3-5-sonnet');
    expect(body.payload).not.toHaveProperty('safetySettings');
    expect(body.payload).not.toHaveProperty('safety_settings');
  });

  it('does not send Gemini safety settings to Antigravity Gemini models through the ag preset', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setAgProxyModel,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setAgProxyModel('gemini-3-flash-preview-[星星公益站-反重力渠道]');
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await sendOnce(aiService, routerModule);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.payload.model).toBe('gemini-3-flash-preview-[星星公益站-反重力渠道]');
    expect(body.payload).not.toHaveProperty('safetySettings');
    expect(body.payload).not.toHaveProperty('safety_settings');
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

  it('uses legacy custom proxy keys from storage after a page refresh', async () => {
    localStorage.setItem('sf-api-keys-v2', JSON.stringify({
      gemini_proxy: [],
      openai_proxy: [],
      custom_openai_proxy: [{ key: 'sk-legacy-custom-key', label: 'legacy custom' }],
    }));
    localStorage.setItem('sf-preferred-provider', 'openai_proxy');
    localStorage.setItem('sf-ai-settings', JSON.stringify({
      openAIProxy: {
        activeProfileId: 'custom-openai-proxy',
        customProfile: {
          id: 'custom-openai-proxy',
          label: 'Custom OpenAI-compatible',
          baseUrl: 'https://proxy.example.com/v1',
          defaultModel: 'custom-refresh-model',
          models: ['custom-refresh-model'],
          chatCompletionsPath: '/v1/chat/completions',
          modelsPath: '/v1/models',
          authType: 'bearer',
          requiresApiKey: true,
          supportsGeminiSafetySettings: false,
          transport: 'direct',
        },
      },
      proxyUrl: 'https://proxy.example.com/v1',
    }));

    const {
      aiService,
      routerModule,
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok after refresh' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendOnce(aiService, routerModule)).resolves.toBe('ok after refresh');

    const [, request] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-legacy-custom-key');
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
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer story-token');
    expect(fetchMock.mock.calls[0][1].headers['X-StoryForge-Upstream-Key']).toBe('sk-test-custom-key');
    expect(fetchMock.mock.calls[1][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('custom-json-model');
  });

  it('upgrades public HTTP custom proxy chat requests to HTTPS on hosted pages', async () => {
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
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { protocol: 'https:' },
    });

    try {
      keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
      updateCustomOpenAIProxyProfile({
        baseUrl: 'http://proxy.example.com/v1',
        defaultModel: 'custom-json-model',
        models: ['custom-json-model'],
        transport: 'auto',
      });
      setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
      modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

      await sendOnce(aiService, routerModule);

      expect(fetchMock.mock.calls[0][0]).toBe('/api/openai-proxy');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.baseUrl).toBe('https://proxy.example.com/v1');
      expect(body.payload.model).toBe('custom-json-model');
    } finally {
      Object.defineProperty(window, 'location', locationDescriptor);
    }
  });

  it('tests custom proxy connection with chat completions instead of the models endpoint', async () => {
    const {
      aiService,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ket noi ok' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'manual-custom-model',
      models: [],
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const result = await aiService.testConnection(PROVIDERS.OPENAI_PROXY);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('manual-custom-model');
  });

  it('reports insufficient custom proxy credits from the chat test response', async () => {
    const {
      aiService,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: 'Insufficient credits - top up your balance',
        type: 'insufficient_quota',
        code: 'insufficient_credits',
      },
    }), { status: 402, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'manual-custom-model',
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const result = await aiService.testConnection(PROVIDERS.OPENAI_PROXY);

    expect(result.success).toBe(false);
    expect(result.error.toLowerCase()).toContain('credit');
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('normalizes custom proxy model-not-found errors from the chat test response', async () => {
    const {
      aiService,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: 'The model "manual-missing-model" does not exist or you do not have access to it.',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'manual-missing-model',
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const result = await aiService.testConnection(PROVIDERS.OPENAI_PROXY);

    expect(result.success).toBe(false);
    expect(result.error).toContain('không tìm thấy');
    expect(result.error).toContain('không có quyền');
    expect(result.error).not.toContain('does not exist');
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('normalizes custom proxy network errors from the connection test', async () => {
    const {
      aiService,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-test-custom-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'manual-custom-model',
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const result = await aiService.testConnection(PROVIDERS.OPENAI_PROXY);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Không thể kết nối tới Custom OpenAI-compatible Proxy');
    expect(result.error).not.toContain('Failed to fetch');
  });

  it('blocks AI Studio Relay before opening a relay connection when the VIP feature is missing', async () => {
    const {
      aiService,
      modelRouter,
      routerModule,
      routerModule: { PROVIDERS },
    } = await loadClientStack();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', vi.fn());

    modelRouter.setPreferredProvider(PROVIDERS.AI_STUDIO_RELAY);

    await expect(sendOnce(aiService, routerModule)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ALLOWED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it('blocks Gemini Direct before fetch when the VIP feature is not mapped to the user', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      accessClientModule,
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'should not run' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_DIRECT, 'gemini-direct-key');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    cacheFeatureDecision(
      accessClientModule,
      accessClientModule.ACCESS_FEATURES.GEMINI_DIRECT,
      { reason: accessClientModule.ACCESS_REASONS.FEATURE_NOT_ALLOWED },
    );

    await expect(sendOnce(aiService, routerModule)).rejects.toMatchObject({
      code: accessClientModule.ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces disabled Gemini Direct catalog before fetch', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      accessClientModule,
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'should not run' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_DIRECT, 'gemini-direct-key');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    cacheFeatureDecision(
      accessClientModule,
      accessClientModule.ACCESS_FEATURES.GEMINI_DIRECT,
      { reason: accessClientModule.ACCESS_REASONS.FEATURE_DISABLED },
    );

    await expect(sendOnce(aiService, routerModule)).rejects.toMatchObject({
      code: accessClientModule.ACCESS_REASONS.FEATURE_DISABLED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-continues writing streams that stop because the proxy hit the output length limit', async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"Phan dau "}}]}\n\n',
        'data: {"choices":[{"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n',
      ]))
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"phan tiep."}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule)).resolves.toBe('Phan dau phan tiep.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const continuationBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const continuationMessages = continuationBody.payload.messages;
    expect(continuationMessages.at(-2)).toMatchObject({ role: 'assistant', content: 'Phan dau ' });
    expect(continuationMessages.at(-1).content).toContain('tiếp tục ngay từ điểm đang dở');
  });

  it('auto-continues writing streams that close before the SSE DONE marker', async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"Dang viet do "}}]}\n\n',
      ]))
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"va ket thuc."}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule)).resolves.toBe('Dang viet do va ket thuc.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads Claude-style text parts from OpenAI-compatible stream content arrays', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setAgProxyModel,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Xin chào"}]},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setAgProxyModel('claude-sonnet-4-6');
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule)).resolves.toBe('Xin chào');
  });

  it('reports invalid proxy stream content instead of completing with an empty answer', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setAgProxyModel,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":{"unexpected":"value"}}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setAgProxyModel('claude-sonnet-4-6');
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule)).rejects.toMatchObject({
      code: 'EMPTY_STREAM',
      message: expect.stringContaining('AI không trả nội dung'),
    });
  });

  it('reports content removed by post-processing instead of storing an empty answer', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        AG_PROXY_PROFILE_ID,
        setAgProxyModel,
        setOpenAIProxyActiveProfile,
      },
    } = await loadClientStack();
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"[Location: unknown]"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setAgProxyModel('claude-sonnet-4-6');
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule)).rejects.toMatchObject({
      code: 'EMPTY_STREAM',
      message: expect.stringContaining('AI không trả nội dung'),
    });
  });

  it('does not auto-continue non-writing tasks when a stream is incomplete', async () => {
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
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Mot y tuong "}}]}\n\n',
      'data: {"choices":[{"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'sk-test-ag-key');
    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    await expect(sendStreamOnce(aiService, routerModule, {
      taskType: routerModule.TASK_TYPES.BRAINSTORM,
    })).rejects.toMatchObject({
      code: 'INCOMPLETE_OUTPUT',
      partialText: 'Mot y tuong ',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('auto-continues Gemini streams that stop at MAX_TOKENS', async () => {
    const {
      aiService,
      modelRouter,
      keyManager,
      routerModule,
      routerModule: { PROVIDERS },
      accessClientModule,
    } = await loadClientStack();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Mo dau "}]}}]}\n\n',
        'data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\n\n',
      ]))
      .mockResolvedValueOnce(sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"ket lai."}]},"finishReason":"STOP"}]}\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);

    keyManager.addKey(PROVIDERS.GEMINI_DIRECT, 'gemini-direct-key');
    modelRouter.setPreferredProvider(PROVIDERS.GEMINI_DIRECT);
    cacheFeatureDecision(
      accessClientModule,
      accessClientModule.ACCESS_FEATURES.GEMINI_DIRECT,
      {
        allowed: true,
        status: 200,
        reason: accessClientModule.ACCESS_REASONS.ALLOWED,
      },
    );

    await expect(sendStreamOnce(aiService, routerModule)).resolves.toBe('Mo dau ket lai.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
