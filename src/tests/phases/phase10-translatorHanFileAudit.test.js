import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

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
  it('keeps automatic post-translation audit and adds one uploaded-file feature surface', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const engine = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/engine.js'), 'utf8');
    const worker = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/han-audit-worker.js'), 'utf8');
    const init = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');

    expect(engine.match(/await runHanAuditAfterTranslation\(\);/g)).toHaveLength(2);
    expect(html).toContain('Quét Hán tự trong file đã dịch');
    expect(html).toContain('id="hanFileAudit"');
    expect(html).toContain('js/translation/han-audit/file-source.js');
    expect(html).toContain('js/translation/han-audit/correction-runner.js');
    expect(html).toContain('js/translation/han-audit/file-feature.js');
    expect(worker).toContain("message.type === 'scan-file'");
    expect(init).toContain('openHanFileAudit');
    expect(init).toContain('correctAllHanFileIssues');
  });
});
