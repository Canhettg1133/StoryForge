import { describe, expect, it, vi } from 'vitest';

import {
  EDGE_VIETNAMESE_SOURCES,
  createChapterSpeechPlaybackFactory,
  resolveSpeechPrefetchPolicy,
} from '../../components/editor/chapterSpeechSources.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function audioResponse(value = 'mp3') {
  return {
    ok: true,
    blob: vi.fn().mockResolvedValue(new Blob([value], { type: 'audio/mpeg' })),
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function playbackRequest(text, overrides = {}) {
  return {
    text,
    source: EDGE_VIETNAMESE_SOURCES[0],
    rate: 1,
    signal: new AbortController().signal,
    onEnded: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('chapter speech adaptive prefetch', () => {
  it('uses a small single-worker buffer on constrained devices and keeps two workers on normal devices', () => {
    expect(resolveSpeechPrefetchPolicy({
      connection: { effectiveType: '4g', saveData: false },
      deviceMemory: 8,
    })).toMatchObject({
      maxConcurrent: 2,
      initialReadyCount: 20,
      targetReadyCount: 20,
      prefetchNextChapter: true,
    });

    expect(resolveSpeechPrefetchPolicy({
      connection: { effectiveType: '2g', saveData: true },
      deviceMemory: 2,
      hardwareConcurrency: 4,
    })).toMatchObject({
      maxConcurrent: 1,
      initialReadyCount: 10,
      targetReadyCount: 20,
      prefetchNextChapter: false,
    });

    expect(resolveSpeechPrefetchPolicy({
      connection: { effectiveType: '4g', saveData: false },
      deviceMemory: 8,
      hardwareConcurrency: 8,
      isMobileDevice: true,
    })).toMatchObject({
      maxConcurrent: 1,
      initialReadyCount: 10,
      targetReadyCount: 20,
    });
  });

  it('reports the complete startup buffer required before playback may begin', async () => {
    const fetchImpl = vi.fn((_url, options) => Promise.resolve(
      audioResponse(JSON.parse(options.body).text),
    ));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024 * 1024,
        initialReadyCount: 20,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: Array.from({ length: 12 }, (_, index) => `Đoạn ${index + 1}.`),
      nextSegments: Array.from({ length: 12 }, (_, index) => `Chương sau ${index + 1}.`),
    });
    await flushAsyncWork();

    expect(factory.getPrefetchState()).toMatchObject({
      readyCount: 20,
      initialReadyCount: 20,
      requiredStartReadyCount: 20,
    });
    factory.destroy();
  });

  it('maintains a sliding buffer of twenty segments without downloading the whole chapter at once', async () => {
    const fetchImpl = vi.fn((_url, options) => Promise.resolve(
      audioResponse(JSON.parse(options.body).text),
    ));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      }),
      createObjectURL: () => 'blob:sliding-buffer',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024 * 1024,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });
    const segments = Array.from({ length: 30 }, (_, index) => `Đoạn ${index + 1}.`);

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: segments,
    });
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(factory.getPrefetchState()).toMatchObject({
      readyCount: 20,
      targetReadyCount: 20,
      loadingCount: 0,
      queuedCount: 10,
    });

    await factory.createPlayback(playbackRequest(segments[0]));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(21);
    expect(JSON.parse(fetchImpl.mock.calls[20][1].body).text).toBe(segments[20]);
    factory.destroy();
  });

  it('recovers from one transient provider failure without freezing the remaining startup buffer', async () => {
    const fetchImpl = vi.fn((_url, options) => {
      if (fetchImpl.mock.calls.length === 14) {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: () => null },
        });
      }
      return Promise.resolve(audioResponse(JSON.parse(options.body).text));
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024 * 1024,
        initialReadyCount: 20,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
        maxRetryAttempts: 2,
        retryBaseDelayMs: 5,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: Array.from({ length: 20 }, (_, index) => `Đoạn ${index + 1}.`),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(21);
    expect(factory.getPrefetchState()).toMatchObject({
      readyCount: 20,
      retrying: false,
      suspended: false,
    });
    factory.destroy();
  });

  it('times out and retries a final request that hangs forever at nineteen of twenty', async () => {
    const fetchImpl = vi.fn((_url, options) => {
      if (fetchImpl.mock.calls.length === 20) return new Promise(() => {});
      return Promise.resolve(audioResponse(JSON.parse(options.body).text));
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024 * 1024,
        initialReadyCount: 20,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
        requestTimeoutMs: 10,
        maxRetryAttempts: 2,
        retryBaseDelayMs: 5,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: Array.from({ length: 20 }, (_, index) => `Đoạn ${index + 1}.`),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(21);
    expect(fetchImpl.mock.calls[19][1].signal.aborted).toBe(true);
    expect(factory.getPrefetchState()).toMatchObject({
      readyCount: 20,
      loadingCount: 0,
      retrying: false,
      suspended: false,
    });
    factory.destroy();
  });

  it('bounds automatic retries and reports a real suspension only after recovery is exhausted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024 * 1024,
        initialReadyCount: 20,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
        maxRetryAttempts: 2,
        retryBaseDelayMs: 5,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: Array.from({ length: 20 }, (_, index) => `Đoạn ${index + 1}.`),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(factory.getPrefetchState()).toMatchObject({
      readyCount: 0,
      retrying: false,
      suspended: true,
    });
    factory.destroy();
  });

  it('starts only a bounded number of requests and preserves current-then-next chapter order', async () => {
    const requests = [];
    const fetchImpl = vi.fn((_url, options) => {
      const request = deferred();
      requests.push({ ...request, options });
      return request.promise;
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Hiện tại 1.', 'Hiện tại 2.', 'Hiện tại 3.'],
      nextSegments: ['Chương sau 1.'],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(requests[0].options.body).text).toBe('Hiện tại 1.');
    expect(JSON.parse(requests[1].options.body).text).toBe('Hiện tại 2.');

    requests[0].resolve(audioResponse('one'));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(requests[2].options.body).text).toBe('Hiện tại 3.');

    requests[1].resolve(audioResponse('two'));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(JSON.parse(requests[3].options.body).text).toBe('Chương sau 1.');
    factory.destroy();
  });

  it('joins playback to an in-flight preload instead of downloading the same segment twice', async () => {
    const pendingResponse = deferred();
    const fetchImpl = vi.fn(() => pendingResponse.promise);
    const audio = {
      src: '',
      playbackRate: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => audio,
      createObjectURL: () => 'blob:prefetched',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Không tải hai lần.'],
    });
    const preparedPlayback = factory.createPlayback(playbackRequest('Không tải hai lần.'));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    pendingResponse.resolve(audioResponse('shared'));
    const playback = await preparedPlayback;
    await playback.play();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('blob:prefetched');
    factory.destroy();
  });

  it('keeps the current foreground request alive while a voice change clears old background work', async () => {
    const request = deferred();
    const fetchImpl = vi.fn((_url, options) => new Promise((resolve, reject) => {
      request.resolve = resolve;
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'));
      }, { once: true });
    }));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      }),
      createObjectURL: () => 'blob:foreground',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024,
        targetReadyCount: 20,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    const currentText = 'Đoạn đang chuẩn bị.';
    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: [currentText],
    });
    await flushAsyncWork();
    const playbackPromise = factory.createPlayback(playbackRequest(currentText));
    await flushAsyncWork();
    factory.cancelPrefetch({ clearReady: true, preserveForeground: true });
    request.resolve(audioResponse());

    await expect(playbackPromise).resolves.toMatchObject({ play: expect.any(Function) });
    factory.destroy();
  });

  it('keeps one cached audio blob until every identical planned segment has used it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse('shared-repeat'));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      }),
      createObjectURL: () => 'blob:repeated',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Câu lặp.', 'Câu lặp.'],
    });
    await flushAsyncWork();
    await factory.createPlayback(playbackRequest('Câu lặp.'));
    await factory.createPlayback(playbackRequest('Câu lặp.'));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    factory.destroy();
  });

  it('pauses background loading at the memory ceiling and resumes after playback consumes a segment', async () => {
    const fetchImpl = vi.fn((_url, options) => Promise.resolve(
      audioResponse(JSON.parse(options.body).text.padEnd(8, '.')),
    ));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      }),
      createObjectURL: () => 'blob:bounded',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 8,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Đoạn một.', 'Đoạn hai.'],
    });
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(factory.getPrefetchState()).toMatchObject({ readyCount: 1, queuedCount: 1 });

    await factory.createPlayback(playbackRequest('Đoạn một.'));
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    factory.destroy();
  });

  it('does not preload the next chapter in data-saver mode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse('current'));
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024,
        prefetchNextChapter: false,
        backgroundDelayMs: 0,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Chương này.'],
      nextSegments: ['Chương kế tiếp.'],
    });
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).text).toBe('Chương này.');
    factory.destroy();
  });

  it('aborts pending preload work when playback is stopped or the chapter changes', async () => {
    const pendingResponse = deferred();
    let requestSignal;
    const fetchImpl = vi.fn((_url, options) => {
      requestSignal = options.signal;
      return pendingResponse.promise;
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 1,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
        requestTimeoutMs: 5,
        maxRetryAttempts: 2,
        retryBaseDelayMs: 5,
      },
    });

    factory.prefetchSegments({
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Không được chạy ngầm sau khi dừng.'],
    });
    factory.cancelPrefetch();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requestSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    factory.destroy();
  });

  it('can restart the same preload immediately after cancellation without joining the aborted request', async () => {
    const fetchImpl = vi.fn((_url, options) => {
      if (fetchImpl.mock.calls.length > 1) return Promise.resolve(audioResponse('restarted'));
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ), { once: true });
      });
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    });

    const plan = {
      source: EDGE_VIETNAMESE_SOURCES[0],
      currentSegments: ['Khởi động lại ngay.'],
    };
    factory.prefetchSegments(plan);
    factory.cancelPrefetch();
    factory.prefetchSegments(plan);
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(factory.getPrefetchState().readyCount).toBe(1);
    factory.destroy();
  });
});
