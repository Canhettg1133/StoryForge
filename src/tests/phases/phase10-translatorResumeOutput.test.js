import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

const runtimeSource = fs.readFileSync(
  path.join(process.cwd(), 'public/translator-runtime/js/translation/local-store.js'),
  'utf8',
);
const engineSource = fs.readFileSync(
  path.join(process.cwd(), 'public/translator-runtime/js/translation/engine.js'),
  'utf8',
);
let activeStore;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function createRuntime() {
  const context = vm.createContext({
    console,
    Date,
    IDBKeyRange,
    indexedDB,
    Math,
    Promise,
    Set,
  });
  vm.runInContext(runtimeSource, context);
  await context.TranslatorLocalStore.getTranslatorSession('initialize-db');
  return context.TranslatorLocalStore;
}

async function seedResumeSession(store, sessionId) {
  const database = await requestResult(indexedDB.open(store.DB_NAME));
  const transaction = database.transaction(
    [store.STORES.SESSIONS, store.STORES.CHUNKS],
    'readwrite',
  );

  transaction.objectStore(store.STORES.SESSIONS).put({
    id: sessionId,
    startChunkIndex: 0,
    startByte: 0,
  });

  const chunks = transaction.objectStore(store.STORES.CHUNKS);
  chunks.put({
    id: `${sessionId}:0`,
    sessionId,
    chunkIndex: 0,
    byteStart: 0,
    outputText: 'bản dịch chunk 1',
    status: 'done',
  });
  chunks.put({
    id: `${sessionId}:1`,
    sessionId,
    chunkIndex: 1,
    byteStart: 100,
    outputText: 'chunk 2 cần dịch lại',
    status: 'failed',
  });
  chunks.put({
    id: `${sessionId}:2`,
    sessionId,
    chunkIndex: 2,
    byteStart: 200,
    outputText: '',
    status: 'pending',
  });

  await transactionDone(transaction);
  database.close();
}

afterEach(async () => {
  await activeStore?.clearTranslatorLocalStoreForTests();
  activeStore = undefined;
});

describe('translator resume output persistence', () => {
  it('treats persisted failed output as processed so resume does not translate it twice', () => {
    const context = vm.createContext({ console, Date, Math, Promise, Set, Map, setTimeout, clearTimeout });
    vm.runInContext(engineSource, context);

    expect(context.isPersistedTranslatorChunkProcessed({ status: 'done', outputText: 'done' })).toBe(true);
    expect(context.isPersistedTranslatorChunkProcessed({ status: 'failed', outputText: '[LỖI CHUNK 2]' })).toBe(true);
    expect(context.isPersistedTranslatorChunkProcessed({ status: 'failed', outputText: '' })).toBe(false);
    expect(context.isPersistedTranslatorChunkProcessed({ status: 'pending', outputText: 'stale' })).toBe(false);
  });

  it('does not advance a checkpoint across an out-of-order completion gap', () => {
    const context = vm.createContext({ console, Date, Math, Promise, Set, Map, setTimeout, clearTimeout });
    vm.runInContext(engineSource, context);
    const snapshot = vm.runInContext(`
      (() => {
        const tracker = createContiguousTranslationCheckpoint({ chunkIndex: 0, byte: 0 });
        tracker.markProcessed({ index: 1, byteEnd: 20, text: 'Hai' });
        const afterOutOfOrder = tracker.snapshot();
        tracker.markProcessed({ index: 0, byteEnd: 10, text: 'Một' });
        const afterGapClosed = tracker.snapshot();
        tracker.markProcessed({ index: 3, byteEnd: 40, text: 'Bốn' });
        const afterCancelledGap = tracker.snapshot();
        return { afterOutOfOrder, afterGapClosed, afterCancelledGap };
      })()
    `, context);

    expect(snapshot.afterOutOfOrder).toMatchObject({ chunkIndex: 0, byte: 0 });
    expect(snapshot.afterGapClosed).toMatchObject({ chunkIndex: 2, byte: 20 });
    expect(snapshot.afterCancelledGap).toMatchObject({ chunkIndex: 2, byte: 20 });
  });

  it('keeps completed chunk output when translation resumes from a later chunk', async () => {
    const store = await createRuntime();
    activeStore = store;
    const sessionId = 'resume-session';
    await seedResumeSession(store, sessionId);

    await store.markTranslatorChunksBefore(sessionId, 2);

    const savedChunks = await store.getTranslatorSessionChunks(sessionId);
    expect(savedChunks[0]).toMatchObject({
      status: 'done',
      outputText: 'bản dịch chunk 1',
    });
    expect(savedChunks[1]).toMatchObject({
      status: 'failed',
      outputText: 'chunk 2 cần dịch lại',
    });
    expect(await store.getTranslatorSessionOutputParts(sessionId)).toEqual([
      'bản dịch chunk 1',
      '\n\n',
      'chunk 2 cần dịch lại',
    ]);
    expect(await store.getTranslatorSession(sessionId)).toMatchObject({
      startChunkIndex: 0,
      startByte: 0,
      completedChunks: 2,
      isComplete: false,
    });
  });
});
