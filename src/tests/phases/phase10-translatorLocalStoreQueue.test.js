import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../public/translator-runtime/js/translation/source-reader.js';
import '../../../public/translator-runtime/js/translation/local-store.js';

const {
  clearTranslatorLocalStoreForTests,
  createTranslatorSessionFromFile,
  enqueueTranslatorSession,
  getTranslatorSessionSource,
  getTranslatorSessionChunks,
  getTranslatorSessionOutputParts,
  getTranslatorQueueItems,
  markTranslatorChunksBefore,
  searchTranslatorSessionChunks,
  updateTranslatorChunkResult,
  updateTranslatorQueueItemStatus,
  claimNextTranslatorQueueItem,
  DB_NAME,
  persistTranslatorChunkBatch,
  reorderTranslatorQueueItems,
  summarizeTranslatorChunks,
} = globalThis.TranslatorLocalStore;

class TrackingFile extends Blob {
  constructor(parts, options = {}) {
    super(parts, { type: 'text/plain;charset=utf-8' });
    this.name = options.name || 'truyen.txt';
    this.lastModified = options.lastModified || 1710000000000;
    this.fullTextCalls = 0;
    this.sliceCalls = [];
  }

  async text() {
    this.fullTextCalls += 1;
    return super.text();
  }

  slice(start, end, contentType) {
    this.sliceCalls.push({ start, end });
    return super.slice(start, end, contentType);
  }
}

function makeLargeText(targetBytes, marker = 'Mốc tìm kiếm nằm ở cuối truyện.') {
  const paragraph = 'Lâm Phong bước qua màn mưa, giữ chặt thanh kiếm cũ và nhớ lời hẹn ở Trường An.\n\n';
  const repeated = paragraph.repeat(Math.ceil(targetBytes / paragraph.length));
  return `${repeated.slice(0, Math.max(0, targetBytes - marker.length - 16))}\n\n${marker}`;
}

describe('translator local store and queue', () => {
  beforeEach(async () => {
    await clearTranslatorLocalStoreForTests();
  });

  it('stores a large source once and does not eager-index source chunks', async () => {
    const marker = 'Từ khóa bí mật nằm ở chương giữa.';
    const file = new TrackingFile([makeLargeText(20 * 1024 * 1024, marker)], {
      name: 'truyen-20mb.txt',
      lastModified: 1710000000123,
    });

    const session = await createTranslatorSessionFromFile(file, {
      chunkSize: 4500,
      windowBytes: 256000,
      minWindowBytes: 256000,
    });

    expect(file.fullTextCalls).toBe(0);
    expect(file.sliceCalls.length).toBeLessThanOrEqual(2);
    expect(file.sliceCalls[0].end - file.sliceCalls[0].start).toBeLessThanOrEqual(64 * 1024);
    expect(session.estimatedChunks).toBeGreaterThan(10);
    expect(session.totalChunksExact).toBe(false);
    expect(session.fileFingerprint).toContain('truyen-20mb.txt');
    expect(session).not.toHaveProperty('sourceBlob');

    expect(await getTranslatorSessionChunks(session.id)).toEqual([]);
    expect(await getTranslatorSessionSource(session.id)).toBeTruthy();
  });

  it('upserts a new output-only row without requiring a pre-indexed source chunk', async () => {
    const session = await createTranslatorSessionFromFile(new TrackingFile(['Một\n\nHai']), {
      chunkSize: 5,
    });

    const updated = await updateTranslatorChunkResult(session.id, 0, {
      byteStart: 0,
      byteEnd: 3,
      sourcePreview: 'Một',
      status: 'done',
      outputText: 'One',
    });

    expect(updated).toMatchObject({
      chunkIndex: 0,
      status: 'done',
      outputText: 'One',
    });
    expect(updated).not.toHaveProperty('sourceText');
  });

  it('writes 1,000 output rows in one transaction without getAll in the hot path', async () => {
    const session = await createTranslatorSessionFromFile(new TrackingFile(['Nguồn']), { chunkSize: 5 });
    const rows = Array.from({ length: 1000 }, (_, chunkIndex) => ({
      chunkIndex,
      byteStart: chunkIndex,
      byteEnd: chunkIndex + 1,
      status: 'done',
      outputText: `Output ${chunkIndex}`,
    }));
    const originalTransaction = IDBDatabase.prototype.transaction;
    const originalGetAll = IDBObjectStore.prototype.getAll;
    let transactionCount = 0;
    let getAllCount = 0;

    IDBDatabase.prototype.transaction = function (...args) {
      transactionCount += 1;
      return originalTransaction.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      getAllCount += 1;
      return originalGetAll.apply(this, args);
    };
    try {
      await persistTranslatorChunkBatch(session.id, rows, {
        completedChunks: rows.length,
        totalChunks: rows.length,
        totalChunksExact: true,
      });
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
      IDBObjectStore.prototype.getAll = originalGetAll;
    }

    expect(transactionCount).toBe(1);
    expect(getAllCount).toBe(0);
    expect(await getTranslatorSessionChunks(session.id)).toHaveLength(1000);
  });

  it('lazily migrates a v1 session without losing source, output or queue state', async () => {
    await clearTranslatorLocalStoreForTests();
    const legacyDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const sessions = db.createObjectStore('translationSessions', { keyPath: 'id' });
        sessions.createIndex('status', 'status', { unique: false });
        sessions.createIndex('updatedAt', 'updatedAt', { unique: false });
        const chunks = db.createObjectStore('translationChunks', { keyPath: 'id' });
        chunks.createIndex('sessionId', 'sessionId', { unique: false });
        chunks.createIndex('sessionStatus', ['sessionId', 'status'], { unique: false });
        const queue = db.createObjectStore('translationQueue', { keyPath: 'id' });
        queue.createIndex('status', 'status', { unique: false });
        queue.createIndex('position', 'position', { unique: false });
        queue.createIndex('sessionId', 'sessionId', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const legacyTx = legacyDb.transaction(['translationSessions', 'translationChunks', 'translationQueue'], 'readwrite');
    legacyTx.objectStore('translationSessions').put({
      id: 'legacy-session',
      sourceBlob: { legacy: true },
      fileName: 'legacy.txt',
      fileSize: 12,
      startChunkIndex: 0,
      totalChunks: 1,
      completedChunks: 1,
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });
    legacyTx.objectStore('translationChunks').put({
      id: 'legacy-session:0',
      sessionId: 'legacy-session',
      chunkIndex: 0,
      sourceText: 'Nguồn cũ',
      outputText: 'Bản dịch cũ',
      status: 'done',
    });
    legacyTx.objectStore('translationQueue').put({
      id: 'legacy-queue',
      sessionId: 'legacy-session',
      status: 'paused',
      position: 1,
    });
    await new Promise((resolve, reject) => {
      legacyTx.oncomplete = resolve;
      legacyTx.onerror = () => reject(legacyTx.error);
    });
    legacyDb.close();

    const migrated = await globalThis.TranslatorLocalStore.getTranslatorSession('legacy-session');
    expect(migrated).not.toHaveProperty('sourceBlob');
    expect(await getTranslatorSessionSource('legacy-session')).toEqual({ legacy: true });
    expect((await getTranslatorSessionChunks('legacy-session'))[0].outputText).toBe('Bản dịch cũ');
    expect((await getTranslatorQueueItems())[0]).toMatchObject({ status: 'paused', position: 1 });
  });

  it('stores skipped chunks and builds downloadable output only from translated chunks', async () => {
    const file = new TrackingFile([
      'Một\n\nHai\n\nBa\n\nBốn\n\nNăm',
    ]);
    const session = await createTranslatorSessionFromFile(file, {
      chunkSize: 5,
      windowBytes: 32,
      minWindowBytes: 32,
    });

    await markTranslatorChunksBefore(session.id, 2);
    await updateTranslatorChunkResult(session.id, 2, {
      status: 'done',
      outputText: 'Ba đã dịch',
    });
    await updateTranslatorChunkResult(session.id, 3, {
      status: 'done',
      outputText: 'Bốn đã dịch',
    });

    const chunks = await getTranslatorSessionChunks(session.id);
    expect(chunks.map(chunk => chunk.chunkIndex)).toEqual([2, 3]);
    expect(chunks.every(chunk => chunk.status === 'done')).toBe(true);

    const parts = await getTranslatorSessionOutputParts(session.id);
    expect(parts.join('')).toBe('Ba đã dịch\n\nBốn đã dịch');
  });

  it('counts preserved output plus the selected translation scope without completing early', () => {
    const summary = summarizeTranslatorChunks([
      { chunkIndex: 0, status: 'done', outputText: 'Chunk 1 đã dịch' },
      { chunkIndex: 1, status: 'skipped', outputText: '' },
      { chunkIndex: 2, status: 'done', outputText: 'Chunk 3 đã dịch' },
      { chunkIndex: 3, status: 'pending', outputText: '' },
    ], 2);

    expect(summary).toEqual({
      completedChunks: 2,
      failedChunks: 0,
      totalChunks: 3,
      isComplete: false,
    });
  });

  it('claims queue items sequentially and never starts two translator sessions at once', async () => {
    const first = await createTranslatorSessionFromFile(new TrackingFile(['Truyện một.'], { name: 'mot.txt' }), {
      chunkSize: 100,
    });
    const second = await createTranslatorSessionFromFile(new TrackingFile(['Truyện hai.'], { name: 'hai.txt' }), {
      chunkSize: 100,
    });

    await enqueueTranslatorSession(first.id);
    await enqueueTranslatorSession(second.id);

    const claimedFirst = await claimNextTranslatorQueueItem();
    const claimedSecondWhileRunning = await claimNextTranslatorQueueItem();
    expect(claimedFirst.sessionId).toBe(first.id);
    expect(claimedSecondWhileRunning).toBeNull();

    await updateTranslatorQueueItemStatus(claimedFirst.id, 'completed');
    const claimedSecond = await claimNextTranslatorQueueItem();
    expect(claimedSecond.sessionId).toBe(second.id);
  });

  it('queues an uploaded txt story session with file metadata intact', async () => {
    const file = new TrackingFile(['Noi dung truyen can dua vao hang doi.'], {
      name: 'ten-truyen-rat-dai-de-kiem-tra-hang-doi.txt',
      lastModified: 1710000000999,
    });

    const session = await createTranslatorSessionFromFile(file, {
      chunkSize: 100,
    });
    const queueItem = await enqueueTranslatorSession(session.id);
    const queueItems = await getTranslatorQueueItems();

    expect(queueItem.status).toBe('queued');
    expect(queueItems).toHaveLength(1);
    expect(queueItems[0]).toMatchObject({
      sessionId: session.id,
      status: 'queued',
      position: 1,
    });
    expect(session.fileName).toBe('ten-truyen-rat-dai-de-kiem-tra-hang-doi.txt');
  });

  it('reorders queued and paused story sessions by persisted queue position', async () => {
    const first = await createTranslatorSessionFromFile(new TrackingFile(['Mot'], { name: 'mot.txt' }), {
      chunkSize: 100,
    });
    const second = await createTranslatorSessionFromFile(new TrackingFile(['Hai'], { name: 'hai.txt' }), {
      chunkSize: 100,
    });
    const third = await createTranslatorSessionFromFile(new TrackingFile(['Ba'], { name: 'ba.txt' }), {
      chunkSize: 100,
    });

    const firstQueue = await enqueueTranslatorSession(first.id);
    const secondQueue = await enqueueTranslatorSession(second.id);
    const thirdQueue = await enqueueTranslatorSession(third.id);
    await updateTranslatorQueueItemStatus(secondQueue.id, 'paused');

    await reorderTranslatorQueueItems([thirdQueue.id, firstQueue.id, secondQueue.id]);
    const reordered = await getTranslatorQueueItems();

    expect(reordered.map(item => item.id)).toEqual([thirdQueue.id, firstQueue.id, secondQueue.id]);
    expect(reordered.map(item => item.position)).toEqual([1, 2, 3]);
    expect(reordered.map(item => item.status)).toEqual(['queued', 'queued', 'paused']);
  });
});
