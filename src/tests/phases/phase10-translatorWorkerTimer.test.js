import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = process.cwd();

function loadWorkerTimerRuntime() {
  const progressWrites = [];
  let visibleStatus = '';
  const elements = {
    progressFill: { style: {} },
    progressText: { textContent: '' },
    progressDetails: { textContent: '' },
    progressStatus: {},
    downloadPartialBtn: { innerHTML: '' },
  };
  Object.defineProperty(elements.progressStatus, 'textContent', {
    get() {
      return visibleStatus;
    },
    set(status) {
      visibleStatus = status;
      progressWrites.push({ status, at: Date.now() });
    },
  });
  const context = {
    Blob: class Blob {},
    Date,
    URL: {
      createObjectURL() {
        throw new Error('Force the runtime fallback timer in this test.');
      },
      revokeObjectURL() {},
    },
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    document: {
      addEventListener() {},
      getElementById(id) {
        return elements[id] || null;
      },
      hidden: false,
    },
    setTimeout,
    cancelRequested: false,
    isPaused: false,
    isTranslating: true,
    completedChunks: 0,
    totalChunksCount: 30,
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/ui/progress.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/ui/progress.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/worker-timer.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/worker-timer.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/retry.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/translation/retry.js' }
  );

  return {
    context,
    getVisibleStatus: () => visibleStatus,
    progressWrites,
  };
}

describe('phase10 translator worker countdown', () => {
  it('uses one maximum-deadline countdown instead of letting concurrent waiters jump from 30 to 1', async () => {
    vi.useFakeTimers();
    try {
      const runtime = loadWorkerTimerRuntime();
      const countdowns = Array.from({ length: 30 }, (_, index) => (
        runtime.context.sleepWithCountdown((30 - index) * 1000, 'Đang chờ Gemini Direct')
      ));

      const immediateWrites = runtime.progressWrites.map((entry) => entry.status);
      expect(immediateWrites).toEqual(['Đang chờ Gemini Direct... 30s']);
      expect(runtime.getVisibleStatus()).toBe('Đang chờ Gemini Direct... 30s');

      await vi.advanceTimersByTimeAsync(2000);
      const visibleSeconds = runtime.progressWrites
        .map((entry) => Number(entry.status.match(/(\d+)s$/)?.[1]))
        .filter(Number.isFinite);
      expect(visibleSeconds.slice(0, 3)).toEqual([30, 29, 28]);
      expect(visibleSeconds.every((seconds, index) => index === 0 || seconds <= visibleSeconds[index - 1])).toBe(true);

      runtime.context.cancelRequested = true;
      await vi.runAllTimersAsync();
      await Promise.all(countdowns);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the active quota countdown visible when a chunk publishes another progress status', async () => {
    vi.useFakeTimers();
    try {
      const runtime = loadWorkerTimerRuntime();
      const countdown = runtime.context.sleepWithCountdown(3000, 'Đang chờ Gemini Direct');

      runtime.context.updateProgress(1, 30, 'Đang dịch chunk 1/30...');
      expect(runtime.getVisibleStatus()).toBe('Đang chờ Gemini Direct... 3s');
      runtime.context.updateTranslationRuntimeStatus('Đang thử lại chunk 2...');
      expect(runtime.getVisibleStatus()).toBe('Đang chờ Gemini Direct... 3s');

      await vi.advanceTimersByTimeAsync(1000);
      expect(runtime.getVisibleStatus()).toBe('Đang chờ Gemini Direct... 2s');

      await vi.advanceTimersByTimeAsync(2000);
      await countdown;
    } finally {
      vi.useRealTimers();
    }
  });
});
