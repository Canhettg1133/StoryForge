import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';

import '../../../public/translator-runtime/js/translation/source-reader.js';
import '../../../public/translator-runtime/js/translation/local-store.js';

const repoRoot = process.cwd();

function makeElement(id = '') {
  const attributes = new Map();
  return {
    id,
    disabled: false,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    scrollIntoView() {},
  };
}

function loadChunkIssueRuntime(extra = {}) {
  const elements = {
    translatedText: makeElement('translatedText'),
    chunkDetailModal: makeElement('chunkDetailModal'),
    chunkTrackerList: makeElement('chunkTrackerList'),
    chunkTrackerSummary: makeElement('chunkTrackerSummary'),
    chunkTrackerBadge: makeElement('chunkTrackerBadge'),
    chunkTrackerPanel: makeElement('chunkTrackerPanel'),
    chunkIssuePanel: makeElement('chunkIssuePanel'),
    downloadResultBtn: makeElement('downloadResultBtn'),
    downloadResultBtnText: makeElement('downloadResultBtnText'),
    downloadResultStatus: makeElement('downloadResultStatus'),
    downloadPartialBtn: makeElement('downloadPartialBtn'),
    parallelCount: { ...makeElement('parallelCount'), value: '8' },
    sourceLang: { ...makeElement('sourceLang'), value: 'auto' },
  };
  const toastMessages = [];
  const historyCalls = [];
  const sessionUpdates = [];
  const directAttempts = [];
  const rpmPlans = [];
  const sessionChunkReads = [];
  let sessionBulkReads = 0;
  let activeDirectAttempts = 0;
  let maxActiveDirectAttempts = 0;

  const context = {
    Date,
    Math,
    Number,
    Promise,
    RegExp,
    String,
    console: { log() {}, warn() {}, error() {} },
    document: {
      createElement() {
        let text = '';
        return {
          set textContent(value) {
            text = String(value || '');
          },
          get innerHTML() {
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          },
        };
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    prompt: () => 'Bản dịch sửa tay',
    showToast(message, type) {
      toastMessages.push({ message, type });
    },
    updateHistoryProgress(...args) {
      historyCalls.push(args);
    },
    async updateTranslatorChunkResult(...args) {
      sessionUpdates.push(args);
      return args;
    },
    async getTranslatorSessionChunks() {
      sessionBulkReads += 1;
      return [];
    },
    async getTranslatorChunk(sessionId, chunkIndex) {
      sessionChunkReads.push({ sessionId, chunkIndex });
      return null;
    },
    async readTranslatorChunkSource(_sessionId, row) {
      return row?.sourceText || '';
    },
    buildPromptedChunk: (_prompt, sourceText) => `PROMPT\n${sourceText}`,
    async waitForTranslatorRpmBatchPlan(options) {
      rpmPlans.push(options);
      return { capacity: Math.min(2, options.remainingChunks) };
    },
    async sendDirectTranslationAttempt(options) {
      directAttempts.push(options);
      activeDirectAttempts += 1;
      maxActiveDirectAttempts = Math.max(maxActiveDirectAttempts, activeDirectAttempts);
      await new Promise(resolve => setTimeout(resolve, 0));
      activeDirectAttempts -= 1;
      return { result: `Đã dịch lại ${options.chunkIndex + 1}`, modelKeyPair: { keyIndex: 0 } };
    },
    recordKeySuccess() {},
    renderHistoryList() {},
    saveHistory() {},
    sleep: async () => {},
    ...extra,
    elements,
    toastMessages,
    historyCalls,
    sessionUpdates,
    directAttempts,
    rpmPlans,
    sessionChunkReads,
    getSessionBulkReads: () => sessionBulkReads,
    getMaxActiveDirectAttempts: () => maxActiveDirectAttempts,
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit/correction-runner.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/translation/han-audit/correction-runner.js' },
  );
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/ui/chunk-tracker.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/ui/chunk-tracker.js' },
  );
  return context;
}

describe('translator chunk issue workflow', () => {
  it('summarizes failed, manual, and pending chunks in stable chunk order', () => {
    const context = loadChunkIssueRuntime();

    const summary = context.summarizeTranslatorChunkIssues({
      chunks: [
        'Đã dịch xong',
        '[LỖI CHUNK 2]\nNguyên nhân: quota',
        '\n\n╔══╗\n║ ⚠️ CHUNK 3 - CẦN DỊCH THỦ CÔNG ║',
        null,
      ],
      startChunkIndex: 1,
      totalChunks: 4,
    });

    expect(summary.issueCount).toBe(3);
    expect(summary.failedCount).toBe(1);
    expect(summary.manualCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.issues.map((issue) => issue.chunkIndex)).toEqual([1, 2, 3]);
  });

  it('ignores skipped chunks before the selected start chunk', () => {
    const context = loadChunkIssueRuntime();

    const summary = context.summarizeTranslatorChunkIssues({
      chunks: [
        { chunkIndex: 0, status: 'skipped', outputText: '' },
        { chunkIndex: 1, status: 'skipped', outputText: '' },
        { chunkIndex: 2, status: 'done', outputText: 'Đã dịch chunk 3' },
        { chunkIndex: 3, status: 'failed', outputText: '[LỖI CHUNK 4]\nNguyên nhân: safety', error: 'CONTENT_BLOCKED_SAFETY' },
      ],
      startChunkIndex: 2,
    });

    expect(summary.issueCount).toBe(1);
    expect(summary.issues[0]).toMatchObject({
      chunkIndex: 3,
      type: 'failed',
      safetyRelated: true,
    });
  });

  it('counts missing tail chunks as pending only inside the selected translation scope', () => {
    const context = loadChunkIssueRuntime();

    const summary = context.summarizeTranslatorChunkIssues({
      chunks: [
        { chunkIndex: 0, status: 'skipped', outputText: '' },
        { chunkIndex: 1, status: 'done', outputText: 'Đã dịch chunk 2' },
      ],
      startChunkIndex: 1,
      totalChunks: 5,
    });

    expect(summary.issueCount).toBe(3);
    expect(summary.pendingCount).toBe(3);
    expect(summary.issues.map((issue) => issue.chunkIndex)).toEqual([2, 3, 4]);
  });

  it('maps sparse output-only rows by chunkIndex without creating phantom positions', () => {
    const context = loadChunkIssueRuntime();

    const summary = context.summarizeTranslatorChunkIssues({
      chunks: [
        { chunkIndex: 7, status: 'done', outputText: 'Đã dịch chunk 8' },
        { chunkIndex: 9, status: 'failed', outputText: '[LỖI CHUNK 10]\nNguyên nhân: quota' },
      ],
      startChunkIndex: 7,
      totalChunks: 10,
    });

    expect(summary.issues.map(issue => issue.chunkIndex)).toEqual([8, 9]);
    expect(summary.pendingCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it('persists manual edits into current output, history, and session chunk state', async () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      currentTranslatorSessionId = 'session-1';
      currentHistoryId = 'history-1';
      originalFileName = 'truyen.txt';
      translatedChunks = ['Đã dịch chunk 1', '[LỖI CHUNK 2]\\nNguyên nhân: lỗi cũ'];
      completedChunks = 2;
      totalChunksCount = 2;
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
      trackChunkFailed(1, 'lỗi cũ');
    `, context);

    await vm.runInContext('editChunkManual(1)', context);

    expect(vm.runInContext('translatedChunks', context)).toEqual([
      'Đã dịch chunk 1',
      'Bản dịch sửa tay',
    ]);
    expect(context.elements.translatedText.value).toBe('Đã dịch chunk 1\n\nBản dịch sửa tay');
    expect(context.sessionUpdates.at(-1)).toEqual([
      'session-1',
      1,
      { status: 'done', outputText: 'Bản dịch sửa tay', error: '' },
    ]);
    expect(context.historyCalls.at(-1)[0]).toBe('history-1');
    expect(context.historyCalls.at(-1)[1]).toBe('Đã dịch chunk 1\n\nBản dịch sửa tay');
    expect(context.historyCalls.at(-1)[3]).toBe(2);
  });

  it('does not run manual retry while a translation is still active', async () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      isTranslating = true;
      translatedChunks = ['[LỖI CHUNK 1]\\nNguyên nhân: lỗi'];
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toEqual({ ok: false, reason: 'busy' });
    expect(context.directAttempts).toHaveLength(0);
    expect(context.toastMessages.at(-1).message).toContain('Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch');
  });

  it('does not run manual retry while the uploaded TXT Han audit is active', async () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      isTranslating = false;
      isHanFileAuditBusy = true;
      translatedChunks = ['[LỖI CHUNK 1]\\nNguyên nhân: lỗi'];
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toEqual({ ok: false, reason: 'busy' });
    expect(context.directAttempts).toHaveLength(0);
  });

  it('rejects a second retry-all action while the first retry job is still running', async () => {
    const releases = [];
    let context;
    context = loadChunkIssueRuntime({
      async sendDirectTranslationAttempt(options) {
        context.directAttempts.push(options);
        return new Promise(resolve => {
          releases.push(() => resolve({
            result: `Đã dịch lại ${options.chunkIndex + 1}`,
            modelKeyPair: { keyIndex: 0 },
          }));
        });
      },
    });
    vm.runInContext(`
      currentTranslatorSessionId = 'retry-busy-session';
      translatedChunks = ['[LỖI CHUNK 1]\\nNguyên nhân: lỗi'];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker(['Gốc 1'], null, 'PROMPT');
      trackChunkFailed(0, 'lỗi');
    `, context);

    const firstRetry = vm.runInContext('retryIssueChunks({ source: "text" })', context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const secondRetry = vm.runInContext('retryIssueChunks({ source: "text" })', context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const requestCountBeforeRelease = releases.length;
    releases.forEach(release => release());
    const [firstResult, secondResult] = await Promise.all([firstRetry, secondRetry]);

    expect(requestCountBeforeRelease).toBe(1);
    expect(firstResult).toMatchObject({ ok: true, attempted: 1 });
    expect(secondResult).toEqual({ ok: false, reason: 'busy' });
    expect(context.directAttempts).toHaveLength(1);
  });

  it('does not prompt or persist manual edits while a translation is still active', async () => {
    let promptCalls = 0;
    const context = loadChunkIssueRuntime({
      prompt() {
        promptCalls += 1;
        return 'Không được dùng';
      },
    });
    vm.runInContext(`
      isTranslating = true;
      translatedChunks = ['Đã dịch chunk 1', '[LỖI CHUNK 2]\\nNguyên nhân: lỗi'];
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
      trackChunkFailed(1, 'lỗi cũ');
    `, context);

    const result = await vm.runInContext('editChunkManual(1)', context);

    expect(result).toEqual({ ok: false, reason: 'busy' });
    expect(promptCalls).toBe(0);
    expect(vm.runInContext('translatedChunks[1]', context)).toContain('[LỖI CHUNK 2]');
    expect(context.sessionUpdates).toHaveLength(0);
    expect(context.toastMessages.at(-1).message).toContain('Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch');
  });

  it('retries a pending text chunk from the original source and persists the exact slot', async () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      currentTranslatorSessionId = 'session-text';
      currentHistoryId = 'history-text';
      originalFileName = 'truyen.txt';
      translationStartChunkIndex = 1;
      translatedChunks = ['Đã dịch sẵn chunk 1', null];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toMatchObject({ ok: true, attempted: 1, succeeded: 1, failed: 0 });
    expect(context.directAttempts).toHaveLength(1);
    expect(context.directAttempts[0]).toMatchObject({
      chunkIndex: 1,
      kind: 'manual_retry',
      text: 'PROMPT\nGốc 2',
    });
    expect(vm.runInContext('translatedChunks', context)).toEqual([
      'Đã dịch sẵn chunk 1',
      'Đã dịch lại 2',
    ]);
    expect(context.sessionUpdates.at(-1)).toEqual([
      'session-text',
      1,
      { status: 'done', outputText: 'Đã dịch lại 2', error: '' },
    ]);
    expect(context.historyCalls.at(-1)[1]).toBe('Đã dịch sẵn chunk 1\n\nĐã dịch lại 2');
    expect(context.historyCalls.at(-1)[3]).toBe(1);
  });

  it('keeps a failed retry marked and shows safety guidance without switching model', async () => {
    const context = loadChunkIssueRuntime({
      async sendDirectTranslationAttempt(options) {
        context.directAttempts.push(options);
        return {
          result: '[LỖI CHUNK 1]\nCONTENT_BLOCKED_SAFETY',
          modelKeyPair: { keyIndex: 0 },
        };
      },
    });
    vm.runInContext(`
      currentTranslatorSessionId = 'session-safety';
      currentHistoryId = 'history-safety';
      translatedChunks = ['[LỖI CHUNK 1]\\nNguyên nhân: CONTENT_BLOCKED_SAFETY'];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker(['Gốc bị chặn'], null, 'PROMPT');
      trackChunkFailed(0, 'CONTENT_BLOCKED_SAFETY');
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toMatchObject({ ok: true, attempted: 1, succeeded: 0, failed: 1 });
    expect(context.directAttempts[0].kind).toBe('manual_retry');
    expect(context.sessionUpdates.at(-1)).toEqual([
      'session-safety',
      0,
      {
        status: 'failed',
        outputText: '[LỖI CHUNK 1]\nNguyên nhân: CONTENT_BLOCKED_SAFETY',
        error: '[LỖI CHUNK 1]\nCONTENT_BLOCKED_SAFETY',
      },
    ]);
    expect(context.toastMessages.some((toast) => (
      toast.message.includes('gemini-2.5-flash') &&
      toast.message.includes('không tự đổi model')
    ))).toBe(true);
  });

  it('retries only failed large-file chunks from local session storage', async () => {
    const context = loadChunkIssueRuntime({
      async getTranslatorChunk(sessionId, chunkIndex) {
        context.sessionChunkReads.push({ sessionId, chunkIndex });
        return { chunkIndex, status: 'failed', outputText: '[LỖI CHUNK 3]', sourceText: 'Gốc 3', error: 'CONTENT_BLOCKED_SAFETY' };
      },
    });
    vm.runInContext(`
      TRANSLATOR_SOURCE_MODES = { LARGE_FILE: 'large-file' };
      currentSourceMode = 'large-file';
      currentTranslatorSessionId = 'large-session';
      currentHistoryId = 'history-large';
      translatedChunks = ['Đã dịch 1', null, '[LỖI CHUNK 3]', null];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "large-file", limit: 1 })', context);

    expect(result).toMatchObject({ ok: true, attempted: 1, succeeded: 1 });
    expect(context.directAttempts.map((attempt) => attempt.chunkIndex)).toEqual([2]);
    expect(context.sessionChunkReads).toEqual([{ sessionId: 'large-session', chunkIndex: 2 }]);
    expect(context.getSessionBulkReads()).toBe(0);
    expect(context.directAttempts[0].kind).toBe('manual_retry');
    expect(context.sessionUpdates.at(-1)).toEqual([
      'large-session',
      2,
      { status: 'done', outputText: 'Đã dịch lại 3', error: '' },
    ]);
  });

  it('retries a large-file chunk from exact in-memory byte offsets when persistence is unavailable', async () => {
    const context = loadChunkIssueRuntime({ Blob });
    context.currentSourceFile = new Blob(['HEADexact-sourceTAIL']);
    vm.runInContext(`
      TRANSLATOR_SOURCE_MODES = { LARGE_FILE: 'large-file' };
      currentSourceMode = 'large-file';
      currentTranslatorSessionId = 'memory-session';
      currentTranslatorPersistenceAvailable = false;
      currentHistoryId = 'history-memory';
      translatedChunks = ['[LỖI CHUNK 1]'];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker([], null, 'PROMPT', { dynamic: true, largeFile: true });
      trackChunkDiscovered(0, 'truncated-preview', { byteStart: 4, byteEnd: 16 });
      trackChunkFailed(0, 'quota');
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "large-file", limit: 1 })', context);

    expect(result).toMatchObject({ ok: true, attempted: 1, succeeded: 1 });
    expect(context.directAttempts[0]).toMatchObject({
      chunkIndex: 0,
      kind: 'manual_retry',
      text: 'PROMPT\nexact-source',
    });
  });

  it('retries every failed large-file chunk in RPM-governed parallel waves and skips pending chunks', async () => {
    const context = loadChunkIssueRuntime({
      async getTranslatorChunk(sessionId, chunkIndex) {
        context.sessionChunkReads.push({ sessionId, chunkIndex });
        return { chunkIndex, status: 'failed', outputText: `[LỖI CHUNK ${chunkIndex + 1}]`, sourceText: `Gốc ${chunkIndex + 1}` };
      },
    });
    vm.runInContext(`
      TRANSLATOR_SOURCE_MODES = { LARGE_FILE: 'large-file' };
      currentSourceMode = 'large-file';
      currentTranslatorSessionId = 'large-session';
      currentHistoryId = 'history-wave';
      translatedChunks = ['Đã dịch 1', '[LỖI CHUNK 2]', '[LỖI CHUNK 3]', '[LỖI CHUNK 4]', null];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      document.getElementById('parallelCount').value = '2';
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "large-file" })', context);

    expect(result).toMatchObject({ ok: true, attempted: 3, succeeded: 3, failed: 0 });
    expect(context.rpmPlans.map(plan => plan.remainingChunks)).toEqual([3, 1]);
    expect(context.getMaxActiveDirectAttempts()).toBe(2);
    expect(context.directAttempts.map((attempt) => attempt.chunkIndex)).toEqual([1, 2, 3]);
    expect(context.directAttempts.every((attempt) => attempt.kind === 'manual_retry')).toBe(true);
    expect(context.directAttempts.map((attempt) => attempt.text)).toEqual([
      'PROMPT\nGốc 2',
      'PROMPT\nGốc 3',
      'PROMPT\nGốc 4',
    ]);
    expect(context.sessionChunkReads.map(read => read.chunkIndex)).toEqual([1, 2, 3]);
    expect(context.getSessionBulkReads()).toBe(0);
    expect(context.historyCalls).toHaveLength(2);
  });

  it('replaces a failed persisted chunk in place before building the final downloadable Blob', async () => {
    const store = globalThis.TranslatorLocalStore;
    await store.clearTranslatorLocalStoreForTests();
    try {
      const source = new Blob(['Gốc 1\n\nGốc 2\n\nGốc 3'], { type: 'text/plain;charset=utf-8' });
      Object.defineProperties(source, {
        name: { value: 'truyen-dai.txt' },
        lastModified: { value: 1710000000000 },
      });
      const session = await store.createTranslatorSessionFromFile(source, { chunkSize: 6 });
      await store.persistTranslatorChunkBatch(session.id, [
        { chunkIndex: 0, status: 'done', sourceText: 'Gốc 1', outputText: 'Bản dịch 1' },
        { chunkIndex: 1, status: 'failed', sourceText: 'Gốc 2', outputText: '[LỖI CHUNK 2]\nNguyên nhân: quota', error: 'quota' },
        { chunkIndex: 2, status: 'done', sourceText: 'Gốc 3', outputText: 'Bản dịch 3' },
      ], {
        status: 'completed',
        isComplete: true,
        totalChunks: 3,
        totalChunksExact: true,
        completedChunks: 3,
        failedChunks: 1,
      });

      const context = loadChunkIssueRuntime({
        Blob,
        getTranslatorChunk: store.getTranslatorChunk,
        updateTranslatorChunkResult: store.updateTranslatorChunkResult,
        async sendDirectTranslationAttempt(options) {
          return { result: `Bản dịch ${options.chunkIndex + 1}`, modelKeyPair: { keyIndex: 0 } };
        },
      });
      vm.runInContext(`
        TRANSLATOR_SOURCE_MODES = { LARGE_FILE: 'large-file' };
        currentSourceMode = 'large-file';
        currentTranslatorSessionId = ${JSON.stringify(session.id)};
        originalFileName = 'truyen-dai.txt';
        translatedChunks = ['Bản dịch 1', '[LỖI CHUNK 2]\\nNguyên nhân: quota', 'Bản dịch 3'];
        isTranslating = false;
        useProxy = false;
        useOllama = false;
      `, context);

      const retryResult = await vm.runInContext('retryIssueChunks({ source: "large-file" })', context);
      expect(retryResult).toMatchObject({ ok: true, attempted: 1, succeeded: 1, failed: 0, remaining: 0 });

      let downloadedBlob = null;
      const anchor = { href: '', download: '', click() {} };
      const downloadContext = {
        Blob,
        URL: {
          createObjectURL(blob) {
            downloadedBlob = blob;
            return 'blob:retry-download-test';
          },
          revokeObjectURL() {},
        },
        document: {
          body: { appendChild() {}, removeChild() {} },
          createElement() { return anchor; },
        },
        showToast() {},
        getTranslatorSession: store.getTranslatorSession,
        getTranslatorSessionOutputParts: store.getTranslatorSessionOutputParts,
        isChunkIssueRetryBusy: false,
      };
      vm.createContext(downloadContext);
      vm.runInContext(
        fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/ui/progress.js'), 'utf8'),
        downloadContext,
        { filename: 'public/translator-runtime/js/ui/progress.js' },
      );
      downloadContext.showToast = () => {};

      const downloaded = await downloadContext.downloadTranslatorSessionResult(session.id, 'truyen-dai.txt');
      expect(downloaded).toBe(true);
      expect(anchor.download).toBe('truyen-dai.txt');
      expect(await downloadedBlob.text()).toBe('Bản dịch 1\n\nBản dịch 2\n\nBản dịch 3');
      expect(await downloadedBlob.text()).not.toContain('[LỖI CHUNK');
    } finally {
      await store.clearTranslatorLocalStoreForTests();
    }
  });

  it('labels issue output honestly and locks the final download action while retry is writing', async () => {
    let releaseRetry;
    const context = loadChunkIssueRuntime({
      async sendDirectTranslationAttempt(options) {
        return new Promise(resolve => {
          releaseRetry = () => resolve({
            result: `Bản dịch ${options.chunkIndex + 1}`,
            modelKeyPair: { keyIndex: 0 },
          });
        });
      },
    });
    vm.runInContext(`
      translatedChunks = ['Đã dịch 1', '[LỖI CHUNK 2]\\nNguyên nhân: quota'];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      document.getElementById('parallelCount').value = '1';
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
      trackChunkFailed(1, 'quota');
      renderChunkIssuePanel();
    `, context);

    expect(context.elements.downloadResultBtnText.textContent).toBe('Tải bản có đánh dấu');
    expect(context.elements.downloadResultBtn.disabled).toBe(false);
    expect(context.elements.downloadResultStatus.textContent).toContain('còn chunk lỗi');

    const retry = vm.runInContext('retryIssueChunks({ source: "text" })', context);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(context.elements.downloadResultBtnText.textContent).toBe('Đang hoàn thiện file…');
    expect(context.elements.downloadResultBtn.disabled).toBe(true);
    expect(context.elements.downloadResultBtn.getAttribute('aria-busy')).toBe('true');
    expect(context.elements.downloadPartialBtn.disabled).toBe(true);
    expect(context.elements.downloadResultStatus.textContent).toContain('đang được cập nhật');

    releaseRetry();
    await retry;
    expect(context.elements.downloadResultBtnText.textContent).toBe('Tải bản dịch hoàn chỉnh');
    expect(context.elements.downloadResultBtn.disabled).toBe(false);
    expect(context.elements.downloadResultBtn.getAttribute('aria-busy')).toBe('false');
    expect(context.elements.downloadPartialBtn.disabled).toBe(false);
    expect(context.elements.downloadResultStatus.textContent).toContain('sẵn sàng tải');
  });

  it('stops before another wave and does not overwrite an in-flight chunk with a cancellation error', async () => {
    const releases = [];
    let context;
    context = loadChunkIssueRuntime({
      async waitForTranslatorRpmBatchPlan(options) {
        context.rpmPlans.push(options);
        return { capacity: 1 };
      },
      async sendDirectTranslationAttempt(options) {
        context.directAttempts.push(options);
        return new Promise(resolve => {
          releases.push(() => resolve({
            result: `Đã dịch lại ${options.chunkIndex + 1}`,
            modelKeyPair: { keyIndex: 0 },
          }));
        });
      },
    });
    vm.runInContext(`
      currentTranslatorSessionId = 'cancel-session';
      translatedChunks = [
        '[LỖI CHUNK 1]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 2]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 3]\\nNguyên nhân: lỗi'
      ];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker(['Gốc 1', 'Gốc 2', 'Gốc 3'], null, 'PROMPT');
      trackChunkFailed(0, 'lỗi');
      trackChunkFailed(1, 'lỗi');
      trackChunkFailed(2, 'lỗi');
    `, context);

    const retry = vm.runInContext('retryIssueChunks({ source: "text" })', context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const cancelResult = vm.runInContext('cancelChunkIssueRetry()', context);
    releases[0]();
    const result = await retry;

    expect(cancelResult).toEqual({ ok: true });
    expect(result).toMatchObject({
      ok: false,
      attempted: 1,
      succeeded: 0,
      failed: 0,
      remaining: 3,
      cancelled: true,
    });
    expect(context.directAttempts).toHaveLength(1);
    expect(context.sessionUpdates).toHaveLength(0);
    expect(vm.runInContext('translatedChunks[0]', context)).toContain('Nguyên nhân: lỗi');
  });

  it('routes the legacy tracker retry-all action through the same RPM-governed job', async () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      translatedChunks = [
        '[LỖI CHUNK 1]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 2]\\nNguyên nhân: lỗi'
      ];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      document.getElementById('parallelCount').value = '2';
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
      trackChunkFailed(0, 'lỗi');
      trackChunkFailed(1, 'lỗi');
    `, context);

    const result = await vm.runInContext('retranslateAllFailed()', context);

    expect(result).toMatchObject({ ok: true, attempted: 2, succeeded: 2, failed: 0 });
    expect(context.rpmPlans.map(plan => plan.remainingChunks)).toEqual([2]);
    expect(context.getMaxActiveDirectAttempts()).toBe(2);
  });

  it('assigns every proxy retry wave through the shared quota plan', async () => {
    const assignedWaves = [];
    const proxyAttempts = [];
    const context = loadChunkIssueRuntime({
      buildTranslatorWaveAssignments(indices, plan) {
        assignedWaves.push({ indices: [...indices], capacity: plan.capacity });
        return indices.map((chunkIndex, keyIndex) => ({ chunkIndex, keyIndex }));
      },
      async sendProxyTranslationAttempt(options) {
        proxyAttempts.push(options);
        return { result: `Proxy đã dịch ${options.chunkIndex + 1}` };
      },
    });
    vm.runInContext(`
      translatedChunks = [
        '[LỖI CHUNK 1]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 2]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 3]\\nNguyên nhân: lỗi'
      ];
      isTranslating = false;
      useProxy = true;
      useOllama = false;
      document.getElementById('parallelCount').value = '2';
      initChunkTracker(['Gốc 1', 'Gốc 2', 'Gốc 3'], null, 'PROMPT');
      trackChunkFailed(0, 'lỗi');
      trackChunkFailed(1, 'lỗi');
      trackChunkFailed(2, 'lỗi');
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toMatchObject({ ok: true, attempted: 3, succeeded: 3, failed: 0 });
    expect(assignedWaves).toEqual([
      { indices: [0, 1], capacity: 2 },
      { indices: [2], capacity: 1 },
    ]);
    expect(proxyAttempts.map(attempt => attempt.chunkIndex)).toEqual([0, 1, 2]);
    expect(proxyAttempts.every(attempt => attempt.kind === 'manual_retry')).toBe(true);
  });

  it('reports completed and remaining chunks when quota planning fails after a finished wave', async () => {
    let planCount = 0;
    const context = loadChunkIssueRuntime({
      async waitForTranslatorRpmBatchPlan(options) {
        context.rpmPlans.push(options);
        planCount += 1;
        if (planCount > 1) throw new Error('quota planner unavailable');
        return { capacity: 1 };
      },
    });
    vm.runInContext(`
      translatedChunks = [
        '[LỖI CHUNK 1]\\nNguyên nhân: lỗi',
        '[LỖI CHUNK 2]\\nNguyên nhân: lỗi'
      ];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      initChunkTracker(['Gốc 1', 'Gốc 2'], null, 'PROMPT');
      trackChunkFailed(0, 'lỗi');
      trackChunkFailed(1, 'lỗi');
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "text" })', context);

    expect(result).toMatchObject({
      ok: false,
      reason: 'failed',
      attempted: 1,
      succeeded: 1,
      failed: 0,
      remaining: 1,
      cancelled: false,
    });
    expect(vm.runInContext('translatedChunks[0]', context)).toBe('Đã dịch lại 1');
    expect(vm.runInContext('translatedChunks[1]', context)).toContain('[LỖI CHUNK 2]');
  });

  it('renders the issue panel with disabled actions while translating', () => {
    const context = loadChunkIssueRuntime();
    vm.runInContext(`
      isTranslating = true;
      translatedChunks = ['[LỖI CHUNK 1]\\nNguyên nhân: lỗi'];
    `, context);

    vm.runInContext('renderChunkIssuePanel()', context);

    expect(context.elements.chunkIssuePanel.style.display).toBe('block');
    expect(context.elements.chunkIssuePanel.innerHTML).toContain('Còn 1 chunk cần xử lý');
    expect(context.elements.chunkIssuePanel.innerHTML).toContain('disabled');
    expect(context.elements.chunkIssuePanel.innerHTML).toContain('Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch');
  });
});
