import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadWorkerRuntime(overrides = {}) {
  const messages = [];
  const imports = [];
  let messageHandler = null;
  const context = {
    Blob,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    Uint8Array,
    TranslatorChapterIndexer: {
      scanChapterBlob: overrides.scanChapterBlob || vi.fn(async () => ({ chapters: [] })),
      findHeadingInBlob: overrides.findHeadingInBlob || vi.fn(async () => ({ matches: [] })),
    },
    TranslatorChapterEpub: {
      buildChapterEpub: overrides.buildChapterEpub || vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: 'book.epub',
      })),
    },
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    importScripts(...urls) {
      imports.push(...urls);
      if (urls.includes('../../vendor/jszip.min.js')) context.JSZip = function JSZip() {};
    },
    postMessage(message, transfer) {
      messages.push({ message, transfer });
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  const file = 'public/translator-runtime/js/chapter/chapter-worker.js';
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), file), 'utf8'), context, { filename: file });
  return {
    context,
    imports,
    messages,
    send: data => messageHandler({ data }),
  };
}

describe('Translator chapter Worker protocol', () => {
  it('throttles scan progress, reports completion and does not load JSZip', async () => {
    const scanChapterBlob = vi.fn(async (_blob, options) => {
      options.onProgress({ completed: 1, total: 10 });
      options.onProgress({ completed: 2, total: 10 });
      options.onProgress({ completed: 10, total: 10 });
      return { chapters: [{ title: 'Nội dung' }] };
    });
    const runtime = loadWorkerRuntime({ scanChapterBlob });

    await runtime.send({ type: 'scan', requestId: 'scan-1', blob: new Blob(['abc']) });

    expect(runtime.imports).toEqual([
      'chapter-rules.js',
      'chapter-indexer.js',
      'chapter-epub.js',
    ]);
    expect(runtime.messages.map(item => item.message.type)).toEqual(['progress', 'progress', 'complete']);
    expect(runtime.messages.slice(0, 2).map(item => item.message.progress)).toEqual([0.1, 1]);
    expect(runtime.messages.at(-1).message.result.chapters[0].title).toBe('Nội dung');
  });

  it('loads JSZip lazily once and transfers EPUB bytes', async () => {
    const buildChapterEpub = vi.fn(async (_payload, dependencies) => {
      expect(dependencies.JSZip).toBeTypeOf('function');
      return { bytes: new Uint8Array([80, 75]), fileName: 'truyen.epub' };
    });
    const runtime = loadWorkerRuntime({ buildChapterEpub });

    await runtime.send({ type: 'exportEpub', requestId: 'epub-1', payload: {} });
    await runtime.send({ type: 'exportEpub', requestId: 'epub-2', payload: {} });

    expect(runtime.imports.filter(url => url === '../../vendor/jszip.min.js')).toHaveLength(1);
    const completions = runtime.messages.filter(item => item.message.type === 'complete');
    expect(completions).toHaveLength(2);
    expect(completions[0].message.result.fileName).toBe('truyen.epub');
    expect(completions[0].transfer).toHaveLength(1);
  });

  it('acknowledges cancel and returns bounded errors for invalid requests', async () => {
    const runtime = loadWorkerRuntime();

    await runtime.send({ type: 'cancel', requestId: 'cancel-1' });
    await runtime.send({ type: 'unknown', requestId: 'bad-1' });

    expect(runtime.messages[0].message).toMatchObject({
      type: 'complete',
      requestId: 'cancel-1',
      cancelled: true,
    });
    expect(runtime.messages[1].message).toMatchObject({
      type: 'error',
      requestId: 'bad-1',
    });
    expect(runtime.messages[1].message.message).toMatch(/không hợp lệ/i);
  });
});
