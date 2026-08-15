import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../public/translator-runtime/js/translation/local-store.js';

const repoRoot = process.cwd();
const detectorSource = fs.readFileSync(
  path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit-core.js'),
  'utf8',
);
const correctionRunnerSource = fs.readFileSync(
  path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit/correction-runner.js'),
  'utf8',
);

function loadDetector() {
  const context = {
    Array,
    Math,
    Number,
    Object,
    RegExp,
    String,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(detectorSource, context, {
    filename: 'public/translator-runtime/js/translation/han-audit-core.js',
  });
  return context.TranslatorHanAuditCore;
}

function makeElement(id, value = '') {
  return {
    id,
    value,
    innerHTML: '',
    style: {},
  };
}

function loadHanAuditRuntime(overrides = {}) {
  const elements = {
    hanAuditPanel: makeElement('hanAuditPanel'),
    translatedText: makeElement('translatedText'),
    parallelCount: makeElement('parallelCount', '2'),
    sourceLang: makeElement('sourceLang', 'zh'),
    customPrompt: makeElement('customPrompt', 'PROMPT'),
    chunkSize: makeElement('chunkSize', '4500'),
    chunkDetailModal: makeElement('chunkDetailModal'),
    chunkDetailContent: makeElement('chunkDetailContent'),
  };
  const translationRequests = [];
  const rpmPlans = [];
  const historyCalls = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;

  const context = {
    Array,
    Date,
    Math,
    Map,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    currentTranslatorSessionId: null,
    currentHistoryId: 'history-1',
    lastTranslatorHistoryId: null,
    currentSourceMode: 'text',
    TRANSLATOR_SOURCE_MODES: { TEXT: 'text', LARGE_FILE: 'large-file' },
    translatedChunks: [],
    originalChunks: [],
    completedChunks: 0,
    translatorOutputGeneration: 0,
    isTranslating: true,
    storyForgeTranslatorVisible: true,
    buildPromptedChunk: (_prompt, sourceText) => 'PROMPT\n' + sourceText,
    prependTranslationSystemRule: (request, rule) => ({ request, rule }),
    normalizeTranslatorParallel: value => Math.max(1, Math.min(30, Number(value) || 1)),
    async waitForTranslatorRpmBatchPlan(options) {
      rpmPlans.push(options);
      return { capacity: Math.min(Number(options.requestedParallel) || 1, Number(options.remainingChunks) || 1) };
    },
    async translateChunkWithRetry(request, chunkIndex) {
      translationRequests.push({ request, chunkIndex });
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 0));
      activeRequests -= 1;
      return '\u0110\u00E3 d\u1ECBch chunk ' + (chunkIndex + 1);
    },
    bumpTranslatorOutputGeneration() {
      context.translatorOutputGeneration += 1;
    },
    buildTranslatedChunksText(chunks) {
      return chunks.filter(Boolean).join('\n\n');
    },
    updateHistoryProgress(...args) {
      historyCalls.push(args);
    },
    renderChunkIssuePanel() {},
    escapeHtml: value => String(value || ''),
    showToast() {},
    ...overrides,
    elements,
    translationRequests,
    rpmPlans,
    historyCalls,
    getMaxActiveRequests: () => maxActiveRequests,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(detectorSource, context);
  vm.runInContext(correctionRunnerSource, context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit.js'), 'utf8'),
    context,
  );
  return context;
}

describe('translator Han audit detector', () => {
  it('finds simplified, traditional, Extension A, and supplementary ideographs with UTF-16 offsets', () => {
    const { scanHanInText } = loadDetector();
    const text = 'Vi\u1EC7t \u4E2D\u6587\u8A9E \u3400 \u4E2D \u{20000} xong';

    const result = scanHanInText(text);

    expect(result.hanCount).toBe(6);
    expect(result.ranges).toEqual([
      { start: 5, end: 8 },
      { start: 9, end: 10 },
      { start: 11, end: 12 },
      { start: 13, end: 15 },
    ]);
    expect(text.slice(result.ranges[3].start, result.ranges[3].end)).toBe('\u{20000}');
  });

  it('does not flag Vietnamese, Latin, emoji, Kana-only, Hangul, or CJK punctuation', () => {
    const { scanHanInText } = loadDetector();

    expect(scanHanInText('Ti\u1EBFng Vi\u1EC7t ABC \u{1F60A} \u304B\u306A \u30AB\u30CA \uD55C\uAE00 \u3002\u3001\u300C\u300D').hanCount).toBe(0);
  });

  it('keeps preview within 320 UTF-16 units without splitting a surrogate pair', () => {
    const { scanHanInText } = loadDetector();
    const text = `${'x'.repeat(159)}\u4E2D${'x'.repeat(159)}\u{20000}tail`;

    const result = scanHanInText(text);

    expect(result.preview.length).toBeLessThanOrEqual(320);
    expect(result.preview).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u);
  });

  it('returns one bounded record per matching chunk in stable sparse index order', () => {
    const { scanHanRows } = loadDetector();
    const rows = [
      { chunkIndex: 900_000, status: 'done', outputText: '\u0110\u00E3 xong \u4E2D\u6587' },
      { chunkIndex: 2, status: 'done', outputText: 'Ti\u1EBFng Vi\u1EC7t s\u1EA1ch' },
      { chunkIndex: 17, status: 'failed', outputText: 'raw \u4E2D'.repeat(20) },
      { chunkIndex: 3, status: 'skipped', outputText: '\u4E2D' },
    ];

    const results = scanHanRows(rows);

    expect(results.map((item) => item.chunkIndex)).toEqual([17, 900_000]);
    expect(results[0].ranges).toHaveLength(8);
    expect(results[0].preview.length).toBeLessThanOrEqual(320);
    expect(results[0]).not.toHaveProperty('outputText');
  });
});

describe('translator Han audit session state', () => {
  const store = globalThis.TranslatorLocalStore;

  beforeEach(async () => {
    await store.clearTranslatorLocalStoreForTests();
  });

  it('starts sessions with an output revision and increments it atomically for chunk mutations', async () => {
    const file = new File(['\u4E2D\u6587\u539F\u6587'], 'raw.txt', { type: 'text/plain' });
    const session = await store.createTranslatorSessionFromFile(file, { chunkSize: 4500 });

    expect(session.outputRevision).toBe(0);
    expect(session.hanAuditStatus).toBe('pending');

    await store.persistTranslatorChunkBatch(session.id, [
      { chunkIndex: 0, status: 'done', outputText: '\u0110\u00E3 d\u1ECBch' },
      { chunkIndex: 1, status: 'failed', outputText: 'raw \u4E2D' },
    ]);
    expect((await store.getTranslatorSession(session.id)).outputRevision).toBe(1);

    await store.updateTranslatorChunkResult(session.id, 1, {
      status: 'done',
      outputText: '\u0110\u00E3 s\u1EEDa',
    });
    expect((await store.getTranslatorSession(session.id)).outputRevision).toBe(2);
  });

  it('streams non-empty done and failed output rows through a cursor without getAll', async () => {
    const file = new File(['ngu\u1ED3n'], 'raw.txt', { type: 'text/plain' });
    const session = await store.createTranslatorSessionFromFile(file, { chunkSize: 4500 });
    await store.persistTranslatorChunkBatch(session.id, [
      { chunkIndex: 10, status: 'done', outputText: 'S\u1EA1ch' },
      { chunkIndex: 12, status: 'failed', outputText: 'raw \u4E2D' },
      { chunkIndex: 11, status: 'pending', outputText: '' },
      { chunkIndex: 9, status: 'skipped', outputText: 'kh\u00F4ng qu\u00E9t \u4E2D' },
    ]);

    const batches = [];
    const summary = await store.scanTranslatorSessionOutputRows(session.id, {
      maxChunks: 1,
      maxChars: 64 * 1024,
      onBatch(rows) {
        batches.push(rows);
      },
    });

    expect(batches.flat().map((row) => row.chunkIndex)).toEqual([10, 12]);
    expect(summary).toMatchObject({ rowCount: 2, revision: 1 });
  });

  it('keeps cursor fallback batches bounded and stops cooperatively', async () => {
    const file = new File(['source'], 'raw.txt', { type: 'text/plain' });
    const session = await store.createTranslatorSessionFromFile(file, { chunkSize: 4500 });
    const largeOutput = `${'x'.repeat(1023)}\u{20000}${'x'.repeat(3072)}\u4E2D`;
    await store.persistTranslatorChunkBatch(session.id, [
      { chunkIndex: 0, status: 'done', outputText: largeOutput },
      { chunkIndex: 1, status: 'done', outputText: 'second row \u4E2D' },
    ]);

    const batches = [];
    const summary = await store.scanTranslatorSessionOutputRows(session.id, {
      maxChunks: 32,
      maxChars: 1024,
      shouldStop: () => batches.length >= 1,
      onBatch(rows) {
        batches.push(rows);
      },
    });

    expect(batches).toHaveLength(1);
    expect(batches[0].reduce((sum, row) => sum + row.outputText.length, 0)).toBeLessThanOrEqual(1024);
    expect(summary).toMatchObject({ cancelled: true, rowCount: 1 });

    const completeBatches = [];
    await store.scanTranslatorSessionOutputRows(session.id, {
      maxChunks: 32,
      maxChars: 1024,
      onBatch(rows) {
        completeBatches.push(rows);
      },
    });
    const streamedRows = completeBatches.flat();
    expect(completeBatches.every(batch => (
      batch.reduce((sum, row) => sum + row.outputText.length, 0) <= 1024
    ))).toBe(true);
    expect(streamedRows.filter(row => row.chunkIndex === 0).map(row => row.outputText).join('')).toBe(largeOutput);
    expect(streamedRows.some(row => /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(row.outputText))).toBe(false);
  });

  it('reads the exact original byte slice for a restored large-file chunk', async () => {
    const prefix = '\u524D\u{1F600}';
    const target = '\u76EE\u6807\u6587\u672C';
    const file = new NodeBlob([prefix, target, '\u540E'], { type: 'text/plain' });
    Object.defineProperties(file, {
      name: { value: 'raw.txt' },
      lastModified: { value: 1 },
    });
    const session = await store.createTranslatorSessionFromFile(file, { chunkSize: 4500 });
    const byteStart = new TextEncoder().encode(prefix).length;
    const byteEnd = byteStart + new TextEncoder().encode(target).length;
    await store.persistTranslatorChunkBatch(session.id, [{
      chunkIndex: 21,
      status: 'done',
      byteStart,
      byteEnd,
      outputText: 'C\u00F2n \u4E2D',
    }]);
    const row = await store.getTranslatorChunk(session.id, 21);

    await expect(store.readTranslatorChunkSource(session.id, row)).resolves.toBe(target);
  });
});

describe('translator Han audit integration contract', () => {
  it('loads one audit worker and exposes delegated audit actions without unbounded result rendering', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const init = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');
    const audit = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit.js'), 'utf8');

    expect(html).toContain('js/translation/han-audit-core.js');
    expect(html).toContain('js/translation/han-audit.js');
    expect(html).toContain('id="hanAuditPanel"');
    expect(init).toContain('runHanAuditManual');
    expect(init).toContain('cancelHanAudit');
    expect(init).toContain('retryHanAuditIssues');
    expect(audit).toContain('HAN_AUDIT_VISIBLE_ISSUE_LIMIT = 24');
    expect(audit).toContain('HAN_AUDIT_MEMORY_BATCH_MAX_CHARS = 64 * 1024');
    expect(audit).not.toContain('.getAll(');
    expect(audit).not.toContain('const segments = []');
  });

  it('keeps completion and queue handoff behind the automatic audit barrier', () => {
    const engine = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/engine.js'), 'utf8');
    const history = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/history/history.js'), 'utf8');
    const largeAudit = engine.indexOf('await runHanAuditAfterTranslation();');
    const largeResultVisible = engine.lastIndexOf("document.getElementById('resultSection').style.display = 'block';", largeAudit);
    const largeCompleted = engine.indexOf("largeFileRunStatus = 'completed'", largeAudit);
    const largeFinalHistory = engine.indexOf('persistLargeHistoryProgress(true);', largeResultVisible);
    const textAudit = engine.indexOf('await runHanAuditAfterTranslation();', largeAudit + 1);
    const textHistory = engine.indexOf('finalTextIssueSummary = summarizeTextChunkIssues();', textAudit);

    expect(largeAudit).toBeGreaterThan(-1);
    expect(largeCompleted).toBeGreaterThan(largeAudit);
    expect(largeFinalHistory).toBeGreaterThan(largeAudit);
    expect(textAudit).toBeGreaterThan(largeAudit);
    expect(textHistory).toBeGreaterThan(textAudit);
    expect(history).toContain('lastTranslatorHistoryId = historyItem.id');
  });

  it('does not call the provider when the translated output is already clean', async () => {
    const context = loadHanAuditRuntime({
      translatedChunks: ['B\u1EA3n d\u1ECBch s\u1EA1ch'],
      originalChunks: ['Ngu\u1ED3n'],
      completedChunks: 1,
    });

    const result = await context.runHanAuditAfterTranslation();

    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(context.translationRequests).toHaveLength(0);
    expect(context.elements.hanAuditPanel.innerHTML).toContain('s\u1EA1ch H\u00E1n t\u1EF1');
  });

  it('auto-corrects every detected chunk in RPM-governed waves and defers the final rebuild', async () => {
    const assignments = [];
    const context = loadHanAuditRuntime({
      translatedChunks: ['C\u00F2n \u4E2D', 'C\u00F2n \u6587', 'C\u00F2n \u8A9E'],
      originalChunks: ['Ngu\u1ED3n 1', 'Ngu\u1ED3n 2', 'Ngu\u1ED3n 3'],
      completedChunks: 3,
      useProxy: true,
      buildTranslatorWaveAssignments(indices, plan) {
        assignments.push({ indices: [...indices], capacity: plan.capacity });
        return indices.map((chunkIndex, keyIndex) => ({ chunkIndex, keyIndex }));
      },
    });

    const result = await context.runHanAuditAfterTranslation();

    expect(result).toMatchObject({ ok: true, attempted: 3, succeeded: 3, remaining: 0 });
    expect(context.translationRequests.map(item => item.chunkIndex)).toEqual([0, 1, 2]);
    expect(context.translationRequests[0].request.rule).toContain('Do not leave any Han ideograph');
    expect(context.rpmPlans.map(plan => plan.remainingChunks)).toEqual([3, 1]);
    expect(assignments).toEqual([
      { indices: [0, 1], capacity: 2 },
      { indices: [2], capacity: 1 },
    ]);
    expect(context.getMaxActiveRequests()).toBe(2);
    expect(context.historyCalls).toHaveLength(0);
    expect(context.translatedChunks).toEqual([
      '\u0110\u00E3 d\u1ECBch chunk 1',
      '\u0110\u00E3 d\u1ECBch chunk 2',
      '\u0110\u00E3 d\u1ECBch chunk 3',
    ]);
  });

  it('runs one correction round only and leaves returned Han text for review', async () => {
    const context = loadHanAuditRuntime({
      translatedChunks: ['C\u00F2n \u4E2D'],
      originalChunks: ['Ngu\u1ED3n'],
      completedChunks: 1,
      async translateChunkWithRetry(request, chunkIndex) {
        context.translationRequests.push({ request, chunkIndex });
        return 'V\u1EABn c\u00F2n \u4E2D';
      },
    });

    const result = await context.runHanAuditAfterTranslation();

    expect(result).toMatchObject({ ok: true, attempted: 1, succeeded: 0, remaining: 1 });
    expect(context.translationRequests).toHaveLength(1);
    expect(context.elements.hanAuditPanel.innerHTML).toContain('C\u00F2n 1 chunk');
  });

  it('rebuilds derived output once after a manual correction batch', async () => {
    const context = loadHanAuditRuntime({
      isTranslating: false,
      translatedChunks: ['C\u00F2n \u4E2D', 'C\u00F2n \u6587'],
      originalChunks: ['Ngu\u1ED3n 1', 'Ngu\u1ED3n 2'],
      completedChunks: 2,
    });

    const scan = await context.runHanAuditManual();
    const result = await context.retryHanAuditIssues({ issues: scan.issues });

    expect(result).toMatchObject({ attempted: 2, succeeded: 2, remaining: 0 });
    expect(context.historyCalls).toHaveLength(1);
  });

  it('keeps untouched issues visible after retrying one selected chunk', async () => {
    const context = loadHanAuditRuntime({
      isTranslating: false,
      translatedChunks: ['C\u00F2n \u4E2D', 'C\u00F2n \u6587'],
      originalChunks: ['Ngu\u1ED3n 1', 'Ngu\u1ED3n 2'],
      completedChunks: 2,
    });

    await context.runHanAuditManual();
    const result = await context.retryHanAuditChunk(0);

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, remaining: 1 });
    expect(context.elements.hanAuditPanel.innerHTML).toContain('C\u00F2n 1 chunk');
    expect(context.elements.hanAuditPanel.innerHTML).toContain('#2');
  });

  it('stops before the next correction wave while preserving completed chunks', async () => {
    let context;
    let requestCount = 0;
    context = loadHanAuditRuntime({
      translatedChunks: ['C\u00F2n \u4E2D', 'C\u00F2n \u6587', 'C\u00F2n \u8A9E'],
      originalChunks: ['Ngu\u1ED3n 1', 'Ngu\u1ED3n 2', 'Ngu\u1ED3n 3'],
      completedChunks: 3,
      async translateChunkWithRetry(request, chunkIndex) {
        context.translationRequests.push({ request, chunkIndex });
        requestCount += 1;
        if (requestCount === 1) context.cancelHanAudit();
        return `\u0110\u00E3 d\u1ECBch chunk ${chunkIndex + 1}`;
      },
    });

    const result = await context.runHanAuditAfterTranslation();

    expect(result).toMatchObject({ ok: false, reason: 'cancelled', attempted: 2, remaining: 1 });
    expect(context.translationRequests).toHaveLength(2);
    expect(context.translatedChunks[2]).toContain('\u8A9E');
  });

  it('contains RPM dispatcher failures without failing the completed main translation', async () => {
    const context = loadHanAuditRuntime({
      translatedChunks: ['C\u00F2n \u4E2D'],
      originalChunks: ['Ngu\u1ED3n'],
      completedChunks: 1,
      async waitForTranslatorRpmBatchPlan() {
        throw new Error('No provider capacity');
      },
    });

    await expect(context.runHanAuditAfterTranslation()).resolves.toMatchObject({
      ok: false,
      reason: 'failed',
      attempted: 0,
      remaining: 1,
    });
    expect(context.translatedChunks[0]).toContain('\u4E2D');
    expect(context.translationRequests).toHaveLength(0);
  });

  it('discards a stale in-memory scan and retries once against the latest output', async () => {
    let context;
    let changed = false;
    context = loadHanAuditRuntime({
      isTranslating: false,
      translatedChunks: [`\u4E2D${'x'.repeat(70_000)}`],
      originalChunks: ['Ngu\u1ED3n'],
      setTimeout(callback) {
        if (!changed) {
          changed = true;
          context.translatedChunks[0] = 'B\u1EA3n d\u1ECBch m\u1EDBi s\u1EA1ch';
          context.translatorOutputGeneration += 1;
        }
        callback();
        return 1;
      },
    });

    const result = await context.runHanAuditManual();

    expect(result.error?.message).toBeUndefined();
    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(context.elements.hanAuditPanel.innerHTML).toContain('s\u1EA1ch H\u00E1n t\u1EF1');
  });

  it('falls back cooperatively when the worker cannot start', async () => {
    class BrokenWorker {
      constructor() {
        queueMicrotask(() => this.onerror?.({ message: 'worker unavailable' }));
      }
      postMessage() {}
      terminate() {}
    }
    const context = loadHanAuditRuntime({
      isTranslating: false,
      Worker: BrokenWorker,
      translatedChunks: ['B\u1EA3n d\u1ECBch s\u1EA1ch'],
      originalChunks: ['Ngu\u1ED3n'],
    });

    const result = await context.runHanAuditManual();

    expect(result.error?.message).toBeUndefined();
    expect(result).toMatchObject({ ok: true, issues: [] });
  });

  it('uses the live bounded memory path when session IndexedDB is unavailable', async () => {
    const context = loadHanAuditRuntime({
      isTranslating: false,
      currentTranslatorSessionId: 'session-unavailable',
      translatedChunks: ['B\u1EA3n d\u1ECBch s\u1EA1ch'],
      originalChunks: ['Ngu\u1ED3n'],
      async getTranslatorSession() {
        throw new Error('IndexedDB unavailable');
      },
      async scanTranslatorSessionOutputRows() {
        throw new Error('IndexedDB unavailable');
      },
    });

    const result = await context.runHanAuditManual();

    expect(result).toMatchObject({ ok: true, issues: [] });
  });

  it('reports old flat history without chunk mapping instead of guessing offsets', async () => {
    const context = loadHanAuditRuntime({
      isTranslating: false,
      translatedChunks: [],
      originalChunks: [],
    });

    const result = await context.runHanAuditManual();

    expect(result).toMatchObject({ ok: false, reason: 'missing_chunk_mapping' });
    expect(context.elements.hanAuditPanel.innerHTML).toContain('kh\u00F4ng c\u00F2n \u00E1nh x\u1EA1 chunk');
  });

  it('targets the history record most recently created or opened', () => {
    const context = loadHanAuditRuntime({
      currentHistoryId: 'stale-history',
      lastTranslatorHistoryId: 'opened-history',
    });

    expect(context.getHanAuditHistoryId()).toBe('opened-history');
  });

  it('escapes detected previews before placing them in chip attributes', async () => {
    const context = loadHanAuditRuntime({
      isTranslating: false,
      translatedChunks: ['C\u00F2n \u4E2D" onmouseover="alert(1)'],
      originalChunks: ['Ngu\u1ED3n'],
      escapeHtmlAttribute: value => String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'),
    });

    await context.runHanAuditManual();

    expect(context.elements.hanAuditPanel.innerHTML).toContain('&quot; onmouseover=&quot;');
    expect(context.elements.hanAuditPanel.innerHTML).not.toContain('title="C\u00F2n \u4E2D" onmouseover=');
  });
});
