import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadSnapshotRuntime(overrides = {}) {
  const context = {
    Array,
    Blob,
    Math,
    Number,
    Object,
    Promise,
    String,
    ...overrides,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  const relativePath = 'public/translator-runtime/js/chapter/chapter-snapshot.js';
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    context,
    { filename: relativePath },
  );
  return context.TranslatorChapterSnapshot;
}

describe('Translator chapter snapshots', () => {
  it('wraps a source Blob without reading or copying its full text', async () => {
    const snapshotApi = loadSnapshotRuntime();
    let fullTextCalls = 0;
    const blob = new Blob(['Nội dung nguồn']);
    blob.text = async () => {
      fullTextCalls += 1;
      return 'Nội dung nguồn';
    };

    const snapshot = await snapshotApi.createSourceSnapshot({
      blob,
      fileName: 'truyen.txt',
      revision: 'source:1',
    });

    expect(snapshot).toMatchObject({
      blob,
      fileName: 'truyen.txt',
      kind: 'source',
      partial: false,
      partialReason: null,
      revision: 'source:1',
    });
    expect(fullTextCalls).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('sorts rows numerically and exports only the contiguous done prefix from session.startChunkIndex', async () => {
    const snapshotApi = loadSnapshotRuntime();
    const rows = [
      { chunkIndex: 4, status: 'done', outputText: 'Bốn' },
      { chunkIndex: 2, status: 'done', outputText: 'Hai' },
      { chunkIndex: 3, status: 'pending', outputText: '' },
    ];

    const snapshot = await snapshotApi.createTranslatedSnapshot({
      session: {
        fileName: 'truyen.txt',
        startChunkIndex: 2,
        totalChunks: 5,
        isComplete: false,
      },
      rows,
      revision: 7,
    });

    await expect(snapshot.blob.text()).resolves.toBe('Hai');
    expect(snapshot).toMatchObject({
      kind: 'translated',
      partial: true,
      partialReason: 'gap',
      completedChunks: 1,
      totalChunks: 3,
      revision: 7,
    });
  });

  it('stops at a failed chunk and never splices a later success across the failure', async () => {
    const snapshotApi = loadSnapshotRuntime();

    const snapshot = await snapshotApi.createTranslatedSnapshot({
      session: {
        fileName: 'truyen.txt',
        startChunkIndex: 0,
        totalChunks: 3,
        isComplete: false,
      },
      rows: [
        { chunkIndex: 0, status: 'done', outputText: 'Một' },
        { chunkIndex: 1, status: 'failed', outputText: '[LỗI CHUNK 2]' },
        { chunkIndex: 2, status: 'done', outputText: 'Ba' },
      ],
    });

    await expect(snapshot.blob.text()).resolves.toBe('Một');
    expect(snapshot).toMatchObject({
      partial: true,
      partialReason: 'failed',
      completedChunks: 1,
      totalChunks: 3,
    });
  });

  it('is immutable when translation rows later change and marks a complete contiguous result', async () => {
    const snapshotApi = loadSnapshotRuntime();
    const rows = [
      { chunkIndex: 1, status: 'done', outputText: 'Chương 1\nA' },
      { chunkIndex: 2, status: 'done', outputText: 'Chương 2\nB' },
    ];

    const snapshot = await snapshotApi.createTranslatedSnapshot({
      session: {
        fileName: 'truyen.txt',
        startChunkIndex: 1,
        totalChunks: 3,
        isComplete: true,
      },
      rows,
      revision: 11,
    });
    rows[0].outputText = 'Bị sửa sau snapshot';
    rows.push({ chunkIndex: 3, status: 'done', outputText: 'Mới' });

    await expect(snapshot.blob.text()).resolves.toBe('Chương 1\nA\n\nChương 2\nB');
    expect(snapshot).toMatchObject({
      partial: false,
      partialReason: null,
      completedChunks: 2,
      totalChunks: 2,
      revision: 11,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('falls back to the live contiguous memory rows when IndexedDB output scanning is unavailable', async () => {
    const snapshotApi = loadSnapshotRuntime({
      currentTranslatorSessionId: 'session-unavailable',
      isTranslating: false,
      originalFileName: 'memory.txt',
      totalChunksCount: 3,
      translatedChunks: [null, 'Chương 2\nHai', 'Chương 3\nBa'],
      translationStartChunkIndex: 1,
      async getTranslatorSession() {
        throw new Error('IndexedDB unavailable');
      },
      async scanTranslatorSessionOutputRows() {
        throw new Error('IndexedDB unavailable');
      },
    });

    const snapshot = await snapshotApi.createCurrentTranslatedSnapshot();

    await expect(snapshot.blob.text()).resolves.toBe('Chương 2\nHai\n\nChương 3\nBa');
    expect(snapshot).toMatchObject({
      partial: false,
      completedChunks: 2,
      totalChunks: 2,
    });
  });
});
