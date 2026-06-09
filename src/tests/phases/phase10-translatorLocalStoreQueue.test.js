import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../public/translator-runtime/js/translation/source-reader.js';
import '../../../public/translator-runtime/js/translation/local-store.js';

const {
  clearTranslatorLocalStoreForTests,
  createTranslatorSessionFromFile,
  enqueueTranslatorSession,
  getTranslatorSessionChunks,
  getTranslatorSessionOutputParts,
  getTranslatorQueueItems,
  markTranslatorChunksBefore,
  searchTranslatorSessionChunks,
  updateTranslatorChunkResult,
  updateTranslatorQueueItemStatus,
  claimNextTranslatorQueueItem,
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

  it('indexes a synthetic 20MB txt file with bounded slices and searchable chunks', async () => {
    const marker = 'Từ khóa bí mật nằm ở chương giữa.';
    const file = new TrackingFile([makeLargeText(20 * 1024 * 1024, marker)], {
      name: 'truyen-20mb.txt',
      lastModified: 1710000000123,
    });

    const session = await createTranslatorSessionFromFile(file, {
      chunkSize: 200000,
      windowBytes: 256000,
      minWindowBytes: 256000,
    });

    expect(file.fullTextCalls).toBe(0);
    expect(file.sliceCalls.length).toBeGreaterThan(1);
    expect(session.totalChunks).toBeGreaterThan(10);
    expect(session.fileFingerprint).toContain('truyen-20mb.txt');

    const matches = await searchTranslatorSessionChunks(session.id, 'bí mật', { limit: 5 });
    expect(matches).toHaveLength(1);
    expect(matches[0].sourcePreview).toContain(marker);
    expect(matches[0].byteStart).toBeLessThan(matches[0].byteEnd);
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
    expect(chunks[0].status).toBe('skipped');
    expect(chunks[1].status).toBe('skipped');

    const parts = await getTranslatorSessionOutputParts(session.id);
    expect(parts.join('')).toBe('Ba đã dịch\n\nBốn đã dịch');
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
});
