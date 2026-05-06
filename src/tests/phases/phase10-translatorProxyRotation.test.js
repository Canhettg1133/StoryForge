import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadProxyRuntimeContext(fetchImpl) {
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
      querySelector() {
        return fakeElement;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    showToast() {},
    sleep: async () => {},
    fetch: fetchImpl,
  };

  vm.createContext(context);

  [
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/gemini/api.js',
    'public/translator-runtime/js/translation/retry.js',
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
});
