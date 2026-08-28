import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const runtimeRoot = path.join(process.cwd(), 'public/translator-runtime');
const fakeKeys = Array.from({ length: 6 }, (_, index) => `FAKE-DIAGNOSTIC-KEY-${index + 1}`);
const translatedText = 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(120);
const runtimes = [];

const successResponse = (text = translatedText) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
  }),
});

const quotaResponse = () => ({
  ok: false,
  status: 429,
  json: async () => ({
    error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded. Please retry in 60s.' },
  }),
});

// Drain bounded promise continuations, without real waits or live API requests.
async function flushRequests() {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}

function histogram(indices) {
  return indices.reduce((counts, keyIndex) => {
    counts[keyIndex] += 1;
    return counts;
  }, new Array(6).fill(0));
}

function loadRuntime() {
  let now = Date.UTC(2026, 7, 28);
  class RuntimeDate extends Date {
    static now() { return now; }
  }

  const requests = [];
  const sleeps = [];
  const retries = [];
  const jobs = [];
  const context = vm.createContext({
    Date: RuntimeDate,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    showToast() {},
    trackChunkRetry: (chunkIndex, attempt) => retries.push({ chunkIndex, attempt }),
    sleep: (ms) => ms < 1000 ? Promise.resolve() : new Promise((resolve) => {
      sleeps.push({ ms, resolve });
    }),
    fetch: (url, options) => new Promise((resolve) => {
      const requestUrl = new URL(url);
      const keyIndex = fakeKeys.indexOf(requestUrl.searchParams.get('key'));
      if (requestUrl.hostname !== 'generativelanguage.googleapis.com' || keyIndex < 0) {
        throw new Error('Unexpected diagnostic request');
      }
      const body = JSON.parse(options.body);
      const chunkIndex = Number(body.contents[0].parts[0].text.match(/TEST_CHUNK_(\d+)/)[1]);
      const request = {
        chunkIndex,
        keyIndex,
        pending: true,
        respond(response = successResponse()) {
          if (!request.pending) return;
          request.pending = false;
          resolve(response);
        },
      };
      requests.push(request);
    }),
  });

  // Keep selection, RPM reservation, retries, validation, HTTP parsing and journal real.
  for (const file of [
    'js/app.js',
    'js/translation/request-contract.js',
    'js/translation/errors.js',
    'js/gemini/model-rotation.js',
    'js/gemini/api.js',
    'js/translation/retry.js',
    'js/features/chunk-key-usage/state.js',
    'js/features/chunk-key-usage/view.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(runtimeRoot, file), 'utf8'), context, { filename: file });
  }
  vm.runInContext(`
    useProxy = false;
    useOllama = false;
    apiKeys = ${JSON.stringify(fakeKeys)};
    GEMINI_MODELS = [{ name: 'gemini-diagnostic-model', enabled: true }];
    rpmPerKey = 10;
    cancelRequested = false;
    currentTranslatorSessionId = 'distribution-diagnostic';
  `, context);

  const runtime = {
    context, requests, sleeps, retries,
    startWave(startIndex = 0) {
      const plan = context.getTranslatorRpmBatchPlan({ requestedParallel: 30, remainingChunks: 30 });
      expect(plan.capacity).toBe(30);
      const wave = Array.from({ length: plan.capacity }, (_, offset) => {
        const chunkIndex = startIndex + offset;
        return context.translateChunkWithRetry({
          systemText: 'Translate the source into Vietnamese.',
          userText: `TEST_CHUNK_${chunkIndex}\n${'她望着远方，缓缓打开房门。'.repeat(400)}`,
          sourceText: '她望着远方，缓缓打开房门。'.repeat(400),
        }, chunkIndex, 3);
      });
      const settled = Promise.allSettled(wave);
      jobs.push(settled);
      return settled;
    },
    rpmCounts() {
      return vm.runInContext('apiKeys.map((_, index) => getTranslatorRpmRecentCount(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, index))', context);
    },
    latestCounts() {
      return histogram(Array.from({ length: 30 }, (_, chunkIndex) => (
        context.getTranslatorChunkKeyUsage(chunkIndex).attempts.at(-1).keyIndex
      )));
    },
    async finish(wave) {
      requests.forEach((request) => request.respond());
      const results = await wave;
      expect(results).toHaveLength(30);
      results.forEach((result) => expect(result).toMatchObject({ status: 'fulfilled', value: translatedText.trim() }));
    },
    advance(ms) {
      now += ms;
      sleeps.splice(0).forEach(({ resolve }) => resolve());
    },
    async cleanup() {
      vm.runInContext('cancelRequested = true;', context);
      requests.forEach((request) => request.respond());
      sleeps.splice(0).forEach(({ resolve }) => resolve());
      await Promise.all(jobs);
    },
  };
  runtimes.push(runtime);
  return runtime;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.cleanup();
});

describe('Gemini Direct: 30 parallel chunks, six keys, 10 RPM per key', () => {
  it('dispatches five initial requests per healthy key before any response returns', async () => {
    const runtime = loadRuntime();
    const wave = runtime.startWave();
    await flushRequests();

    expect(runtime.requests).toHaveLength(30);
    expect(runtime.requests.every((request) => request.pending)).toBe(true);
    expect(runtime.requests.map((request) => request.keyIndex)).toEqual(
      Array.from({ length: 30 }, (_, index) => index % 6),
    );
    expect(runtime.rpmCounts()).toEqual([5, 5, 5, 5, 5, 5]);
    expect(runtime.latestCounts()).toEqual([5, 5, 5, 5, 5, 5]);

    [...runtime.requests].reverse().forEach((request) => request.respond());
    await runtime.finish(wave);
    for (let index = 0; index < 30; index += 1) {
      expect(runtime.context.getTranslatorChunkKeyUsage(index).attempts).toMatchObject([
        { keyIndex: index % 6, kind: 'main', status: 'responded' },
      ]);
    }
  });

  it.each([
    ['HTTP 429', quotaResponse, 62000],
    ['HTTP 200 with output too short', () => successResponse('Ngắn.'), 0],
  ])('changes the latest label after %s without changing the balanced first dispatch', async (_, failedResponse, cooldown) => {
    const runtime = loadRuntime();
    const wave = runtime.startWave();
    await flushRequests();
    const firstDispatch = runtime.requests.slice();
    runtime.requests[10].respond(failedResponse()); // Chunk 11 initially used Key 5.
    await flushRequests();

    expect(histogram(firstDispatch.map((request) => request.keyIndex))).toEqual([5, 5, 5, 5, 5, 5]);
    expect(runtime.requests).toHaveLength(31);
    expect(runtime.requests[30]).toMatchObject({ chunkIndex: 10, keyIndex: 0, pending: true });
    expect(runtime.context.getTranslatorChunkKeyBadge(10).label).toBe('Key 1');
    expect(runtime.context.getTranslatorChunkKeyUsage(10).attempts).toMatchObject([
      { keyIndex: 4, kind: 'main', status: 'failed' },
      { keyIndex: 0, kind: 'retry', status: 'pending' },
    ]);
    expect(runtime.rpmCounts()).toEqual([6, 5, 5, 5, 5, 5]);
    expect(runtime.latestCounts()).toEqual([6, 5, 5, 5, 4, 5]);
    expect(runtime.context.getModelKeyCooldownMs('gemini-diagnostic-model', 4)).toBe(cooldown);
    await runtime.finish(wave);
  });

  it('can route five retries to Key 4 when the other five keys are cooling down', async () => {
    const runtime = loadRuntime();
    const wave = runtime.startWave();
    await flushRequests();
    [0, 1, 2, 4, 5].forEach((index) => runtime.requests[index].respond(quotaResponse()));
    await flushRequests();

    expect(runtime.requests).toHaveLength(35);
    expect(runtime.requests.slice(30).map((request) => request.keyIndex)).toEqual([3, 3, 3, 3, 3]);
    expect(runtime.rpmCounts()).toEqual([5, 5, 5, 10, 5, 5]);
    expect(runtime.latestCounts()).toEqual([4, 4, 4, 10, 4, 4]);
    expect(runtime.context.getModelKeyCooldownMs('gemini-diagnostic-model', 3)).toBe(0);
    await runtime.finish(wave);
  });

  it('balances recent RPM usage rather than forcing an equal share in every new wave', async () => {
    const runtime = loadRuntime();
    // Five earlier requests still count in this rolling minute.
    vm.runInContext(`
      for (let index = 0; index < 5; index += 1) {
        recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0, Date.now(), 'retry');
      }
    `, runtime.context);
    const wave = runtime.startWave();
    await flushRequests();

    expect(runtime.requests).toHaveLength(30);
    expect(histogram(runtime.requests.map((request) => request.keyIndex))).toEqual([1, 6, 6, 6, 6, 5]);
    expect(runtime.rpmCounts()).toEqual([6, 6, 6, 6, 6, 5]);
    await runtime.finish(wave);
  });

  it('keeps the previous actual key label while a retry waits for RPM, then updates on dispatch', async () => {
    const runtime = loadRuntime();
    const firstWave = runtime.startWave();
    await flushRequests();
    await runtime.finish(firstWave);
    const secondWave = runtime.startWave(30);
    await flushRequests();
    expect(runtime.requests).toHaveLength(60);
    expect(runtime.rpmCounts()).toEqual([10, 10, 10, 10, 10, 10]);

    runtime.requests[40].respond(quotaResponse()); // Chunk 41, Key 5.
    await flushRequests();
    expect(runtime.retries).toContainEqual({ chunkIndex: 40, attempt: 1 });
    expect(runtime.requests).toHaveLength(60); // No 61st request in this minute.
    expect(runtime.sleeps.map(({ ms }) => ms)).toEqual([62000]);
    expect(runtime.context.getTranslatorChunkKeyBadge(40).label).toBe('Key 5');
    expect(runtime.context.getTranslatorChunkKeyUsage(40).attempts).toHaveLength(1);

    // The existing local RPM window is 65 seconds; the 429 cooldown ends at 62.
    runtime.advance(62000);
    await flushRequests();
    expect(runtime.requests).toHaveLength(60);
    expect(runtime.sleeps.map(({ ms }) => ms)).toEqual([3000]);
    expect(runtime.context.getTranslatorChunkKeyBadge(40).label).toBe('Key 5');

    runtime.advance(3000);
    await flushRequests();
    expect(runtime.requests).toHaveLength(61);
    expect(runtime.requests[60]).toMatchObject({ chunkIndex: 40, keyIndex: 0 });
    expect(runtime.context.getTranslatorChunkKeyBadge(40).label).toBe('Key 1');
    expect(runtime.rpmCounts()).toEqual([1, 0, 0, 0, 0, 0]);
    await runtime.finish(secondWave);
  });
});
