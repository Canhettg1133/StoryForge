import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const repoRoot = process.cwd();
const SLICE_BYTES = 256 * 1024;

function loadFileAuditCore() {
  const context = {
    Array,
    ArrayBuffer,
    Blob,
    Date,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  for (const relativePath of [
    'public/translator-runtime/js/translation/source-reader.js',
    'public/translator-runtime/js/translation/han-audit-core.js',
    'public/translator-runtime/js/translation/han-audit/file-source.js',
    'public/translator-runtime/js/translation/han-audit/correction-runner.js',
    'public/translator-runtime/js/translation/han-audit/file-feature.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
      context,
      { filename: relativePath },
    );
  }
  return context;
}

function loadFileAuditUiHarness() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="hanFileAudit" hidden>
      <button id="closeHanFileAuditBtn"></button>
      <div id="hanFileAuditWarning"></div>
      <div id="hanFileAuditProgress"><span id="hanFileAuditProgressFill"></span></div>
      <strong id="hanFileAuditSummary"></strong><span id="hanFileAuditMeta"></span>
      <span id="hanFileAuditIssueCount"></span><div id="hanFileAuditLayout"></div>
      <div id="hanFileAuditIssueViewport"><div id="hanFileAuditIssueCanvas"></div></div>
      <h3 id="hanFileAuditChunkTitle"></h3><span id="hanFileAuditChunkState"></span>
      <span id="hanFileAuditPosition"></span><button id="previousHanFileIssueBtn"></button>
      <button id="nextHanFileIssueBtn"></button><div id="hanFileAuditChunkText"></div>
      <button id="correctAllHanFileBtn"></button><button id="correctOneHanFileBtn"></button>
      <button id="cancelHanFileBtn"></button><button id="downloadHanFileBtn"></button>
      <p id="hanFileAuditStatus"></p><span id="hanFileAuditFileName"></span>
    </div>
    <section id="hanFileAuditSessionPanel" hidden>
      <h2 id="hanFileSessionTitle"></h2><strong id="hanFileSessionFile"></strong>
      <p id="hanFileSessionMeta"></p><div id="hanFileSessionProgress"><span id="hanFileSessionProgressFill"></span></div>
      <button id="cancelHanFileSessionBtn"></button><button id="correctAllHanFileSessionBtn"></button>
      <button id="downloadHanFileSessionBtn"></button>
    </section>
  </body>`);
  const workers = [];
  const source = new Blob(['Đây là bản dịch đã sạch.'], { type: 'text/plain;charset=utf-8' });
  Object.defineProperty(source, 'name', { value: '非常非常非常長的翻譯小說名稱.txt' });
  Object.defineProperty(source, 'lastModified', { value: 123 });

  class ControlledWorker {
    constructor() {
      this.listeners = new Map();
      this.requestId = '';
      workers.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(message) {
      this.requestId = message.requestId;
    }

    emit(data) {
      this.listeners.get('message')?.({ data });
    }

    terminate() {}
  }

  const context = {
    Array,
    ArrayBuffer,
    Blob,
    Date,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
    document: dom.window.document,
    Worker: ControlledWorker,
    setTimeout,
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    addEventListener() {},
    async getCurrentTranslatorSource() {
      return source;
    },
    getCurrentChunkSizeValue() {
      return 4500;
    },
    buildHanCorrectionRequest(text) {
      return text;
    },
    showToast() {},
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  vm.createContext(context);
  for (const relativePath of [
    'public/translator-runtime/js/translation/source-reader.js',
    'public/translator-runtime/js/translation/han-audit-core.js',
    'public/translator-runtime/js/translation/han-audit/file-source.js',
    'public/translator-runtime/js/translation/han-audit/correction-runner.js',
    'public/translator-runtime/js/translation/han-audit/file-feature.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
      context,
      { filename: relativePath },
    );
  }
  return { context, workers };
}

class TrackingBlob extends Blob {
  constructor(parts) {
    super(parts, { type: 'text/plain;charset=utf-8' });
    this.fullTextCalls = 0;
    this.sliceCalls = [];
  }

  async text() {
    this.fullTextCalls += 1;
    return super.text();
  }

  slice(start, end, type) {
    this.sliceCalls.push({ start, end });
    return super.slice(start, end, type);
  }
}

function loadWorkerHarness() {
  const messages = [];
  let messageListener = null;
  const context = {
    Array,
    ArrayBuffer,
    Blob,
    Date,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  context.self = context;
  context.postMessage = message => messages.push(message);
  context.addEventListener = (type, listener) => {
    if (type === 'message') messageListener = listener;
  };
  vm.createContext(context);
  const loaded = new Set();
  context.importScripts = (...urls) => {
    for (const url of urls) {
      const relative = String(url).split('?')[0];
      if (loaded.has(relative)) continue;
      loaded.add(relative);
      const fullPath = path.join(repoRoot, 'public/translator-runtime/js/translation', relative);
      vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: relative });
    }
  };
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit-worker.js'), 'utf8'),
    context,
    { filename: 'han-audit-worker.js' },
  );
  return {
    messages,
    send(message) {
      messageListener?.({ data: message });
    },
  };
}

async function waitForMessage(harness, predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = harness.messages.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for Han audit Worker message.');
}

describe('Translator Han file source', () => {
  it('streams a Blob once and returns compact issue metadata without retaining chunk text', async () => {
    const context = loadFileAuditCore();
    const fixture = `${'a'.repeat(SLICE_BYTES - 2)}😀\r\nCòn 中文.\r\n${'b'.repeat(24_000)}`;
    const blob = new TrackingBlob([fixture]);
    const snapshot = await context.TranslatorHanFileSource.createSnapshot(blob, {
      fileName: 'da-dich.txt',
      chunkSize: 4500,
      revision: 7,
    });

    const result = await context.TranslatorHanFileSource.scanSnapshot(snapshot);

    expect(result.totalHan).toBe(2);
    expect(result.totalCodePoints).toBeGreaterThan(250_000);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ hanCount: 2, status: 'pending' });
    expect(result.issues[0]).not.toHaveProperty('text');
    expect(result.issues[0]).not.toHaveProperty('preview');
    expect(result.issues[0]).not.toHaveProperty('ranges');
    expect(blob.fullTextCalls).toBe(0);
    expect(result.bytesRead).toBe(blob.size);
    expect(blob.sliceCalls.every(call => call.end - call.start <= SLICE_BYTES)).toBe(true);
    expect(blob.sliceCalls.reduce((sum, call) => sum + call.end - call.start, 0)).toBeLessThanOrEqual(blob.size + 3);
  });

  it('keeps the UTF-8 BOM and untouched bytes while composing corrected and partial downloads', async () => {
    const context = loadFileAuditCore();
    const encoder = new TextEncoder();
    const original = new Uint8Array([
      0xEF, 0xBB, 0xBF,
      ...encoder.encode('Còn 中\r\nĐoạn sạch 😀\r\n'),
    ]);
    const blob = new Blob([original], { type: 'text/plain;charset=utf-8' });
    const snapshot = await context.TranslatorHanFileSource.createSnapshot(blob, {
      fileName: 'ban-dich.txt',
      chunkSize: 4500,
    });
    const issueEnd = 3 + encoder.encode('Còn 中\r\n').length;
    const issue = { chunkIndex: 0, byteStart: 0, byteEnd: issueEnd };
    const replacements = new Map([
      [0, context.TranslatorHanFileSource.createReplacement(issue, 'Đã sửa\r\n')],
    ]);

    const output = context.TranslatorHanFileSource.buildOutputBlob(snapshot, replacements);
    const bytes = new Uint8Array(await output.arrayBuffer());

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);
    await expect(output.text()).resolves.toBe('Đã sửa\r\nĐoạn sạch 😀\r\n');
    await expect(blob.text()).resolves.toBe('Còn 中\r\nĐoạn sạch 😀\r\n');
    expect(context.TranslatorHanFileSource.makeOutputFileName(snapshot, 0)).toBe('ban-dich-da-sua-han-tu.txt');
    expect(context.TranslatorHanFileSource.makeOutputFileName(snapshot, 1)).toBe('ban-dich-da-sua-han-tu-ban-tam.txt');
  });

  it('retries from the latest replacement instead of returning to the uploaded original chunk', async () => {
    const context = loadFileAuditCore();
    const blob = new Blob(['Còn 中文.'], { type: 'text/plain;charset=utf-8' });
    const snapshot = await context.TranslatorHanFileSource.createSnapshot(blob, {
      fileName: 'retry.txt',
      chunkSize: 4500,
    });
    const issue = { chunkIndex: 0, byteStart: 0, byteEnd: blob.size };
    const replacements = new Map([
      [0, context.TranslatorHanFileSource.createReplacement(issue, 'Vẫn còn 中.')],
    ]);

    await expect(context.TranslatorHanFileSource.readEffectiveChunk(snapshot, issue, replacements))
      .resolves.toBe('Vẫn còn 中.');
  });

  it('throttles scan progress to four updates per second plus the final update', async () => {
    const context = loadFileAuditCore();
    const blob = new Blob(['Đoạn sạch.\n'.repeat(120_000)], { type: 'text/plain;charset=utf-8' });
    const snapshot = await context.TranslatorHanFileSource.createSnapshot(blob, {
      fileName: 'progress.txt',
      chunkSize: 4500,
    });
    let clock = 0;
    const progress = [];

    await context.TranslatorHanFileSource.scanSnapshot(snapshot, {
      now: () => {
        clock += 50;
        return clock;
      },
      onProgress(update) {
        progress.push({ clock, ...update });
      },
    });

    expect(progress.at(-1)?.ratio).toBe(1);
    for (let index = 1; index < progress.length - 1; index += 1) {
      expect(progress[index].clock - progress[index - 1].clock).toBeGreaterThanOrEqual(250);
    }
  });
});

describe('Translator Han file audit virtual list', () => {
  it('never asks the UI to render more than 60 issue rows', () => {
    const context = loadFileAuditCore();
    const virtual = context.TranslatorHanFileFeatureUtils.computeVirtualWindow(
      50_000,
      830_000,
      900,
      { overscan: 12 },
    );

    expect(virtual.end - virtual.start).toBeLessThanOrEqual(60);
    expect(virtual.totalHeight).toBe(50_000 * 54);
  });
});

describe('Translator Han file audit worker', () => {
  it('supports compact scan-file results and cooperative cancel without changing session protocols', async () => {
    const harness = loadWorkerHarness();
    harness.send({
      type: 'scan-file',
      requestId: 'scan-1',
      blob: new Blob([`${'a'.repeat(300_000)} còn 中.`]),
      fileName: 'worker.txt',
      chunkSize: 4500,
    });

    const complete = await waitForMessage(
      harness,
      message => message.requestId === 'scan-1' && message.type === 'complete',
    );
    expect(complete.totalHan).toBe(1);
    expect(complete.issues).toHaveLength(1);
    expect(complete.issues[0]).not.toHaveProperty('text');

    harness.send({
      type: 'scan-file',
      requestId: 'scan-2',
      blob: new Blob(['中'.repeat(500_000)]),
      fileName: 'cancel.txt',
      chunkSize: 4500,
    });
    harness.send({ type: 'cancel', requestId: 'scan-2' });
    await expect(waitForMessage(
      harness,
      message => message.requestId === 'scan-2' && message.type === 'cancelled',
    )).resolves.toMatchObject({ requestId: 'scan-2', type: 'cancelled' });
  });
});

describe('Translator shared Han correction runner', () => {
  it('exposes one neutral runner while preserving the Han compatibility alias', () => {
    const context = loadFileAuditCore();

    expect(context.TranslatorCorrectionRunner).toBe(context.TranslatorHanCorrectionRunner);
  });

  it('continues across every RPM-governed wave without requiring another click', async () => {
    const context = loadFileAuditCore();
    const plans = [];
    const waves = [];
    const items = [0, 1, 2, 3, 4].map(chunkIndex => ({ chunkIndex }));

    const result = await context.TranslatorHanCorrectionRunner.run({
      items,
      requestedParallel: 4,
      async getPlan(options) {
        plans.push(options);
        return { capacity: Math.min(2, options.remainingChunks) };
      },
      assignWave(wave) {
        waves.push(wave.map(item => item.chunkIndex));
      },
      async correctItem(item) {
        return { ok: true, chunkIndex: item.chunkIndex };
      },
    });

    expect(plans.map(plan => plan.remainingChunks)).toEqual([5, 3, 1]);
    expect(waves).toEqual([[0, 1], [2, 3], [4]]);
    expect(result).toMatchObject({ processed: 5, cancelled: false });
    expect(result.results).toHaveLength(5);
  });

  it('uses RPM-governed waves and stops before the next wave after cancellation', async () => {
    const context = loadFileAuditCore();
    const plans = [];
    const waves = [];
    const completed = [];
    let cancelled = false;
    const items = [0, 1, 2, 3, 4].map(chunkIndex => ({ chunkIndex }));

    const result = await context.TranslatorHanCorrectionRunner.run({
      items,
      requestedParallel: 3,
      async getPlan(options) {
        plans.push(options);
        return { capacity: Math.min(2, options.remainingChunks) };
      },
      assignWave(wave) {
        waves.push(wave.map(item => item.chunkIndex));
      },
      async correctItem(item) {
        completed.push(item.chunkIndex);
        if (item.chunkIndex === 2) cancelled = true;
        return { ok: true, chunkIndex: item.chunkIndex };
      },
      shouldCancel: () => cancelled,
    });

    expect(plans.map(plan => plan.remainingChunks)).toEqual([5, 3]);
    expect(waves).toEqual([[0, 1], [2, 3]]);
    expect(completed).toEqual([0, 1, 2, 3]);
    expect(result).toMatchObject({ processed: 4, cancelled: true });
    expect(result.results).toHaveLength(4);
  });
});

describe('Translator Han file audit integration contract', () => {
  it('continues a scan after closing details and reports completion in the session card', async () => {
    const { context, workers } = loadFileAuditUiHarness();

    const openResult = context.TranslatorHanFileFeature.open();
    while (workers.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
    context.TranslatorHanFileFeature.close();

    expect(context.document.getElementById('hanFileAudit').hidden).toBe(true);
    expect(context.isHanFileAuditBusy).toBe(true);

    const worker = workers[0];
    worker.emit({
      type: 'complete',
      requestId: worker.requestId,
      issues: [],
      totalHan: 0,
      totalCodePoints: 24,
      totalChunks: 1,
    });

    await expect(openResult).resolves.toMatchObject({ ok: true, issues: [] });
    expect(context.isHanFileAuditBusy).toBe(false);
    expect(context.document.getElementById('hanFileAuditSessionPanel').hidden).toBe(false);
    expect(context.document.getElementById('hanFileSessionMeta').textContent).toContain('File không còn Hán tự');
  });

  it('continues a correction after closing details and keeps the completed replacement', async () => {
    const { context, workers } = loadFileAuditUiHarness();
    const openResult = context.TranslatorHanFileFeature.open();
    while (workers.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
    const worker = workers[0];
    worker.emit({
      type: 'complete',
      requestId: worker.requestId,
      issues: [{ chunkIndex: 0, byteStart: 0, byteEnd: 32, hanCount: 1, status: 'pending', error: '' }],
      totalHan: 1,
      totalCodePoints: 24,
      totalChunks: 1,
    });
    await openResult;

    let releaseTranslation;
    context.translateChunkWithRetry = () => new Promise(resolve => {
      releaseTranslation = resolve;
    });
    const correction = context.TranslatorHanFileFeature.correctAll();
    while (!releaseTranslation) await new Promise(resolve => setTimeout(resolve, 0));
    context.TranslatorHanFileFeature.close();
    releaseTranslation('Đã sửa sạch hoàn toàn.');

    await expect(correction).resolves.toMatchObject({ ok: true, processed: 1, remaining: 0 });
    expect(context.document.getElementById('hanFileAudit').hidden).toBe(true);
    expect(context.document.getElementById('hanFileSessionMeta').textContent).toContain('Đã sửa sạch toàn bộ Hán tự');
  });

  it('keeps automatic post-translation audit and adds one uploaded-file feature surface', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const engine = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/engine.js'), 'utf8');
    const worker = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit-worker.js'), 'utf8');
    const init = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');

    expect(engine.match(/await runHanAuditAfterTranslation\(schedulingContext\);/g)).toHaveLength(2);
    expect(html).toContain('Quét Hán tự trong file đã dịch');
    expect(html).toContain('id="hanFileAudit"');
    expect(html).toContain('js/translation/han-audit/file-source.js');
    expect(html).toContain('js/translation/han-audit/correction-runner.js');
    expect(html).toContain('js/translation/han-audit/file-feature.js');
    expect(worker).toContain("message.type === 'scan-file'");
    expect(init).toContain('openHanFileAudit');
    expect(init).toContain('correctAllHanFileIssues');
    expect(html).toContain('id="hanFileAuditSessionPanel"');
    expect(html).toContain('data-click-action="cancelHanFileAudit"');
  });

  it('keeps close non-destructive while a scan or correction continues in the background', () => {
    const feature = fs.readFileSync(
      path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit/file-feature.js'),
      'utf8',
    );
    const closeStart = feature.indexOf('function close() {');
    const resetStart = feature.indexOf('function reset() {', closeStart);
    const closeFunction = feature.slice(closeStart, resetStart);

    expect(closeStart).toBeGreaterThan(-1);
    expect(resetStart).toBeGreaterThan(closeStart);
    expect(closeFunction).toContain('modal.hidden = true');
    expect(closeFunction).not.toContain('cancel();');
    expect(closeFunction).not.toContain("state.selectedText = ''");
    expect(closeFunction).not.toContain('state.selectedLoadToken += 1');
  });

  it('keeps the session card responsive for long CJK file names and narrow screens', () => {
    const css = fs.readFileSync(
      path.join(repoRoot, 'public/translator-runtime/han-audit-file.css'),
      'utf8',
    );

    expect(css).toContain('.han-file-session');
    expect(css).toContain('.han-file-session__file');
    expect(css).toMatch(/\.han-file-session__file\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/\.han-file-session__actions\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/\.han-file-audit__header\s*>\s*div\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/\.han-file-audit__close\s*\{[^}]*flex:\s*0\s+0\s+44px;/s);
    expect(css).toContain('@media (max-width: 480px)');
  });
});
