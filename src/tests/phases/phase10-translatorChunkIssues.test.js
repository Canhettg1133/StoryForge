import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function makeElement(id = '') {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
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
    parallelCount: { ...makeElement('parallelCount'), value: '8' },
    sourceLang: { ...makeElement('sourceLang'), value: 'auto' },
  };
  const toastMessages = [];
  const historyCalls = [];
  const sessionUpdates = [];
  const directAttempts = [];

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
    buildPromptedChunk: (_prompt, sourceText) => `PROMPT\n${sourceText}`,
    async sendDirectTranslationAttempt(options) {
      directAttempts.push(options);
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
  };

  vm.createContext(context);
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
      async getTranslatorSessionChunks() {
        return [
          { chunkIndex: 0, status: 'done', outputText: 'Đã dịch 1', sourceText: 'Gốc 1' },
          { chunkIndex: 1, status: 'skipped', outputText: '', sourceText: 'Gốc 2' },
          { chunkIndex: 2, status: 'failed', outputText: '[LỖI CHUNK 3]', sourceText: 'Gốc 3', error: 'CONTENT_BLOCKED_SAFETY' },
          { chunkIndex: 3, status: 'pending', outputText: '', sourceText: 'Gốc 4' },
        ];
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
    expect(context.directAttempts[0].kind).toBe('manual_retry');
    expect(context.sessionUpdates.at(-1)).toEqual([
      'large-session',
      2,
      { status: 'done', outputText: 'Đã dịch lại 3', error: '' },
    ]);
  });

  it('limits default large-file retries to a small batch and skips pending chunks', async () => {
    const context = loadChunkIssueRuntime({
      async getTranslatorSessionChunks() {
        return [
          { chunkIndex: 0, status: 'done', outputText: 'Đã dịch 1', sourceText: 'Gốc 1' },
          { chunkIndex: 1, status: 'failed', outputText: '[LỖI CHUNK 2]', sourceText: 'Gốc 2' },
          { chunkIndex: 2, status: 'failed', outputText: '[LỖI CHUNK 3]', sourceText: 'Gốc 3' },
          { chunkIndex: 3, status: 'failed', outputText: '[LỖI CHUNK 4]', sourceText: 'Gốc 4' },
          { chunkIndex: 4, status: 'pending', outputText: '', sourceText: 'Gốc 5' },
        ];
      },
    });
    vm.runInContext(`
      TRANSLATOR_SOURCE_MODES = { LARGE_FILE: 'large-file' };
      currentSourceMode = 'large-file';
      currentTranslatorSessionId = 'large-session';
      translatedChunks = ['Đã dịch 1', '[LỖI CHUNK 2]', '[LỖI CHUNK 3]', '[LỖI CHUNK 4]', null];
      isTranslating = false;
      useProxy = false;
      useOllama = false;
      document.getElementById('parallelCount').value = '8';
    `, context);

    const result = await vm.runInContext('retryIssueChunks({ source: "large-file" })', context);

    expect(result).toMatchObject({ ok: true, attempted: 2, succeeded: 2, failed: 0 });
    expect(context.directAttempts.map((attempt) => attempt.chunkIndex)).toEqual([1, 2]);
    expect(context.directAttempts.every((attempt) => attempt.kind === 'manual_retry')).toBe(true);
    expect(context.directAttempts.map((attempt) => attempt.text)).toEqual([
      'PROMPT\nGốc 2',
      'PROMPT\nGốc 3',
    ]);
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
