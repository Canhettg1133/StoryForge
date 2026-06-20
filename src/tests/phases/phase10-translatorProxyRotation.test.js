import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadProxyRuntimeContext(fetchImpl) {
  const stored = new Map();
  const fakeElement = {
    value: '',
    checked: false,
    style: {},
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  };

  const context = {
    AbortController,
    Date,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: {
      addEventListener() {},
      getElementById() {
        return fakeElement;
      },
      createElement(tagName) {
        if (tagName === 'optgroup') return { label: '', children: [], appendChild(child) { this.children.push(child); } };
        if (tagName === 'option') return { value: '', textContent: '', selected: false };
        return {};
      },
      querySelector() {
        return fakeElement;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: {
      getItem(key) {
        return stored.has(key) ? stored.get(key) : null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      },
    },
    showToast() {},
    sleep: async () => {},
    fetch: fetchImpl,
  };

  vm.createContext(context);

  [
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/ui/settings.js',
    'public/translator-runtime/js/gemini/model-rotation.js',
    'public/translator-runtime/js/gemini/api.js',
    'public/translator-runtime/js/translation/retry.js',
    'public/translator-runtime/js/translation/engine.js',
    'public/translator-runtime/js/proxy/proxy-api.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });

  vm.runInContext(`
    useProxy = true;
    useOllama = false;
    storyForgeAccessToken = 'story-token';
    proxyBaseUrl = 'https://proxy.example.test/v1/chat/completions';
    proxyModel = 'test-model';
    proxyApiKeys = ['KEY1','KEY2','KEY3','KEY4','KEY5','KEY6','KEY7','KEY8','KEY9','KEY10'];
    proxyApiKey = proxyApiKeys[0];
    cancelRequested = false;
  `, context);

  return context;
}

describe('phase10 translator proxy key rotation', () => {
  it('retries a proxy chunk with a different key after the assigned key is suspended', async () => {
    const usedStoryForgeAuthHeaders = [];
    const usedUpstreamKeys = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const authorization = String(options.headers?.Authorization || '');
      const upstreamKey = String(options.headers?.['X-StoryForge-Upstream-Key'] || '');
      usedStoryForgeAuthHeaders.push(authorization);
      usedUpstreamKeys.push(upstreamKey);

      if (upstreamKey === 'KEY1') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'CONSUMER_SUSPENDED' } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
            },
          }],
        }),
      };
    });

    const result = await context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      6,
      3
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(usedStoryForgeAuthHeaders).toEqual(['Bearer story-token', 'Bearer story-token']);
    expect(usedUpstreamKeys).toEqual(['KEY1', 'KEY2']);
  });

  it('refreshes the StoryForge access token once when the relay rejects an expired token', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      const authorization = String(options.headers?.Authorization || '');
      if (authorization === 'Bearer story-token') {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: 'AUTH_REQUIRED',
            code: 'AUTH_REQUIRED',
            decision: { reason: 'AUTH_REQUIRED' },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      storyForgeAccessToken = 'story-token';
      refreshStoryForgeAccessContext = async () => {
        storyForgeAccessToken = 'fresh-story-token';
        return true;
      };
    `, context);

    const result = await context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      'KEY1'
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(requests).toHaveLength(2);
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[1].options.headers.Authorization).toBe('Bearer fresh-story-token');
    expect(requests[1].options.headers['X-StoryForge-Upstream-Key']).toBe('KEY1');
  });

  it('does not cap proxy parallel requests to the number of proxy keys', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by parallel resolver');
    });

    expect(context.resolveEffectiveTranslationParallel({
      requestedParallel: 10,
      useProxyMode: true,
      useOllamaMode: false,
      activeDirectCombinationCount: 1,
    })).toBe(10);
  });

  it('does not cap Gemini Direct parallel requests to active key/model combinations', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by parallel resolver');
    });

    expect(context.resolveEffectiveTranslationParallel({
      requestedParallel: 8,
      useProxyMode: false,
      useOllamaMode: false,
      activeDirectCombinationCount: 1,
    })).toBe(8);

    const engineSource = fs.readFileSync(
      path.join(repoRoot, 'public/translator-runtime/js/translation/engine.js'),
      'utf8'
    );
    expect(engineSource).not.toContain('[Pre-check] Reducing parallel');
    expect(engineSource).not.toContain('parallelCount = Math.max(1, currentCombos.length)');
    expect(engineSource).not.toContain('[Pre-check] All combinations disabled');
    expect(engineSource).not.toContain('modelKeyHealthMap = {};');
  });

  it('keeps Ollama translation sequential even when more parallel requests are requested', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by parallel resolver');
    });

    expect(context.resolveEffectiveTranslationParallel({
      requestedParallel: 8,
      useProxyMode: false,
      useOllamaMode: true,
      activeDirectCombinationCount: 8,
    })).toBe(1);
  });

  it('waits and force-unlocks a proxy key instead of failing while every key is cooling down', async () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by key selection');
    });

    vm.runInContext(`
      proxyApiKeys = ['KEY_A', 'KEY_B'];
      proxyApiKey = proxyApiKeys[0];
      activeTranslatorProvider = 'ag_proxy';
      recordProxyKeyError('KEY_A', 'RATE_LIMIT_429', 60000);
      recordProxyKeyError('KEY_B', 'RATE_LIMIT_429', 60000);
    `, context);

    await expect(context.getProxyKeyForChunk(0)).resolves.toBe('KEY_A');
  });

  it('routes AG Proxy remote HTTPS chat requests through the same OpenAI relay transport as Custom Proxy', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'ag_proxy';
      proxyBaseUrl = 'https://ag.beijixingxing.com/v1/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['AG_KEY'];
      proxyApiKey = 'AG_KEY';
    `, context);

    await context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      'AG_KEY'
    );

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[0].options.headers['X-StoryForge-Upstream-Key']).toBe('AG_KEY');
    const body = JSON.parse(requests[0].options.body);
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://ag.beijixingxing.com');
    expect(body.chatCompletionsPath).toBe('/v1/chat/completions');
    expect(body.payload.model).toBe('ag-gemini-model');
  });

  it('preserves a full AG Proxy chat endpoint path instead of forcing /v1/chat/completions', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'ag_proxy';
      proxyBaseUrl = 'https://ag.beijixingxing.com/v1beta/openai/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['AG_KEY'];
      proxyApiKey = 'AG_KEY';
    `, context);

    await context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      'AG_KEY'
    );

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    const body = JSON.parse(requests[0].options.body);
    expect(body.baseUrl).toBe('https://ag.beijixingxing.com/v1beta/openai');
    expect(body.chatCompletionsPath).toBe('/chat/completions');
    expect(body.payload.model).toBe('ag-gemini-model');
  });

  it('tests AG Proxy through the same relay transport used by translation', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'ag-gemini-model',
          choices: [{
            message: { content: 'Xin chào từ Gemini Proxy AG.' },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'ag_proxy';
      storyForgeAccessToken = 'story-token';
      proxyBaseUrl = 'https://ag.beijixingxing.com/v1beta/openai/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['AG_KEY'];
      proxyApiKey = 'AG_KEY';
      setActiveTranslatorTemplateId('convert');
    `, context);

    await context.testProxyConnection();

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[0].options.headers['X-StoryForge-Upstream-Key']).toBe('AG_KEY');
    const body = JSON.parse(requests[0].options.body);
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://ag.beijixingxing.com/v1beta/openai');
    expect(body.chatCompletionsPath).toBe('/chat/completions');
    expect(body.payload.model).toBe('ag-gemini-model');
  });

  it('migrates legacy /api/proxy AG test URLs to the translator relay target', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'ag-gemini-model',
          choices: [{
            message: { content: 'Xin chao tu Gemini Proxy AG.' },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'ag_proxy';
      storyForgeAccessToken = 'story-token';
      proxyBaseUrl = '/api/proxy/v1/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['AG_KEY'];
      proxyApiKey = 'AG_KEY';
      setActiveTranslatorTemplateId('convert');
    `, context);

    await context.testProxyConnection();

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[0].options.headers['X-StoryForge-Upstream-Key']).toBe('AG_KEY');
    const body = JSON.parse(requests[0].options.body);
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://ag.beijixingxing.com');
    expect(body.chatCompletionsPath).toBe('/v1/chat/completions');
    expect(body.payload.model).toBe('ag-gemini-model');
    expect(vm.runInContext('proxyBaseUrl', context)).toBe('https://ag.beijixingxing.com/v1/chat/completions');
  });

  it('tests remote Custom Proxy through the translator relay transport', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'custom-gemini-model',
          choices: [{
            message: { content: 'Xin chao tu Custom Proxy.' },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      storyForgeAccessToken = 'story-token';
      customProxyProfile = {
        baseUrl: 'https://custom.example/v1',
        defaultModel: 'custom-gemini-model',
        models: ['custom-gemini-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
      setActiveTranslatorTemplateId('convert');
    `, context);

    await context.testCustomProxyConnection();

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[0].options.headers['X-StoryForge-Upstream-Key']).toBe('CUSTOM_KEY');
    const body = JSON.parse(requests[0].options.body);
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://custom.example/v1');
    expect(body.chatCompletionsPath).toBe('/v1/chat/completions');
    expect(body.payload.model).toBe('custom-gemini-model');
  });

  it('does not report a generic proxy 404 as a missing model unless the upstream error says so', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by error mapping');
    });

    const endpointError = context.createProxyHttpError(
      404,
      { error: { message: 'HTTP 404' } },
      { model: 'ag-gemini-model', provider: 'Gemini Proxy AG' }
    );
    const modelError = context.createProxyHttpError(
      404,
      { error: { message: 'The model "ag-gemini-model" does not exist.' } },
      { model: 'ag-gemini-model', provider: 'Gemini Proxy AG' }
    );

    expect(endpointError.code).toBe('PROXY_HTTP_ERROR');
    expect(endpointError.retryable).toBe(true);
    expect(endpointError.shouldRotate).toBe(false);
    expect(modelError.code).toBe('PROXY_MODEL_NOT_FOUND');
    expect(modelError.shouldRotate).toBe(true);
  });

  it('rejects incomplete OpenAI-compatible proxy translations instead of accepting truncated text', async () => {
    const context = loadProxyRuntimeContext(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: 'length',
          message: {
            content: 'Bản dịch bị cắt giữa chừng nhưng vẫn có text. '.repeat(20),
          },
        }],
      }),
    }));

    await expect(context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      'KEY1'
    )).rejects.toMatchObject({
      code: 'PROXY_INCOMPLETE_RESPONSE',
      finishReason: 'length',
      retryable: true,
    });
  });

  it('streams same-key AG relay chunks through one connection per key while resolving each chunk individually', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requests.push({ url: String(url), options, body });
      if (body.action === 'chat_stream_batch') {
        const lines = body.payloads.map((_, index) => JSON.stringify({
          index,
          ok: true,
          status: 200,
          body: {
            choices: [{
              message: {
                content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
              },
            }],
          },
        })).join('\n') + '\n';
        return new Response(lines, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'ag_proxy';
      proxyBaseUrl = 'https://ag.beijixingxing.com/v1/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['KEY_A', 'KEY_B'];
      proxyApiKey = 'KEY_A';
    `, context);

    await Promise.all([
      ...Array.from({ length: 5 }, () => context.translateChunkViaProxy(
        'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
        0.7,
        'KEY_A'
      )),
      ...Array.from({ length: 5 }, () => context.translateChunkViaProxy(
        'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
        0.7,
        'KEY_B'
      )),
    ]);

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.options.headers.Authorization).sort()).toEqual([
      'Bearer story-token',
      'Bearer story-token',
    ]);
    expect(requests.map((request) => request.options.headers['X-StoryForge-Upstream-Key']).sort()).toEqual([
      'KEY_A',
      'KEY_B',
    ]);
    requests.forEach((request) => {
      expect(request.url).toBe('/api/translator-openai-proxy');
      expect(request.body.action).toBe('chat_stream_batch');
      expect(request.body.baseUrl).toBe('https://ag.beijixingxing.com');
      expect(request.body.chatCompletionsPath).toBe('/v1/chat/completions');
      expect(request.body.payloads).toHaveLength(5);
      expect(request.body.payloads.every((payload) => payload.model === 'ag-gemini-model')).toBe(true);
    });
  });

  it('fetches Custom Proxy models from the openai_proxy key pool without changing AG config', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'openai/gpt-4.1' },
            { id: 'google/gemini-2.5-pro' },
            { id: 'gemini-2.5-flash' },
          ],
        }),
      };
    });

    vm.runInContext(`
      proxyModel = 'ag-model';
      proxyApiKeys = ['AG_KEY'];
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1/chat/completions',
        defaultModel: '',
        models: [],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    const models = await context.fetchCustomProxyModels();

    expect(requests[0].url).toBe('http://localhost:1234/v1/models');
    expect(requests[0].options.headers.Authorization).toBe('Bearer CUSTOM_KEY');
    expect(models).toEqual(['openai/gpt-4.1', 'google/gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(vm.runInContext('proxyModel', context)).toBe('ag-model');
    expect(vm.runInContext('proxyApiKeys', context)).toEqual(['AG_KEY']);
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('openai/gpt-4.1');
  });

  it('does not write translator Custom Proxy state back into main StoryForge settings', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by settings persistence');
    });

    vm.runInContext(`
      localStorage.setItem('sf-ai-settings', JSON.stringify({
        proxyUrl: '/api/proxy',
        openAIProxy: {
          activeProfileId: 'ag-gemini-proxy',
          customProfile: {
            baseUrl: '',
            defaultModel: '',
            models: []
          }
        }
      }));
      localStorage.setItem('sf-api-keys-v2', JSON.stringify({
        gemini_proxy: [{ key: 'AG_KEY' }],
        openai_proxy: []
      }));

      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'https://old-custom.example/v1',
        defaultModel: 'old-custom-model',
        models: ['old-custom-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['OLD_CUSTOM_KEY'];
      customProxyApiKey = 'OLD_CUSTOM_KEY';
      updateWorkspaceToolbar = () => {};

      saveSettings();
    `, context);

    expect(JSON.parse(context.localStorage.getItem('sf-ai-settings'))).toEqual({
      proxyUrl: '/api/proxy',
      openAIProxy: {
        activeProfileId: 'ag-gemini-proxy',
        customProfile: {
          baseUrl: '',
          defaultModel: '',
          models: [],
        },
      },
    });
    expect(JSON.parse(context.localStorage.getItem('sf-api-keys-v2'))).toEqual({
      gemini_proxy: [{ key: 'AG_KEY' }],
      openai_proxy: [],
    });
  });

  it('translates through Custom Proxy with its own URL, key, and selected model', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'custom-gemini-model',
        models: ['custom-gemini-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    await context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      context.getProxyKeyForChunk(0)
    );

    expect(requests[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(requests[0].options.headers.Authorization).toBe('Bearer CUSTOM_KEY');
    expect(JSON.parse(requests[0].options.body).model).toBe('custom-gemini-model');
  });

  it('disables Gemini 2.5 Flash thinking for direct translation chunks', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
              }],
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      cancelRequested = false;
    `, context);

    await context.translateChunk(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      { model: 'gemini-2.5-flash', key: 'DIRECT_KEY', keyIndex: 0 },
      0.7
    );

    const body = JSON.parse(requests[0].options.body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig).not.toHaveProperty('maxOutputTokens');
  });

  it('cooldowns a direct Gemini pair after repeated Google 500 errors and retries another pair', async () => {
    const usedKeys = [];
    const context = loadProxyRuntimeContext(async (url) => {
      const key = new URL(String(url)).searchParams.get('key');
      usedKeys.push(key);

      if (key === 'DIRECT_KEY_A') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { status: 'INTERNAL', message: 'Internal error encountered.' } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
              }],
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY_A', 'DIRECT_KEY_B'];
      GEMINI_MODELS = [{ name: 'gemma-4-31b-it', quota: 15, rpd: 1500, enabled: true }];
      cancelRequested = false;
    `, context);

    const result = await context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0,
      3
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(usedKeys).toEqual(['DIRECT_KEY_A', 'DIRECT_KEY_B']);
    expect(vm.runInContext("modelKeyHealthMap['gemma-4-31b-it|0'].disabledUntil > Date.now()", context)).toBe(true);
    expect(vm.runInContext(`
      getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0, 'main')
      + getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 1, 'main')
    `, context)).toBe(1);
    expect(vm.runInContext(`
      getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0, 'retry')
      + getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 1, 'retry')
    `, context)).toBe(1);
  });

  it('records a Direct 429 cooldown once before retrying another key', async () => {
    const usedKeys = [];
    const context = loadProxyRuntimeContext(async (url) => {
      const key = new URL(url).searchParams.get('key');
      usedKeys.push(key);
      if (key === 'DIRECT_KEY_A') {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Please retry in 20s.' } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
              }],
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY_A', 'DIRECT_KEY_B'];
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
    `, context);

    const result = await context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0,
      2
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(usedKeys).toEqual(['DIRECT_KEY_A', 'DIRECT_KEY_B']);
    expect(vm.runInContext(
      "modelKeyHealthMap['gemini-2.5-flash|0'].errorCount",
      context
    )).toBe(1);
  });

  it('throws the final Direct API error instead of returning undefined', async () => {
    const context = loadProxyRuntimeContext(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { status: 'UNAUTHENTICATED', message: 'API key not valid.' } }),
    }));

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['INVALID_DIRECT_KEY'];
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
    `, context);

    await expect(context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0,
      1
    )).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });

  it('allows the first ten Direct requests with one key configured at 10 RPM', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by pair selection');
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
    `, context);

    const selectedPairs = vm.runInContext(
      'Array.from({ length: 10 }, () => getNextModelKeyPairWithQueue())',
      context
    );

    expect(selectedPairs).toHaveLength(10);
    expect(selectedPairs.every((pair) => pair.key === 'DIRECT_KEY')).toBe(true);
    expect(vm.runInContext(
      'getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0)',
      context
    )).toBe(10);
    expect(() => vm.runInContext('getNextModelKeyPairWithQueue()', context)).toThrow(/RPM/i);
  });

  it('does not consume a Gemini Direct retry while waiting for the shared RPM slot', async () => {
    let requestCount = 0;
    const context = loadProxyRuntimeContext(async () => {
      requestCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90),
              }],
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 1;
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
      recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0);
      sleep = async () => { translatorRpmTimestamps = {}; };
    `, context);

    const result = await context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0,
      1
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(requestCount).toBe(1);
  });

  it('stops immediately when every Gemini Direct API key is invalid', async () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used when all keys are already invalid');
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['INVALID_DIRECT_KEY'];
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
      recordKeyError(0, 'INVALID_KEY', 86400);
      recordModelKeyError('gemini-2.5-flash', 0, 86400);
      sleep = async () => { throw new Error('Direct must not wait for an invalid key'); };
    `, context);

    await expect(context.sendDirectTranslationAttempt({
      text: 'Đoạn nguồn cần dịch.',
      kind: 'retry',
    })).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
      retryable: false,
    });
  });

  it('does not silently keep source sub-chunks when Direct split retry is waiting for RPM', async () => {
    let requestCount = 0;
    const context = loadProxyRuntimeContext(async () => {
      requestCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(40),
              }],
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 1;
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', enabled: true }];
      cancelRequested = false;
      recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0);
      sleep = async () => { translatorRpmTimestamps = {}; };
    `, context);

    const sourceLines = [
      'SOURCE_PART_ONE',
      'SOURCE_PART_TWO',
      'SOURCE_PART_THREE',
      'SOURCE_PART_FOUR',
    ];
    const result = await context.translateLargeChunkBySplitting(sourceLines.join('\n'), 0);

    expect(requestCount).toBe(4);
    sourceLines.forEach((sourceLine) => expect(result).not.toContain(sourceLine));
  });
});
