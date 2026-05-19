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
    const usedAuthHeaders = [];
    const context = loadProxyRuntimeContext(async (url, options = {}) => {
      const authorization = String(options.headers?.Authorization || '');
      usedAuthHeaders.push(authorization);

      if (authorization === 'Bearer KEY7') {
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
    expect(usedAuthHeaders).toEqual(['Bearer KEY7', 'Bearer KEY8']);
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

  it('does not reuse a proxy key while every key is still cooling down', () => {
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

    expect(() => context.getProxyKeyForChunk(0)).toThrow(/cooldown|tạm dừng/i);
  });

  it('fetches Custom Proxy Gemini models from the openai_proxy key pool without changing AG config', async () => {
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
    expect(models).toEqual(['google/gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(vm.runInContext('proxyModel', context)).toBe('ag-model');
    expect(vm.runInContext('proxyApiKeys', context)).toEqual(['AG_KEY']);
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('google/gemini-2.5-pro');
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
  });
});
