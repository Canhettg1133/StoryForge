import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadRuntime() {
  let now = 0;
  const countdownWaits = [];
  const ordinaryWaits = [];
  class FakeDate extends Date {
    static now() {
      return now;
    }
  }
  const context = {
    Date: FakeDate,
    console: { log() {}, warn() {}, error() {} },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    showToast() {},
    async sleep(ms) {
      ordinaryWaits.push(ms);
      now += ms;
    },
    async sleepWithCountdown(ms) {
      countdownWaits.push(ms);
      now += ms;
    },
  };

  vm.createContext(context);
  [
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/gemini/model-rotation.js',
    'public/translator-runtime/js/translation/retry.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });

  return {
    context,
    countdownWaits,
    ordinaryWaits,
    getNow: () => now,
  };
}

describe('translator post-translation quota waits', () => {
  it('waits one complete 65-second window before a Han correction wave after 30 main requests', async () => {
    const runtime = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_A', 'DIRECT_B'];
      GEMINI_MODELS = [{ name: 'gemini-3.5-flash-lite', enabled: true }];
      translatorRpmTimestamps = {};
      rpmPerKey = 15;
      Array.from({ length: 30 }, () => getNextModelKeyPairWithQueue('main'));
    `, runtime.context);

    const plan = await vm.runInContext(
      'waitForTranslatorRpmBatchPlan({ requestedParallel: 30, remainingChunks: 10 })',
      runtime.context,
    );

    expect(runtime.countdownWaits).toEqual([65000]);
    expect(runtime.getNow()).toBe(65000);
    expect(plan.capacity).toBe(10);
    expect(plan.keyAllocations).toEqual([5, 5]);
  });

  it('counts a failed real attempt and waits for a fresh per-key window before the retry', async () => {
    const runtime = loadRuntime();
    vm.runInContext(`
      useProxy = false;
      useOllama = false;
      apiKeys = ['DIRECT_ONLY'];
      GEMINI_MODELS = [{ name: 'gemini-3.5-flash-lite', enabled: true }];
      translatorRpmTimestamps = {};
      rpmPerKey = 1;
      getNextModelKeyPairWithQueue('main');
      directAttemptTimes = [];
      directAttemptCount = 0;
      translateChunk = async (_request, pair) => {
        directAttemptTimes.push({ at: Date.now(), keyIndex: pair.keyIndex });
        directAttemptCount += 1;
        if (directAttemptCount === 1) throw createTranslatorError('OUTPUT_TOO_SHORT');
        return 'Đã dịch sạch';
      };
    `, runtime.context);

    const result = await vm.runInContext(
      "translateChunkWithRetry('Nguồn', 0, 2)",
      runtime.context,
    );
    const attempts = vm.runInContext('JSON.parse(JSON.stringify(directAttemptTimes))', runtime.context);

    expect(result).toBe('Đã dịch sạch');
    expect(runtime.countdownWaits).toEqual([65000, 64500]);
    expect(runtime.ordinaryWaits).toEqual([500]);
    expect(attempts).toEqual([
      { at: 65000, keyIndex: 0 },
      { at: 130000, keyIndex: 0 },
    ]);
  });
});
