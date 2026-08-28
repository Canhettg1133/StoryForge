// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const runtimeRoot = path.join(process.cwd(), 'public/translator-runtime');
const model = 'gemini-3.5-flash-lite';
const liveEnabled = process.env.STORYFORGE_GEMINI_DIAG_LIVE === '1';
const pacedLiveEnabled = process.env.STORYFORGE_GEMINI_DIAG_PACED_LIVE === '1';
const keyWavesLiveEnabled = process.env.STORYFORGE_GEMINI_DIAG_KEY_WAVES_LIVE === '1';
const fivePerSecondLiveEnabled = process.env.STORYFORGE_GEMINI_DIAG_FIVE_PER_SECOND_LIVE === '1';
const sixKeyBurstsLiveEnabled = process.env.STORYFORGE_GEMINI_DIAG_SIX_KEY_BURSTS_LIVE === '1';
const sixKeyBurstSize = Number.parseInt(process.env.STORYFORGE_GEMINI_DIAG_SIX_KEY_BURST_SIZE || '10', 10);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redact(value, keys = []) {
  let text = String(value ?? '');
  for (const key of keys) text = text.replaceAll(key, '[REDACTED]');
  return text.replace(/AIza[\w-]+/g, '[REDACTED]').replace(/([?&]key=)[^&\s]+/g, '$1[REDACTED]');
}

function readLiveKeys() {
  let keys;
  try {
    keys = JSON.parse(process.env.STORYFORGE_GEMINI_DIAG_KEYS || '[]');
  } catch {
    throw new Error('Invalid diagnostic key input; values are intentionally not logged.');
  }
  if (!Array.isArray(keys)) throw new Error('Provide six diagnostic keys via the environment.');
  keys = keys.map((key) => String(key).replace(/\\+(?=_)/g, '').trim());
  if (keys.length !== 6 || new Set(keys).size !== 6 || keys.some((key) => !/^AIza[\w-]{35}$/.test(key))) {
    throw new Error('Expected six distinct, correctly formatted Gemini keys; values are not logged.');
  }
  return keys;
}

function createRuntime(keys, transport, stage, emit = () => {}, requestBudget = 30, rpmLimit = 10) {
  const calls = [];
  const requestScope = new AsyncLocalStorage();
  const deadline = new AbortController();
  const startedAt = Date.now();
  let inFlight = 0;
  let peakInFlight = 0;
  const context = vm.createContext({
    Date, URL, AbortController, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    sleep: delay,
    fetch: async (url, options) => {
      const parsed = new URL(url);
      const keyIndex = keys.indexOf(parsed.searchParams.get('key'));
      if (parsed.origin !== 'https://generativelanguage.googleapis.com'
        || parsed.pathname !== `/v1beta/models/${model}:generateContent`
        || keyIndex < 0 || calls.length >= requestBudget) {
        throw new Error('Diagnostic request target or request budget rejected.');
      }
      const scope = requestScope.getStore();
      const body = JSON.parse(options.body);
      const call = {
        stage, chunk: scope.chunkIndex + 1, key: keyIndex + 1,
        startedAt: Date.now(), inputChars: scope.inputChars,
        payloadHash: createHash('sha256').update(options.body).digest('hex').slice(0, 16),
        temperature: body.generationConfig.temperature,
        thinking: body.generationConfig.thinkingConfig,
      };
      calls.push(call);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        inFlight -= 1;
        call.durationMs = Date.now() - call.startedAt;
        emit({ type: 'request', ...call, atMs: call.startedAt - startedAt, startedAt: undefined });
      };
      try {
        const response = await transport(url, {
          ...options,
          signal: AbortSignal.any([options.signal, deadline.signal]),
          // The production URL is a fixed Google endpoint; do not leak keys via redirects.
          redirect: 'error',
        });
        call.http = response.status;
        call.headersMs = Date.now() - call.startedAt;
        call.retryAfter = response.headers?.get?.('retry-after') || null;
        return {
          ok: response.ok,
          status: response.status,
          json: async () => {
            try {
              const data = await response.json();
              call.finishReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || null;
              call.blockReason = data.promptFeedback?.blockReason || null;
              call.parts = (data.candidates?.[0]?.content?.parts || []).map((part) => ({
                thought: Boolean(part.thought), chars: part.text?.length || 0,
              }));
              call.outputChars = data.candidates?.[0]?.content?.parts?.[0]?.text?.length || 0;
              call.usage = data.usageMetadata;
              if (data.error) call.googleError = JSON.parse(redact(JSON.stringify(data.error), keys));
              return data;
            } catch (error) {
              call.bodyError = redact(error.message, keys);
              throw new Error(call.bodyError);
            } finally {
              finish();
            }
          },
        };
      } catch (error) {
        call.http = 'NETWORK_ERROR';
        call.networkError = redact(error.message, keys);
        call.networkCode = error.cause?.code || error.code || null;
        finish();
        const safeError = new Error(call.networkError);
        safeError.name = error.name;
        throw safeError;
      }
    },
  });
  for (const file of [
    'js/app.js', 'js/translation/request-contract.js', 'js/translation/errors.js',
    'js/gemini/model-rotation.js', 'js/gemini/api.js', 'js/translation/retry.js',
    'js/translation/chunker.js', 'js/translation/engine.js',
    'js/features/chunk-key-usage/state.js', 'js/features/chunk-key-usage/view.js',
  ]) vm.runInContext(fs.readFileSync(path.join(runtimeRoot, file), 'utf8'), context, { filename: file });
  context.diagnosticKeys = keys;
  context.diagnosticModel = model;
  context.diagnosticRpmLimit = rpmLimit;
  vm.runInContext(`
    apiKeys = diagnosticKeys;
    GEMINI_MODELS = [{ name: diagnosticModel, enabled: true }];
    useProxy = false; useOllama = false;
    rpmPerKey = diagnosticRpmLimit;
    currentTranslatorSessionId = 'live-diagnostic';
    cancelRequested = false;
  `, context);

  return {
    context, calls,
    async run(chunks, {
      dispatchIntervalMs = 0,
      dispatchDelayMsForChunk = null,
      keyIndexForChunk = null,
    } = {}) {
      const parallel = context.resolveRuntimeParallel(chunks.length);
      const plan = context.getTranslatorRpmBatchPlan({ requestedParallel: parallel.effectiveParallel, remainingChunks: chunks.length });
      expect(plan.capacity).toBe(Math.min(chunks.length, parallel.effectiveParallel));
      expect(parallel.staggerDelayMs).toBe(0);
      const prompt = vm.runInContext('PROMPT_TEMPLATES.convert', context);
      const guard = setTimeout(() => {
        vm.runInContext('cancelRequested = true;', context);
        context.abortActiveTranslationRequests('diagnostic-deadline');
        deadline.abort();
      }, 150000);
      const progress = setInterval(() => emit({ type: 'progress', stage, requests: calls.length, inFlight }), 20000);
      try {
        const results = await Promise.all(chunks.map((source, chunkIndex) => requestScope.run(
          { chunkIndex, inputChars: source.length },
          async () => {
            try {
              const dispatchDelayMs = typeof dispatchDelayMsForChunk === 'function'
                ? Number(dispatchDelayMsForChunk(chunkIndex)) || 0
                : chunkIndex * dispatchIntervalMs;
              if (dispatchDelayMs > 0) await delay(dispatchDelayMs);
              // One attempt isolates the error that would cause retry; keep validation enabled.
              const request = context.buildPromptedChunk(prompt, source, 'auto');
              const forcedKeyIndex = typeof keyIndexForChunk === 'function'
                ? Number(keyIndexForChunk(chunkIndex))
                : null;
              let output;
              if (Number.isInteger(forcedKeyIndex) && forcedKeyIndex >= 0 && forcedKeyIndex < keys.length) {
                const modelKeyPair = { model, keyIndex: forcedKeyIndex, key: keys[forcedKeyIndex] };
                context.recordTranslatorRpmRequest('gemini_direct', forcedKeyIndex, Date.now(), 'main');
                try {
                  output = await context.translateChunk(request, modelKeyPair, 0.7, {
                    chunkKeyUsage: { chunkIndex, kind: 'main' },
                  });
                  context.recordKeySuccess(forcedKeyIndex);
                } catch (error) {
                  context.recordDirectAttemptFailure(error, modelKeyPair);
                  if (error && typeof error === 'object') error.modelKeyPairUsed = modelKeyPair;
                  throw error;
                }
              } else {
                output = await context.translateChunkWithRetry(request, chunkIndex, 1);
              }
              return { chunk: chunkIndex + 1, code: typeof output === 'string' ? 'OK' : 'UNDEFINED_OUTPUT', outputChars: output?.length || 0 };
            } catch (error) {
              return { chunk: chunkIndex + 1, code: error.code || 'ERROR', message: redact(error.rawMessage || error.message, keys) };
            }
          },
        )));
        const byKey = keys.map((_, index) => {
          const selected = calls.filter((call) => call.key === index + 1);
          return {
            key: index + 1, requests: selected.length,
            http: selected.reduce((counts, call) => ({ ...counts, [call.http]: (counts[call.http] || 0) + 1 }), {}),
            maxIn60s: selected.reduce((max, call) => Math.max(max, selected.filter((other) => (
              other.startedAt >= call.startedAt && other.startedAt < call.startedAt + 60000
            )).length), 0),
          };
        });
        const summary = {
          type: 'summary', stage, model, peakInFlight,
          durationMs: Date.now() - startedAt,
          resultCodes: results.reduce((counts, result) => ({ ...counts, [result.code]: (counts[result.code] || 0) + 1 }), {}),
          byKey, failed: results.filter((result) => result.code !== 'OK'),
        };
        emit(summary);
        return summary;
      } finally {
        clearTimeout(guard);
        clearInterval(progress);
        requestScope.disable();
      }
    },
  };
}

function sourceChunks(context) {
  const text = fs.readFileSync(path.join(process.cwd(), 'src/tests/fixtures/corpus/so-18-test.txt'), 'utf8');
  return context.splitTextIntoChunks(text, 5000).filter((chunk) => chunk.length > 4000).slice(0, 10);
}

describe('Gemini live diagnosis safety and runtime harness', () => {
  it('redacts credentials from both API URLs and error text', () => {
    const fake = `AIza${'x'.repeat(35)}`;
    expect(redact(`https://example.test?key=${fake} ${fake}`, [fake])).not.toContain(fake);
    expect(redact(`https://example.test?key=another-secret`)).not.toContain('another-secret');
  });

  it('uses the real story chunker, prompt, six-key selector, HTTP parsing and validation', async () => {
    const keys = Array.from({ length: 6 }, (_, index) => `FAKE-KEY-${index}`);
    const runtime = createRuntime(keys, async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Bản dịch tiếng Việt hợp lệ. '.repeat(200) }] } }] }),
    }), 'offline');
    const chunks = sourceChunks(runtime.context);
    expect(chunks).toHaveLength(10);
    const summary = await runtime.run(Array.from({ length: 30 }, (_, index) => chunks[index % chunks.length]));
    expect(summary.resultCodes).toEqual({ OK: 30 });
    expect(summary.byKey.map((key) => key.requests)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(summary.peakInFlight).toBe(30);
  });

  (liveEnabled ? it : it.skip)('compares one-key/10-parallel and six-key/30-parallel story translation against Google', async () => {
    const keys = readLiveKeys();
    const emit = (event) => console.info('GEMINI_DIAG', redact(JSON.stringify(event), keys));
    const single = createRuntime(keys.slice(0, 1), globalThis.fetch, 'single-key-10', emit);
    const chunks = sourceChunks(single.context);
    expect(chunks).toHaveLength(10);
    emit({ type: 'setup', model, source: 'so-18-test fixture', inputChars: chunks.map((chunk) => chunk.length), rpm: 10, maxGenerationRequests: 40 });
    const singleResult = await single.run(chunks);

    // Separate rolling RPM windows; do not reset a counter and immediately reuse quota.
    const waitMs = Math.max(0, Math.max(...single.calls.map((call) => call.startedAt)) + 67000 - Date.now());
    emit({ type: 'wait', ms: waitMs });
    for (let remaining = waitMs; remaining > 0; remaining -= 10000) await delay(Math.min(remaining, 10000));

    const multiple = createRuntime(keys, globalThis.fetch, 'six-keys-30', emit);
    // Repeat the same ten passages so the A/B comparison does not introduce new content.
    const multiResult = await multiple.run(Array.from({ length: 30 }, (_, index) => chunks[index % chunks.length]));
    emit({ type: 'comparison', single: singleResult.resultCodes, multiple: multiResult.resultCodes });
    expect(single.calls).toHaveLength(10);
    expect(multiple.calls).toHaveLength(30);
    expect(multiResult.byKey.map((key) => key.requests)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(singleResult.resultCodes).toEqual({ OK: 10 });
    expect(multiResult.resultCodes).toEqual({ OK: 30 });
  }, 400000);

  (pacedLiveEnabled ? it : it.skip)('paces six keys at their configured aggregate rate instead of bursting 30 requests', async () => {
    const keys = readLiveKeys();
    const emit = (event) => console.info('GEMINI_DIAG', redact(JSON.stringify(event), keys));
    const runtime = createRuntime(keys, globalThis.fetch, 'six-keys-30-paced', emit);
    const chunks = sourceChunks(runtime.context);
    expect(chunks).toHaveLength(10);
    const dispatchIntervalMs = 1000; // Six keys × 10 RPM = one aggregate dispatch per second.
    emit({
      type: 'paced_setup', model, rpmPerKey: 10, keyCount: 6, jobs: 30,
      requestedParallel: 30, dispatchIntervalMs,
    });
    const result = await runtime.run(
      Array.from({ length: 30 }, (_, index) => chunks[index % chunks.length]),
      { dispatchIntervalMs },
    );
    expect(runtime.calls).toHaveLength(30);
    expect(result.byKey.map((key) => key.requests)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(result.resultCodes).toEqual({ OK: 30 });
  }, 220000);

  (keyWavesLiveEnabled ? it : it.skip)('dispatches five concurrent requests per key in six one-second waves', async () => {
    const keys = readLiveKeys();
    const emit = (event) => console.info('GEMINI_DIAG', redact(JSON.stringify(event), keys));
    const runtime = createRuntime(keys, globalThis.fetch, 'six-keys-five-request-waves', emit);
    const chunks = sourceChunks(runtime.context);
    expect(chunks).toHaveLength(10);
    emit({
      type: 'key_waves_setup', model, rpmPerKey: 10, keyCount: 6, jobs: 30,
      requestedParallel: 30, requestsPerKeyWave: 5, keyWaveIntervalMs: 1000,
    });
    const result = await runtime.run(
      Array.from({ length: 30 }, (_, index) => chunks[index % chunks.length]),
      {
        dispatchDelayMsForChunk: (chunkIndex) => Math.floor(chunkIndex / 5) * 1000,
        keyIndexForChunk: (chunkIndex) => Math.floor(chunkIndex / 5),
      },
    );
    const firstStartByKey = result.byKey.map(({ key }) => Math.min(
      ...runtime.calls.filter((call) => call.key === key).map((call) => call.startedAt),
    ));
    expect(runtime.calls).toHaveLength(30);
    expect(result.byKey.map((key) => key.requests)).toEqual([5, 5, 5, 5, 5, 5]);
    for (const { key } of result.byKey) {
      const starts = runtime.calls.filter((call) => call.key === key).map((call) => call.startedAt);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(250);
    }
    for (let index = 1; index < firstStartByKey.length; index++) {
      expect(firstStartByKey[index] - firstStartByKey[index - 1]).toBeGreaterThanOrEqual(750);
    }
    expect(result.resultCodes).toEqual({ OK: 30 });
  }, 220000);

  (fivePerSecondLiveEnabled ? it : it.skip)('dispatches five total requests per second while the production selector rotates six keys', async () => {
    const keys = readLiveKeys();
    const emit = (event) => console.info('GEMINI_DIAG', redact(JSON.stringify(event), keys));
    const runtime = createRuntime(keys, globalThis.fetch, 'six-keys-five-total-per-second', emit);
    const chunks = sourceChunks(runtime.context);
    expect(chunks).toHaveLength(10);
    emit({
      type: 'five_per_second_setup', model, rpmPerKey: 10, keyCount: 6, jobs: 30,
      requestedParallel: 30, requestsPerSecond: 5, waveIntervalMs: 1000,
    });
    const result = await runtime.run(
      Array.from({ length: 30 }, (_, index) => chunks[index % chunks.length]),
      { dispatchDelayMsForChunk: (chunkIndex) => Math.floor(chunkIndex / 5) * 1000 },
    );
    const startsByWave = Array.from({ length: 6 }, (_, waveIndex) => runtime.calls
      .filter((call) => call.chunk >= waveIndex * 5 + 1 && call.chunk <= waveIndex * 5 + 5)
      .map((call) => call.startedAt));
    expect(runtime.calls).toHaveLength(30);
    expect(result.byKey.reduce((total, key) => total + key.requests, 0)).toBe(30);
    for (const starts of startsByWave) {
      expect(starts).toHaveLength(5);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(250);
    }
    for (let index = 1; index < startsByWave.length; index++) {
      expect(Math.min(...startsByWave[index]) - Math.min(...startsByWave[index - 1])).toBeGreaterThanOrEqual(750);
    }
    expect(result.resultCodes).toEqual({ OK: 30 });
  }, 220000);

  (sixKeyBurstsLiveEnabled ? it : it.skip)(`dispatches ${sixKeyBurstSize} concurrent requests per key across six keys spaced five seconds apart`, async () => {
    expect([10, 15]).toContain(sixKeyBurstSize);
    const keys = readLiveKeys();
    const totalRequests = keys.length * sixKeyBurstSize;
    const emit = (event) => console.info('GEMINI_DIAG', redact(JSON.stringify(event), keys));
    const runtime = createRuntime(
      keys,
      globalThis.fetch,
      `six-keys-${sixKeyBurstSize}-request-five-second-bursts`,
      emit,
      totalRequests,
      sixKeyBurstSize,
    );
    const chunks = sourceChunks(runtime.context);
    expect(chunks).toHaveLength(10);
    emit({
      type: 'six_key_bursts_setup', model, keyCount: keys.length, jobs: totalRequests,
      runtimeParallelCap: 30, rpmPerKey: sixKeyBurstSize,
      requestsPerKeyBurst: sixKeyBurstSize, keyBurstIntervalMs: 5000,
    });
    const result = await runtime.run(
      Array.from({ length: totalRequests }, (_, index) => chunks[index % chunks.length]),
      {
        dispatchDelayMsForChunk: (chunkIndex) => Math.floor(chunkIndex / sixKeyBurstSize) * 5000,
        keyIndexForChunk: (chunkIndex) => Math.floor(chunkIndex / sixKeyBurstSize),
      },
    );
    const startsByKey = result.byKey.map(({ key }) => runtime.calls
      .filter((call) => call.key === key)
      .map((call) => call.startedAt));
    expect(runtime.calls).toHaveLength(totalRequests);
    expect(result.byKey.map((key) => key.requests)).toEqual(new Array(keys.length).fill(sixKeyBurstSize));
    expect(runtime.calls.every((call) => (
      call.key === Math.floor((call.chunk - 1) / sixKeyBurstSize) + 1
    ))).toBe(true);
    for (const starts of startsByKey) {
      expect(starts).toHaveLength(sixKeyBurstSize);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(250);
    }
    for (let index = 1; index < startsByKey.length; index++) {
      const waveGapMs = Math.min(...startsByKey[index]) - Math.min(...startsByKey[index - 1]);
      expect(waveGapMs).toBeGreaterThanOrEqual(4750);
      expect(waveGapMs).toBeLessThan(5500);
    }
    expect(result.resultCodes).toEqual({ OK: totalRequests });
  }, 300000);

});
