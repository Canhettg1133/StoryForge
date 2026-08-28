import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const liveGeminiKeys = [
  process.env.STORYFORGE_LIVE_GEMINI_KEY_1,
  process.env.STORYFORGE_LIVE_GEMINI_KEY_2,
].map((key) => String(key || '').trim()).filter(Boolean);
const liveGeminiIt = process.env.STORYFORGE_LIVE_GEMINI === '1' && liveGeminiKeys.length === 2
  ? it
  : it.skip;

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
    'public/translator-runtime/js/translation/request-contract.js',
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

  it('waits the full proxy cooldown instead of force-unlocking a key after ten seconds', async () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by key selection');
    });
    let now = 1_000_000;
    let waitedMs = 0;
    class FakeDate extends Date {
      static now() {
        return now;
      }
    }
    context.Date = FakeDate;
    context.sleep = async (ms) => {
      waitedMs += ms;
      now += ms;
    };

    vm.runInContext(`
      proxyApiKeys = ['KEY_A', 'KEY_B'];
      proxyApiKey = proxyApiKeys[0];
      activeTranslatorProvider = 'ag_proxy';
      recordProxyKeyError('KEY_A', 'RATE_LIMIT_429', 60000);
      recordProxyKeyError('KEY_B', 'RATE_LIMIT_429', 60000);
    `, context);

    await expect(context.getProxyKeyForChunk(0)).resolves.toBe('KEY_A');
    expect(waitedMs).toBe(60_000);
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
    expect(body.payload.stream).toBe(false);
    expect(body.payload.max_tokens).toBe(16384);
    expect(body.payload).not.toHaveProperty('safetySettings');
    expect(body.payload).not.toHaveProperty('safety_settings');
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
    expect(body.payload.stream).toBe(false);
    expect(body.payload.max_tokens).toBeGreaterThanOrEqual(1000);
  });

  it('formats Custom Proxy model fetch errors with Vietnamese proxy messages', async () => {
    const context = loadProxyRuntimeContext(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    }));

    vm.runInContext(`
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'custom-model',
        models: [],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['BAD_CUSTOM_KEY'];
      customProxyApiKey = 'BAD_CUSTOM_KEY';
    `, context);

    const models = await context.fetchCustomProxyModels();
    const status = context.document.getElementById('customProxyModelStatus');

    expect(models).toEqual([]);
    expect(status.textContent).toContain('API Key proxy không hợp lệ');
    expect(status.textContent).not.toContain('Invalid API key');
  });

  it('formats Custom Proxy test errors with Vietnamese proxy messages', async () => {
    const context = loadProxyRuntimeContext(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'The model "custom-missing-model" does not exist.',
          code: 'model_not_found',
        },
      }),
    }));

    vm.runInContext(`
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'custom-missing-model',
        models: ['custom-missing-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    await context.testCustomProxyConnection();
    const result = context.document.getElementById('customProxyTestResult');

    expect(result.innerHTML).toContain('Proxy không tìm thấy model');
    expect(result.innerHTML).toContain('custom-missing-model');
    expect(result.innerHTML).not.toContain('does not exist');
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
      expect(request.body.payloads.every((payload) => payload.stream === false)).toBe(true);
      expect(request.body.payloads.every((payload) => payload.max_tokens === 16384)).toBe(true);
    });
  });

  it('starts ten same-key relay chunks through two concurrent Cloudflare-safe relay requests', async () => {
    const requests = [];
    let releaseRelayResponses;
    const relayResponseGate = new Promise((resolve) => {
      releaseRelayResponses = resolve;
    });
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requests.push({ url: String(url), options, body });
      await relayResponseGate;

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
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'https://catie.example.test/v1',
        defaultModel: 'gcli-gemini-3-flash-preview',
        models: ['gcli-gemini-3-flash-preview'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    const translations = Promise.all(Array.from({ length: 10 }, () => context.translateChunkViaProxy(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0.7,
      'CUSTOM_KEY'
    )));

    await new Promise((resolve) => setTimeout(resolve, 25));
    const requestsStartedBeforeAnyResponse = [...requests];
    releaseRelayResponses();
    await translations;

    expect(requestsStartedBeforeAnyResponse).toHaveLength(2);
    expect(requestsStartedBeforeAnyResponse
      .map((request) => request.body.payloads.length)
      .sort((left, right) => left - right)).toEqual([5, 5]);
    requestsStartedBeforeAnyResponse.forEach((request) => {
      expect(request.url).toBe('/api/translator-openai-proxy');
      expect(request.body.action).toBe('chat_stream_batch');
      expect(request.options.headers['X-StoryForge-Upstream-Key']).toBe('CUSTOM_KEY');
    });
  });

  it('maps reversed NDJSON relay results back to the original chunk order', async () => {
    const expected = Array.from(
      { length: 5 },
      (_, index) => `Bản dịch tiếng Việt số ${index + 1}, đủ dài và có dấu. `.repeat(90).trim()
    );
    const context = loadProxyRuntimeContext(async (_url, options = {}) => {
      const body = JSON.parse(options.body);
      const lines = body.payloads.map((_, index) => JSON.stringify({
        index,
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: expected[index] } }] },
      })).reverse().join('\n') + '\n';
      return new Response(lines, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'https://catie.example.test/v1',
        defaultModel: 'custom-model',
        models: ['custom-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => (
      context.translateChunkViaProxy(`source-${index}`, 0.7, 'CUSTOM_KEY')
    )));

    expect(results).toEqual(expected);
  });

  it('balances the minimum number of relay shards for every wave size from one to thirty', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by relay shard planning');
    });

    for (let requestCount = 1; requestCount <= 30; requestCount += 1) {
      const sizes = [...context.getBalancedProxyRelayShardSizes(requestCount)];
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(requestCount);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(sizes).toHaveLength(Math.ceil(requestCount / 6));
    }

    expect([...context.getBalancedProxyRelayShardSizes(10)]).toEqual([5, 5]);
    expect([...context.getBalancedProxyRelayShardSizes(13)]).toEqual([5, 4, 4]);
    expect([...context.getBalancedProxyRelayShardSizes(15)]).toEqual([5, 5, 5]);
    expect([...context.getBalancedProxyRelayShardSizes(20)]).toEqual([5, 5, 5, 5]);
    expect([...context.getBalancedProxyRelayShardSizes(30)]).toEqual([6, 6, 6, 6, 6]);
  });

  it('keeps relay shards separated and balanced for two-key and six-key waves', async () => {
    const runPattern = async (counts) => {
      const requests = [];
      const context = loadProxyRuntimeContext(async (_url, options = {}) => {
        const body = JSON.parse(options.body);
        requests.push({ body, key: options.headers['X-StoryForge-Upstream-Key'] });
        const lines = body.payloads.map((_, index) => JSON.stringify({
          index,
          ok: true,
          status: 200,
          body: {
            choices: [{ message: { content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90) } }],
          },
        })).reverse().join('\n') + '\n';
        return new Response(lines, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      });
      const keys = counts.map((_, index) => `KEY_${index}`);
      context.patternKeys = keys;
      vm.runInContext(`
        useProxy = true;
        activeTranslatorProvider = 'custom_proxy';
        customProxyProfile = {
          baseUrl: 'https://catie.example.test/v1',
          defaultModel: 'custom-model',
          models: ['custom-model'],
          chatCompletionsPath: '/v1/chat/completions',
          modelsPath: '/v1/models',
          transport: 'auto'
        };
        customProxyApiKeys = patternKeys;
        customProxyApiKey = patternKeys[0];
      `, context);

      await Promise.all(counts.flatMap((count, keyIndex) => (
        Array.from({ length: count }, () => context.translateChunkViaProxy(
          'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
          0.7,
          keys[keyIndex]
        ))
      )));
      return requests;
    };

    const twoKeyRequests = await runPattern([10, 10]);
    expect(twoKeyRequests).toHaveLength(4);
    expect(twoKeyRequests.map(({ body }) => body.payloads.length)).toEqual([5, 5, 5, 5]);
    expect(twoKeyRequests.filter(({ key }) => key === 'KEY_0')).toHaveLength(2);
    expect(twoKeyRequests.filter(({ key }) => key === 'KEY_1')).toHaveLength(2);

    const sixKeyRequests = await runPattern([5, 5, 5, 5, 5, 5]);
    expect(sixKeyRequests).toHaveLength(6);
    expect(sixKeyRequests.every(({ body }) => body.payloads.length === 5)).toBe(true);
    expect(new Set(sixKeyRequests.map(({ key }) => key)).size).toBe(6);
  });

  it('reads Retry-After from a single relay response and a streamed batch item', async () => {
    const relayCalls = [];
    const context = loadProxyRuntimeContext(async (_url, options = {}) => {
      const body = JSON.parse(options.body);
      relayCalls.push(body);
      if (body.action === 'chat') {
        const firstSingle = relayCalls.filter((call) => call.action === 'chat').length === 1;
        return new Response(JSON.stringify({
          error: 'rate limited',
          ...(firstSingle ? {} : { retryAfterSeconds: 17 }),
        }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            ...(firstSingle ? { 'retry-after': '23' } : {}),
          },
        });
      }
      const lines = body.payloads.map((_, index) => JSON.stringify({
        index,
        ok: false,
        status: 429,
        retryAfterSeconds: 31,
        body: { error: 'rate limited' },
      })).join('\n') + '\n';
      return new Response(lines, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'https://catie.example.test/v1',
        defaultModel: 'custom-model',
        models: ['custom-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    await expect(context.translateChunkViaProxy('single', 0.7, 'CUSTOM_KEY')).rejects.toMatchObject({
      code: 'PROXY_RATE_LIMIT',
      retryAfterSeconds: 23,
    });
    await expect(context.translateChunkViaProxy('body', 0.7, 'CUSTOM_KEY')).rejects.toMatchObject({
      code: 'PROXY_RATE_LIMIT',
      retryAfterSeconds: 17,
    });

    const batchResults = await Promise.allSettled([
      context.translateChunkViaProxy('batch-a', 0.7, 'CUSTOM_KEY'),
      context.translateChunkViaProxy('batch-b', 0.7, 'CUSTOM_KEY'),
    ]);
    expect(batchResults).toHaveLength(2);
    batchResults.forEach((result) => {
      expect(result.status).toBe('rejected');
      expect(result.reason).toMatchObject({
        code: 'PROXY_RATE_LIMIT',
        retryAfterSeconds: 31,
      });
    });
    expect(relayCalls.map((call) => call.action)).toEqual(['chat', 'chat', 'chat_stream_batch']);
  });

  it('rotates immediately after a proxy 429 and applies five-second exponential cooldown without a fixed sleep', async () => {
    const context = loadProxyRuntimeContext(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    }));
    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'custom-model',
        models: ['custom-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['KEY_A', 'KEY_B'];
      customProxyApiKey = 'KEY_A';
      rpmPerKey = 10;
      cancelRequested = false;
      translatorRpmTimestamps = {};
      sleepDurations = [];
      sleep = async (ms) => { sleepDurations.push(ms); };
      Math.random = () => 0;
    `, context);
    const startedAt = vm.runInContext('Date.now()', context);

    await expect(context.translateChunkWithRetry('source', 0, 2)).rejects.toMatchObject({
      code: 'PROXY_RATE_LIMIT',
    });

    expect(vm.runInContext('sleepDurations', context)).toEqual([]);
    const cooldowns = vm.runInContext(`[
      customProxyKeyHealthMap[0].disabledUntil - ${startedAt},
      customProxyKeyHealthMap[1].disabledUntil - ${startedAt}
    ]`, context);
    expect(cooldowns[0]).toBeGreaterThanOrEqual(5_000);
    expect(cooldowns[0]).toBeLessThan(6_000);
    expect(cooldowns[1]).toBeGreaterThanOrEqual(5_000);
    expect(cooldowns[1]).toBeLessThan(6_000);
  });

  it('increases repeated proxy 429 backoff from five to ten to twenty seconds and caps it at sixty', () => {
    const context = loadProxyRuntimeContext(async () => {
      throw new Error('fetch is not used by backoff calculation');
    });
    vm.runInContext(`
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyApiKeys = ['KEY_A'];
      customProxyApiKey = 'KEY_A';
      customProxyKeyHealthMap = {};
      Math.random = () => 0;
    `, context);

    const backoffs = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      backoffs.push(vm.runInContext("getProxyRateLimitBackoffMs('KEY_A')", context));
      vm.runInContext("recordProxyKeyError('KEY_A', 'RATE_LIMIT_429', 1000)", context);
    }

    expect(backoffs).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('fails clearly instead of bypassing RPM when the proxy scheduler is unavailable', async () => {
    let transportCalls = 0;
    const context = loadProxyRuntimeContext(async () => {
      transportCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'translated' } }] }),
      };
    });
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A'];
      proxyApiKey = 'KEY_A';
      proxyModel = 'proxy-model';
      sendProxyTranslationAttempt = undefined;
    `, context);

    await expect(context.translateChunkWithRetry('source', 0, 1)).rejects.toMatchObject({
      code: 'PROXY_SCHEDULER_UNAVAILABLE',
      retryable: false,
      userMessage: expect.stringContaining('bộ điều phối proxy'),
    });
    expect(transportCalls).toBe(0);
  });

  it('releases the RPM reservation when direct proxy fetch fails before dispatch', async () => {
    const context = loadProxyRuntimeContext(() => {
      throw new TypeError('invalid request URL');
    });
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'https://proxy.example.test/v1',
        defaultModel: 'custom-model',
        models: ['custom-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
      rpmPerKey = 1;
      translatorRpmTimestamps = {};
      translatorRpmReservations = {};
    `, context);

    await expect(context.sendProxyTranslationAttempt({
      chunkIndex: 0,
      text: 'source',
      kind: 'retry',
    })).rejects.toMatchObject({ rawMessage: 'invalid request URL' });
    expect(vm.runInContext(
      'getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0)',
      context
    )).toBe(0);
    expect(vm.runInContext(
      'getTranslatorRpmReservationCount(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0)',
      context
    )).toBe(0);
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

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('http://localhost:1234/v1/models');
    expect(requests[0].options.headers.Authorization).toBe('Bearer CUSTOM_KEY');
    expect(models).toEqual(['openai/gpt-4.1', 'google/gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(vm.runInContext('proxyModel', context)).toBe('ag-model');
    expect(vm.runInContext('proxyApiKeys', context)).toEqual(['AG_KEY']);
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('openai/gpt-4.1');
  });

  it('merges the OpenCode catalog into likely 9Router Custom Proxy model fetches', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });

      if (String(url) === 'http://localhost:20128/v1/models') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'cx/gpt-5.6-sol' }],
          }),
        };
      }

      if (String(url) === '/api/openai-proxy') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'mimo-v2.5-free' },
              { id: 'oc/deepseek-v4-flash-free' },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vm.runInContext(`
      storyForgeAccessToken = 'story-token';
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'http://localhost:20128/v1',
        defaultModel: 'oc/deepseek-v4-flash-free',
        models: ['oc/deepseek-v4-flash-free'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
    `, context);

    const models = await context.fetchCustomProxyModels();

    expect(models).toEqual([
      'cx/gpt-5.6-sol',
      'oc/mimo-v2.5-free',
      'oc/deepseek-v4-flash-free',
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('http://localhost:20128/v1/models');
    expect(requests[0].options.headers.Authorization).toBe('Bearer CUSTOM_KEY');
    expect(requests[1].url).toBe('/api/openai-proxy');
    expect(requests[1].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[1].options.headers['X-StoryForge-Upstream-Key']).toBeUndefined();
    expect(requests[1].body).toEqual({
      action: 'model_catalog',
      catalog: '9router_opencode',
    });
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('oc/deepseek-v4-flash-free');
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
    const body = JSON.parse(requests[0].options.body);
    expect(body.model).toBe('custom-gemini-model');
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(32768);
    expect(body).not.toHaveProperty('safetySettings');
    expect(body).not.toHaveProperty('safety_settings');
  });

  it('translates remote Custom Proxy relay chunks with the Custom output token budget', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Báº£n dá»‹ch tiáº¿ng Viá»‡t há»£p lá»‡, Ä‘á»§ dĂ i vĂ  cĂ³ dáº¥u. '.repeat(90),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = 'custom_proxy';
      customProxyProfile = {
        baseUrl: 'https://custom.example/v1',
        defaultModel: 'oc/deepseek-v4-flash-free',
        models: ['oc/deepseek-v4-flash-free'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyApiKey = 'CUSTOM_KEY';
      setActiveTranslatorTemplateId('convert');
    `, context);

    await context.translateChunkViaProxy(
      'Äoáº¡n nguá»“n cáº§n dá»‹ch sang tiáº¿ng Viá»‡t. '.repeat(20),
      0.7,
      'CUSTOM_KEY'
    );

    expect(requests[0].url).toBe('/api/translator-openai-proxy');
    expect(requests[0].options.headers.Authorization).toBe('Bearer story-token');
    expect(requests[0].options.headers['X-StoryForge-Upstream-Key']).toBe('CUSTOM_KEY');
    const body = JSON.parse(requests[0].options.body);
    expect(body.action).toBe('chat');
    expect(body.baseUrl).toBe('https://custom.example/v1');
    expect(body.chatCompletionsPath).toBe('/v1/chat/completions');
    expect(body.payload.model).toBe('oc/deepseek-v4-flash-free');
    expect(body.payload.stream).toBe(false);
    expect(body.payload.max_tokens).toBe(32768);
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

  it('sends OFF safety settings for Gemini Direct translation chunks', async () => {
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
      { model: 'gemini-3.1-flash-lite', key: 'DIRECT_KEY', keyIndex: 0 },
      0.7
    );

    const body = JSON.parse(requests[0].options.body);
    expect(body.safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
    ]);
  });

  it('separates system prompt from source text for each Gemini Direct chunk request', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(120),
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
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'gemini-3.1-flash-lite', enabled: true }];
      cancelRequested = false;
      translatorRpmTimestamps = {};
    `, context);

    const prompt = 'PROMPT_SENTINEL: translate every line and keep names.\n\nVĂN BẢN CẦN BIÊN TẬP:';
    const chunks = [
      'CHUNK_ONE_SENTINEL: Alice opened the bronze gate.',
      'CHUNK_TWO_SENTINEL: Bob crossed the frozen river.',
    ];

    for (let index = 0; index < chunks.length; index += 1) {
      await context.translateChunkWithRetry(
        context.buildPromptedChunk(prompt, chunks[index], 'en'),
        index,
        1
      );
    }

    expect(requests).toHaveLength(2);
    const requestTexts = requests.map((body) => body.contents[0].parts[0].text);
    expect(requestTexts[0]).not.toContain('PROMPT_SENTINEL');
    expect(requestTexts[0]).toContain('CHUNK_ONE_SENTINEL');
    expect(requestTexts[0]).not.toContain('CHUNK_TWO_SENTINEL');
    expect(requestTexts[0]).not.toContain('VĂN BẢN CẦN BIÊN TẬP:');
    expect(requestTexts[1]).not.toContain('PROMPT_SENTINEL');
    expect(requestTexts[1]).toContain('CHUNK_TWO_SENTINEL');
    expect(requestTexts[1]).not.toContain('CHUNK_ONE_SENTINEL');
    expect(requestTexts[1]).not.toContain('VĂN BẢN CẦN BIÊN TẬP:');

    const systemTexts = requests.map((body) => body.systemInstruction.parts[0].text);
    expect(systemTexts[0]).toContain('PROMPT_SENTINEL');
    expect(systemTexts[0]).not.toContain('CHUNK_ONE_SENTINEL');
    expect(systemTexts[0]).not.toContain('CHUNK_TWO_SENTINEL');
    expect(systemTexts[0]).not.toContain('VĂN BẢN CẦN BIÊN TẬP:');
    expect(systemTexts[1]).toContain('PROMPT_SENTINEL');
    expect(systemTexts[1]).not.toContain('CHUNK_ONE_SENTINEL');
    expect(systemTexts[1]).not.toContain('CHUNK_TWO_SENTINEL');
    expect(systemTexts[1]).not.toContain('VĂN BẢN CẦN BIÊN TẬP:');
  });

  it('separates system and user messages for each Custom Proxy chunk request', async () => {
    const requestMessages = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requestMessages.push(body.messages);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(120),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyProfile = {
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'custom-gemini-model',
        models: ['custom-gemini-model'],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'direct'
      };
      customProxyApiKeys = ['CUSTOM_KEY_A', 'CUSTOM_KEY_B'];
      customProxyApiKey = 'CUSTOM_KEY_A';
      rpmPerKey = 10;
      cancelRequested = false;
      translatorRpmTimestamps = {};
    `, context);

    const prompt = 'PROMPT_SENTINEL: translate every line and keep names.';
    const chunks = [
      'CHUNK_ONE_SENTINEL: Alice opened the bronze gate.',
      'CHUNK_TWO_SENTINEL: Bob crossed the frozen river.',
    ];

    for (let index = 0; index < chunks.length; index += 1) {
      await context.translateChunkWithRetry(
        context.buildPromptedChunk(prompt, chunks[index], 'en'),
        index,
        1
      );
    }

    expect(requestMessages).toHaveLength(2);
    expect(requestMessages[0][0]).toMatchObject({ role: 'system', content: expect.stringContaining('PROMPT_SENTINEL') });
    expect(requestMessages[0][1]).toMatchObject({ role: 'user', content: expect.stringContaining('CHUNK_ONE_SENTINEL') });
    expect(requestMessages[0][1].content).not.toContain('CHUNK_TWO_SENTINEL');
    expect(requestMessages[0][1].content).not.toContain('PROMPT_SENTINEL');
    expect(requestMessages[1][0]).toMatchObject({ role: 'system', content: expect.stringContaining('PROMPT_SENTINEL') });
    expect(requestMessages[1][1]).toMatchObject({ role: 'user', content: expect.stringContaining('CHUNK_TWO_SENTINEL') });
    expect(requestMessages[1][1].content).not.toContain('CHUNK_ONE_SENTINEL');
    expect(requestMessages[1][1].content).not.toContain('PROMPT_SENTINEL');
  });

  it('separates system and user messages for each AG Proxy relay chunk request', async () => {
    const requestMessages = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requestMessages.push(body.payload.messages);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(120),
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      storyForgeAccessToken = 'story-token';
      proxyBaseUrl = 'https://ag.beijixingxing.com/v1/chat/completions';
      proxyModel = 'ag-gemini-model';
      proxyApiKeys = ['AG_KEY_A', 'AG_KEY_B'];
      proxyApiKey = 'AG_KEY_A';
      rpmPerKey = 10;
      cancelRequested = false;
      translatorRpmTimestamps = {};
      setActiveTranslatorTemplateId('convert');
    `, context);

    const prompt = 'PROMPT_SENTINEL: translate every line and keep names.';
    const chunks = [
      'CHUNK_ONE_SENTINEL: Alice opened the bronze gate.',
      'CHUNK_TWO_SENTINEL: Bob crossed the frozen river.',
    ];

    for (let index = 0; index < chunks.length; index += 1) {
      await context.translateChunkWithRetry(
        context.buildPromptedChunk(prompt, chunks[index], 'en'),
        index,
        1
      );
    }

    expect(requestMessages).toHaveLength(2);
    expect(requestMessages[0][0]).toMatchObject({ role: 'system', content: expect.stringContaining('PROMPT_SENTINEL') });
    expect(requestMessages[0][1]).toMatchObject({ role: 'user', content: expect.stringContaining('CHUNK_ONE_SENTINEL') });
    expect(requestMessages[0][1].content).not.toContain('CHUNK_TWO_SENTINEL');
    expect(requestMessages[0][1].content).not.toContain('PROMPT_SENTINEL');
    expect(requestMessages[1][0]).toMatchObject({ role: 'system', content: expect.stringContaining('PROMPT_SENTINEL') });
    expect(requestMessages[1][1]).toMatchObject({ role: 'user', content: expect.stringContaining('CHUNK_TWO_SENTINEL') });
    expect(requestMessages[1][1].content).not.toContain('CHUNK_ONE_SENTINEL');
    expect(requestMessages[1][1].content).not.toContain('PROMPT_SENTINEL');
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

  it('spends a real Gemini Direct request for each short-output retry', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      const isFinalAttempt = requests.length === 5;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: isFinalAttempt
                  ? 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90)
                  : 'Ngắn.',
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
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'gemini-3.1-flash-lite', enabled: true }];
      cancelRequested = false;
      translatorRpmTimestamps = {};
      sleepDurations = [];
      sleep = async (ms) => { sleepDurations.push(ms); };
      document.getElementById('customPrompt').value = 'RETRY_PROMPT_SENTINEL\\n\\nVĂN BẢN CẦN BIÊN TẬP:';
    `, context);

    const result = await context.translateChunkWithRetry(
      context.buildPromptedChunk(
        'RETRY_PROMPT_SENTINEL\n\nVĂN BẢN CẦN BIÊN TẬP:',
        'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(5),
        'auto'
      ),
      0,
      5
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(requests).toHaveLength(5);
    expect(requests.every(({ body }) => body.contents[0].parts[0].text.includes('Đoạn nguồn cần dịch'))).toBe(true);
    expect(requests.every(({ body }) => !body.contents[0].parts[0].text.includes('VĂN BẢN CẦN BIÊN TẬP:'))).toBe(true);
    expect(requests.every(({ body }) => body.systemInstruction.parts[0].text.includes('RETRY_PROMPT_SENTINEL'))).toBe(true);
    expect(requests.every(({ body }) => !body.systemInstruction.parts[0].text.includes('VĂN BẢN CẦN BIÊN TẬP:'))).toBe(true);
    expect(requests.map(({ body }) => body.generationConfig.temperature)).toEqual([0.7, 0.9, 0.5, 1.0, 0.3]);
    expect(vm.runInContext('sleepDurations', context)).toEqual([500, 500, 500, 500]);
    expect(vm.runInContext(
      "getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0, 'main')",
      context
    )).toBe(1);
    expect(vm.runInContext(
      "getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0, 'retry')",
      context
    )).toBe(4);
  });

  it('spends a real Custom Proxy request for each short-output retry', async () => {
    const requests = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      const isFinalAttempt = requests.length === 5;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: isFinalAttempt
                ? 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90)
                : 'Ngắn.',
            },
          }],
        }),
      };
    });

    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
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
      rpmPerKey = 10;
      cancelRequested = false;
      translatorRpmTimestamps = {};
      sleepDurations = [];
      sleep = async (ms) => { sleepDurations.push(ms); };
    `, context);

    const result = await context.translateChunkWithRetry(
      'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
      0,
      5
    );

    expect(result).toContain('Bản dịch tiếng Việt hợp lệ');
    expect(requests).toHaveLength(5);
    expect(requests.map(({ body }) => body.temperature)).toEqual([0.7, 0.9, 0.5, 1.0, 0.3]);
    expect(vm.runInContext('sleepDurations', context)).toEqual([500, 500, 500, 500]);
    expect(vm.runInContext(
      "getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0, 'main')",
      context
    )).toBe(1);
    expect(vm.runInContext(
      "getTranslatorRpmRecentCountByKind(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0, 'retry')",
      context
    )).toBe(4);
  });

  it('sends a clean 20-request Gemini Direct wave across two keys', async () => {
    const usedKeys = [];
    const context = loadProxyRuntimeContext(async (url) => {
      usedKeys.push(new URL(String(url)).searchParams.get('key'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                text: 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(120),
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
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'gemini-3.1-flash-lite', enabled: true }];
      cancelRequested = false;
      translatorRpmTimestamps = {};
      modelKeyHealthMap = {};
    `, context);

    await Promise.all(Array.from({ length: 20 }, (_, chunkIndex) => (
      context.sendDirectTranslationAttempt({
        chunkIndex,
        text: 'Đoạn nguồn cần dịch sang tiếng Việt. '.repeat(20),
        kind: 'main',
      })
    )));

    expect(usedKeys).toHaveLength(20);
    expect(usedKeys.filter((key) => key === 'DIRECT_KEY_A')).toHaveLength(10);
    expect(usedKeys.filter((key) => key === 'DIRECT_KEY_B')).toHaveLength(10);
  });

  liveGeminiIt('live: sends 30 Gemini Direct requests and retries 20 after cooldown when needed', async () => {
    if (liveGeminiKeys[0] === liveGeminiKeys[1]) {
      throw new Error('Live Gemini rotation test requires two distinct API keys.');
    }

    const listModelsForKey = async (key) => {
      let response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      } catch {
        throw new Error('Could not reach Gemini ListModels during the live rotation test.');
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Gemini ListModels failed for a live test key with HTTP ${response.status}.`);
      }

      return (Array.isArray(payload.models) ? payload.models : [])
        .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
        .map((model) => String(model.name || '').replace(/^models\//, ''))
        .filter(Boolean);
    };

    const modelLists = await Promise.all(liveGeminiKeys.map(listModelsForKey));
    const targetModel = modelLists[0].find((model) => /^gemini-3\.5-flash-lite(?:$|-)/i.test(model));
    if (!targetModel) {
      throw new Error('The first live Gemini key does not expose a Gemini 3.5 Flash Lite generateContent model.');
    }

    const calls = [];
    let activeStage = 'wave-30';
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      const keyIndex = liveGeminiKeys.indexOf(requestUrl.searchParams.get('key'));
      const startedAt = Date.now();

      try {
        const response = await fetch(url, options);
        calls.push({
          stage: activeStage,
          key: keyIndex >= 0 ? `key-${keyIndex + 1}` : 'unknown-key',
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch {
        calls.push({
          stage: activeStage,
          key: keyIndex >= 0 ? `key-${keyIndex + 1}` : 'unknown-key',
          status: 'NETWORK_ERROR',
          durationMs: Date.now() - startedAt,
        });
        throw new Error('Gemini live generateContent request failed without a response.');
      }
    });

    context.liveGeminiKeys = liveGeminiKeys;
    context.liveGeminiModel = targetModel;
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = liveGeminiKeys;
      rpmPerKey = 15;
      GEMINI_MODELS = [{ name: liveGeminiModel, enabled: true }];
      cancelRequested = false;
      translatorRpmTimestamps = {};
      modelKeyHealthMap = {};
    `, context);
    context.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const runWave = (size) => Promise.allSettled(Array.from({ length: size }, (_, chunkIndex) => (
      context.sendDirectTranslationAttempt({
        chunkIndex,
        text: 'Chỉ trả lời đúng hai từ: Đã nhận.',
        kind: 'main',
        requestOptions: { skipValidation: true },
      })
    )));
    const getRpmCounts = () => JSON.parse(vm.runInContext(`JSON.stringify([
      getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0),
      getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 1),
    ])`, context));
    const summarizeStage = (stage, results) => {
      const stageCalls = calls.filter((call) => call.stage === stage);
      const summarizeKey = (key) => {
        const keyCalls = stageCalls.filter((call) => call.key === key);
        const statuses = {};
        keyCalls.forEach((call) => {
          statuses[call.status] = (statuses[call.status] || 0) + 1;
        });
        const durations = keyCalls.map((call) => call.durationMs);
        return {
          count: keyCalls.length,
          statuses,
          minMs: durations.length ? Math.min(...durations) : 0,
          maxMs: durations.length ? Math.max(...durations) : 0,
          avgMs: durations.length
            ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
            : 0,
        };
      };
      const resultCodes = {};
      results.forEach((result) => {
        const code = result.status === 'fulfilled'
          ? 'OK'
          : String(result.reason?.code || result.reason?.status || 'ERROR');
        resultCodes[code] = (resultCodes[code] || 0) + 1;
      });
      return {
        key1: summarizeKey('key-1'),
        key2: summarizeKey('key-2'),
        resultCodes,
        rpmCounts: getRpmCounts(),
      };
    };

    const wave30Results = await runWave(30);
    const wave30Summary = summarizeStage('wave-30', wave30Results);
    console.info('LIVE_GEMINI_WAVE_30_RESULT', JSON.stringify({
      model: targetModel,
      modelAvailableByKey: modelLists.map((models) => models.includes(targetModel)),
      ...wave30Summary,
    }));

    expect(wave30Summary.key1.count).toBe(15);
    expect(wave30Summary.key2.count).toBe(15);
    expect(wave30Summary.rpmCounts).toEqual([15, 15]);

    const wave30HasErrors = wave30Results.some((result) => result.status === 'rejected')
      || calls.some((call) => call.stage === 'wave-30' && call.status !== 200);
    if (!wave30HasErrors) return;

    const waitState = JSON.parse(vm.runInContext(`JSON.stringify({
      rpmWaits: [
        getTranslatorRpmWaitMsForKey(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0),
        getTranslatorRpmWaitMsForKey(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 1),
      ],
      cooldownWaits: [
        getModelKeyCooldownMs(liveGeminiModel, 0),
        getModelKeyCooldownMs(liveGeminiModel, 1),
      ],
    })`, context));
    const waitMs = Math.max(...waitState.rpmWaits, ...waitState.cooldownWaits, 0) + 2000;
    console.info('LIVE_GEMINI_WAIT_BEFORE_WAVE_20', JSON.stringify({
      waitMs,
      ...waitState,
    }));
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    activeStage = 'wave-20';
    const wave20Results = await runWave(20);
    const wave20Summary = summarizeStage('wave-20', wave20Results);
    console.info('LIVE_GEMINI_WAVE_20_RESULT', JSON.stringify(wave20Summary));

    expect(wave20Summary.key1.count).toBe(10);
    expect(wave20Summary.key2.count).toBe(10);
    expect(wave20Summary.rpmCounts).toEqual([10, 10]);
    expect(wave20Results.every((result) => result.status === 'fulfilled')).toBe(true);
  }, 180000);

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
