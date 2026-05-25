import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadRuntime() {
  const context = {
    Date,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    showToast() {},
  };

  vm.createContext(context);
  [
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/gemini/rpd-tracker.js',
    'public/translator-runtime/js/gemini/model-rotation.js',
    'public/translator-runtime/js/translation/engine.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });

  return context;
}

function recordProxyBatch(context, count) {
  return vm.runInContext(`
    (() => {
      const counts = {};
      for (let index = 0; index < ${count}; index += 1) {
        const key = getProxyKeyForChunk(index);
        const keyIndex = getProxyKeyIndex(key);
        recordTranslatorRpmRequest(activeTranslatorProvider, keyIndex);
        counts[keyIndex] = (counts[keyIndex] || 0) + 1;
      }
      return counts;
    })()
  `, context);
}

function recordProxyBatchSequence(context, count) {
  return vm.runInContext(`
    (() => {
      const selected = [];
      for (let index = 0; index < ${count}; index += 1) {
        const key = getProxyKeyForChunk(index);
        const keyIndex = getProxyKeyIndex(key);
        recordTranslatorRpmRequest(activeTranslatorProvider, keyIndex);
        selected.push(keyIndex);
      }
      return selected;
    })()
  `, context);
}

describe('phase10 translator RPM limiter', () => {
  it('uses the remaining per-key RPM slots to size each proxy batch', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B'];
      rpmPerKey = 10;
    `, context);

    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 16 }).capacity', context)).toBe(16);
    expect(recordProxyBatch(context, 16)).toEqual({ 0: 10, 1: 6 });
    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 16 }).capacity', context)).toBe(4);
  });

  it('caps a proxy batch at key count times RPM and waits when every key is full', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B'];
      rpmPerKey = 10;
    `, context);

    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 30 }).capacity', context)).toBe(20);
    expect(recordProxyBatch(context, 20)).toEqual({ 0: 10, 1: 10 });

    const exhausted = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 30 })', context);
    expect(exhausted.capacity).toBe(0);
    expect(exhausted.waitMs).toBeGreaterThan(0);
  });

  it('uses the same per-key RPM fanout for AG Proxy and Custom Proxy', () => {
    const context = loadRuntime();

    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['AG_A', 'AG_B', 'AG_C', 'AG_D', 'AG_E'];
      customProxyApiKeys = [];
      translatorRpmTimestamps = {};
      rpmPerKey = 5;
    `, context);
    const agPlan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 25 })', context);
    const agFanout = recordProxyBatch(context, agPlan.capacity);

    vm.runInContext(`
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      proxyApiKeys = [];
      customProxyApiKeys = ['CU_A', 'CU_B', 'CU_C', 'CU_D', 'CU_E'];
      translatorRpmTimestamps = {};
      rpmPerKey = 5;
    `, context);
    const customPlan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 25 })', context);
    const customFanout = recordProxyBatch(context, customPlan.capacity);

    expect(agPlan.capacity).toBe(25);
    expect(customPlan.capacity).toBe(25);
    expect(agFanout).toEqual({ 0: 5, 1: 5, 2: 5, 3: 5, 4: 5 });
    expect(customFanout).toEqual(agFanout);
  });

  it('fills each proxy key RPM slice before moving to the next key', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
      translatorRpmTimestamps = {};
      rpmPerKey = 5;
    `, context);

    expect(recordProxyBatchSequence(context, 25)).toEqual([
      0, 0, 0, 0, 0,
      1, 1, 1, 1, 1,
      2, 2, 2, 2, 2,
      3, 3, 3, 3, 3,
      4, 4, 4, 4, 4,
    ]);
  });

  it('dispatches grouped proxy key slices in an interleaved order across keys', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
      rpmPerKey = 5;
    `, context);

    expect(vm.runInContext('orderProxyBatchIndicesForDispatch(Array.from({ length: 25 }, (_, index) => index))', context)).toEqual([
      0, 5, 10, 15, 20,
      1, 6, 11, 16, 21,
      2, 7, 12, 17, 22,
      3, 8, 13, 18, 23,
      4, 9, 14, 19, 24,
    ]);
  });

  it('keeps AG Proxy and Custom Proxy RPM buckets separate', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['AG_KEY'];
      customProxyApiKeys = ['CUSTOM_KEY'];
      rpmPerKey = 2;
    `, context);

    expect(recordProxyBatch(context, 2)).toEqual({ 0: 2 });
    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 2 }).capacity', context)).toBe(0);

    vm.runInContext('activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;', context);
    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 2 }).capacity', context)).toBe(2);
  });

  it('applies a single shared RPM bucket to Ollama while keeping it sequential', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useOllama = true;
      useProxy = false;
      rpmPerKey = 10;
    `, context);

    const plan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 50 })', context);
    expect(plan.capacity).toBe(1);
    expect(vm.runInContext('resolveEffectiveTranslationParallel({ requestedParallel: 50, useOllamaMode: true })', context)).toBe(1);
  });

  it('starts approved cloud batches without per-request staggering', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
    `, context);

    expect(vm.runInContext('resolveRuntimeParallel(25)', context)).toEqual({
      effectiveParallel: 25,
      staggerDelayMs: 0,
    });

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_A', 'DIRECT_B', 'DIRECT_C', 'DIRECT_D', 'DIRECT_E'];
    `, context);

    expect(vm.runInContext('resolveRuntimeParallel(25)', context)).toEqual({
      effectiveParallel: 25,
      staggerDelayMs: 0,
    });
  });

  it('limits Gemini Direct by both per-key RPM and model RPM', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'model-low-rpm', quota: 5, rpd: 1500, enabled: true }];
    `, context);

    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 50 }).capacity', context)).toBe(5);
  });

  it('does not let one Gemini Direct key exceed the user RPM across multiple models', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 1;
      GEMINI_MODELS = [
        { name: 'model-a', quota: 10, rpd: 1500, enabled: true },
        { name: 'model-b', quota: 10, rpd: 1500, enabled: true },
      ];
      const first = getNextModelKeyPairWithQueue();
    `, context);

    expect(() => vm.runInContext('getNextModelKeyPairWithQueue()', context)).toThrow(/quota|RPM|hồi lại/i);
  });

  it('does not spin-wait when Gemini Direct is blocked by RPD instead of RPM', async () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'model-rpd-full', quota: 10, rpd: 1, enabled: true }];
      rpdData = {
        date: getPacificDateString(),
        pairs: {
          'model-rpd-full|0': { used: 1, limit: 1 },
        },
      };
    `, context);

    await expect(
      vm.runInContext('waitForTranslatorRpmBatchPlan({ requestedParallel: 1 })', context)
    ).rejects.toThrow(/Hết RPD/i);
  });

  it('renders RPM controls instead of the legacy delay control', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');

    expect(html).toContain('id="rpmPerKey"');
    expect(html).toContain('RPM mỗi API key');
    expect(html).toContain('max="50"');
    expect(html).not.toContain('Delay giữa các batch');
  });
});
