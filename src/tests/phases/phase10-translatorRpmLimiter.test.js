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
      const indices = Array.from({ length: ${count} }, (_, index) => index);
      const plan = getTranslatorRpmBatchPlan({ requestedParallel: ${count}, remainingChunks: ${count} });
      const assignments = buildTranslatorWaveAssignments(indices, plan);
      for (const assignment of assignments) {
        const keyIndex = assignment.keyIndex;
        recordTranslatorRpmRequest(activeTranslatorProvider, keyIndex, Date.now(), 'main');
        counts[keyIndex] = (counts[keyIndex] || 0) + 1;
      }
      return counts;
    })()
  `, context);
}

function recordProxyBatchSequence(context, count) {
  return vm.runInContext(`
    (() => {
      const indices = Array.from({ length: ${count} }, (_, index) => index);
      const plan = getTranslatorRpmBatchPlan({ requestedParallel: ${count}, remainingChunks: ${count} });
      const assignments = buildTranslatorWaveAssignments(indices, plan);
      const selected = assignments.map((assignment) => assignment.keyIndex);
      for (const assignment of assignments) {
        recordTranslatorRpmRequest(activeTranslatorProvider, assignment.keyIndex, Date.now(), 'main');
      }
      return selected;
    })()
  `, context);
}

function recordDirectBatchSequence(context, count) {
  return vm.runInContext(`
    (() => {
      const selected = Array.from({ length: ${count} }, () => getNextModelKeyPairWithQueue('main'));
      return selected.map((pair) => pair.keyIndex);
    })()
  `, context);
}

describe('phase10 translator RPM limiter', () => {
  it('waits for a full main wave instead of dispatching leftover RPM slots', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
      rpmPerKey = 5;
    `, context);

    const firstPlan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 20, remainingChunks: 80 })', context);
    expect(firstPlan.capacity).toBe(20);
    expect(firstPlan.keyAllocations).toEqual([4, 4, 4, 4, 4]);
    expect(recordProxyBatch(context, 20)).toEqual({ 0: 4, 1: 4, 2: 4, 3: 4, 4: 4 });

    const nextPlan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 20, remainingChunks: 60 })', context);
    expect(nextPlan.capacity).toBe(0);
    expect(nextPlan.remainingSlots).toBe(5);
    expect(nextPlan.waitMs).toBeGreaterThan(0);
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

  it('balances a main proxy wave across keys instead of filling one key first', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
      translatorRpmTimestamps = {};
      rpmPerKey = 5;
    `, context);

    expect(recordProxyBatchSequence(context, 20)).toEqual([
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
    ]);
  });

  it('uses preassigned proxy wave keys but lazy Gemini Direct key selection', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['PROXY_A', 'PROXY_B'];
      translatorRpmTimestamps = {};
      translatorChunkKeyAssignments = {};
      rpmPerKey = 10;
    `, context);

    expect(recordProxyBatchSequence(context, 20)).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ]);
    expect(vm.runInContext('Object.keys(translatorChunkKeyAssignments).length', context)).toBe(20);

    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_A', 'DIRECT_B'];
      GEMINI_MODELS = [{ name: 'gemini-3.1-flash-lite', enabled: true }];
      translatorRpmTimestamps = {};
      translatorChunkKeyAssignments = {};
      rpmPerKey = 10;
    `, context);

    expect(recordDirectBatchSequence(context, 20)).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ]);
    expect(vm.runInContext('Object.keys(translatorChunkKeyAssignments).length', context)).toBe(0);
    expect(vm.runInContext(`
      [
        getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0),
        getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 1),
      ]
    `, context)).toEqual([10, 10]);
  });

  it('reduces only the key-specific main wave share consumed by retry debt', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['KEY_A', 'KEY_B', 'KEY_C', 'KEY_D', 'KEY_E'];
      rpmPerKey = 5;
    `, context);

    vm.runInContext(`
      recordTranslatorRpmRequest(activeTranslatorProvider, 0, Date.now(), 'retry');
      recordTranslatorRpmRequest(activeTranslatorProvider, 1, Date.now(), 'retry');
    `, context);
    const oneRetryEach = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 20, remainingChunks: 60 })', context);
    expect(oneRetryEach.capacity).toBe(20);
    expect(oneRetryEach.keyAllocations).toEqual([4, 4, 4, 4, 4]);

    vm.runInContext(`
      translatorRpmTimestamps = {};
      recordTranslatorRpmRequest(activeTranslatorProvider, 0, Date.now(), 'retry');
      recordTranslatorRpmRequest(activeTranslatorProvider, 0, Date.now(), 'retry');
    `, context);
    const twoRetriesOnA = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 20, remainingChunks: 60 })', context);
    expect(twoRetriesOnA.capacity).toBe(19);
    expect(twoRetriesOnA.keyAllocations).toEqual([3, 4, 4, 4, 4]);
    expect(twoRetriesOnA.retryDebtReduced).toBe(true);
  });

  it('records Custom Proxy RPM only after a real request is ready to be sent', async () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
      customProxyApiKeys = ['CUSTOM_KEY'];
      customProxyProfile = { ...DEFAULT_CUSTOM_PROXY_PROFILE, baseUrl: 'https://proxy.test', defaultModel: '' };
      rpmPerKey = 5;
      translateChunkViaProxy = async () => 'translated';
    `, context);

    await expect(
      vm.runInContext("sendProxyTranslationAttempt({ chunkIndex: 0, text: 'source', temperature: 0.7, kind: 'manual_retry' })", context)
    ).rejects.toMatchObject({ code: 'MISSING_PROXY_MODEL' });
    expect(vm.runInContext('getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0)', context)).toBe(0);

    const sent = await vm.runInContext(`
      customProxyProfile.defaultModel = 'custom-model';
      sendProxyTranslationAttempt({ chunkIndex: 0, text: 'source', temperature: 0.7, kind: 'manual_retry' })
    `, context);
    expect(sent).toEqual(expect.objectContaining({ result: 'translated', keyIndex: 0 }));
    expect(vm.runInContext('getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.CUSTOM_PROXY, 0)', context)).toBe(1);
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

  it('limits Gemini Direct only by the shared per-key RPM setting', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'model-low-rpm', quota: 5, rpd: 1500, enabled: true }];
    `, context);

    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 50 }).capacity', context)).toBe(10);
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

  it('ignores legacy model RPD counters when planning Gemini Direct work', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'model-rpd-full', quota: 10, rpd: 1, enabled: true }];
    `, context);

    expect(vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 1 }).capacity', context)).toBe(1);
  });

  it('keeps Gemini Direct cooldown handling outside the shared RPM batch plan', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 10;
      GEMINI_MODELS = [{ name: 'model-long-cooldown', quota: 10, rpd: 1500, enabled: true }];
      recordModelKeyError('model-long-cooldown', 0, 3500);
    `, context);

    const plan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 1 })', context);

    expect(plan.capacity).toBe(1);
    expect(plan.waitMs).toBe(0);
    expect(plan.remainingSlots).toBe(10);
  });

  it('keeps pure RPM waits bounded to the local RPM window', () => {
    const context = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_KEY'];
      rpmPerKey = 1;
      recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0);
    `, context);

    const plan = vm.runInContext('getTranslatorRpmBatchPlan({ requestedParallel: 1 })', context);

    expect(plan.capacity).toBe(0);
    expect(plan.waitMs).toBeLessThanOrEqual(65000);
  });

  it('renders RPM controls instead of the legacy delay control', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');

    expect(html).toContain('id="rpmPerKey"');
    expect(html).toContain('RPM mỗi API key');
    expect(html).toContain('max="50"');
    expect(html).not.toContain('Delay giữa các batch');
  });
});
