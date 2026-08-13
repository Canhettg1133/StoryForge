export const EDGE_VIETNAMESE_SOURCES = Object.freeze([
  Object.freeze({
    key: 'edge:hoai-my',
    kind: 'edge',
    voiceId: 'hoai-my',
    name: 'Hoài My',
    language: 'vi-VN',
  }),
  Object.freeze({
    key: 'edge:nam-minh',
    kind: 'edge',
    voiceId: 'nam-minh',
    name: 'Nam Minh',
    language: 'vi-VN',
  }),
]);

export const GOOGLE_FREE_VIETNAMESE_SOURCES = Object.freeze([
  Object.freeze({
    key: 'google-free:vi',
    kind: 'google-free',
    name: 'Chị Google',
    language: 'vi-VN',
  }),
]);

export const ONLINE_VIETNAMESE_SOURCES = Object.freeze([
  ...GOOGLE_FREE_VIETNAMESE_SOURCES,
  ...EDGE_VIETNAMESE_SOURCES,
]);

const MEBIBYTE = 1024 * 1024;

export function resolveSpeechPrefetchPolicy({
  connection = typeof navigator !== 'undefined' ? navigator.connection : null,
  deviceMemory = typeof navigator !== 'undefined' ? navigator.deviceMemory : null,
  hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
  isMobileDevice = typeof navigator !== 'undefined'
    ? Boolean(navigator.userAgentData?.mobile)
      || /Android|iPhone|iPad|iPod|Mobile/iu.test(navigator.userAgent || '')
    : false,
} = {}) {
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const savesData = Boolean(connection?.saveData);
  const slowNetwork = effectiveType === 'slow-2g' || effectiveType === '2g';
  const lowMemory = deviceMemory !== null
    && deviceMemory !== undefined
    && Number.isFinite(Number(deviceMemory))
    && Number(deviceMemory) <= 2;
  const lowCpu = hardwareConcurrency !== null
    && hardwareConcurrency !== undefined
    && Number.isFinite(Number(hardwareConcurrency))
    && Number(hardwareConcurrency) <= 4;
  const constrained = isMobileDevice || savesData || slowNetwork || lowMemory || lowCpu;

  return {
    maxConcurrent: constrained ? 1 : 2,
    maxBytes: savesData ? 2 * MEBIBYTE : constrained ? 4 * MEBIBYTE : 12 * MEBIBYTE,
    initialReadyCount: constrained ? 10 : 20,
    targetReadyCount: 20,
    prefetchNextChapter: !savesData && !slowNetwork,
    backgroundDelayMs: constrained ? 900 : 1100,
    maxRetryAttempts: 2,
    retryBaseDelayMs: constrained ? 500 : 350,
    retryMaxDelayMs: 4_000,
    requestTimeoutMs: constrained ? 18_000 : 12_000,
  };
}

function speechError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function createAbortError() {
  const error = new Error('Speech audio request was aborted.');
  error.name = 'AbortError';
  return error;
}

function responseRetryDelayMs(response) {
  const value = response?.headers?.get?.('Retry-After');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
}

function onlineResponseError(response) {
  const status = Number(response?.status || 0);
  return Object.assign(speechError('ONLINE_SPEECH_UNAVAILABLE'), {
    retryable: status === 408 || status === 429 || status >= 500,
    retryAfterMs: responseRetryDelayMs(response),
    status,
  });
}

function onlineRequestTimeoutError() {
  return Object.assign(speechError('ONLINE_SPEECH_TIMEOUT'), {
    retryable: true,
  });
}

function waitForOnlineRequest(promise, { abortController, timeoutMs }) {
  const { signal } = abortController;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleAbort = () => finish(reject, createAbortError());
    signal.addEventListener('abort', handleAbort, { once: true });
    timeout = setTimeout(() => {
      const error = onlineRequestTimeoutError();
      finish(reject, error);
      abortController.abort(error);
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function waitForPromise(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function speechAudioKey(source, text) {
  return `${source?.key || source?.voiceId || 'speech'}\u0000${String(text || '')}`;
}

function createSpeechAudioPrefetcher({
  fetchAudio,
  policy,
  onStateChange = () => {},
}) {
  const ready = new Map();
  const inFlight = new Map();
  let remainingUses = new Map();
  let queued = [];
  let queuedKeys = new Set();
  let readyBytes = 0;
  let generation = 0;
  let pumpTimer = null;
  let retryTimer = null;
  let retryDueAt = 0;
  let retrying = false;
  let suspended = false;
  let destroyed = false;
  let requiredStartReadyCount = 0;

  const countBufferedSegments = (keys) => {
    let count = 0;
    for (const key of keys) {
      count += Math.max(1, remainingUses.get(key) || 0);
    }
    return count;
  };

  const readySegmentCount = () => Math.min(
    policy.targetReadyCount,
    countBufferedSegments(ready.keys()),
  );

  const bufferedSegmentCount = () => Math.min(
    policy.targetReadyCount,
    countBufferedSegments(ready.keys()) + countBufferedSegments(inFlight.keys()),
  );

  const getState = () => ({
    readyCount: readySegmentCount(),
    initialReadyCount: policy.initialReadyCount,
    requiredStartReadyCount,
    targetReadyCount: policy.targetReadyCount,
    loadingCount: inFlight.size,
    queuedCount: queued.length,
    retrying,
    suspended,
    prefetchNextChapter: policy.prefetchNextChapter,
  });

  const emit = () => {
    if (!destroyed) onStateChange(getState());
  };

  const clearPumpTimer = () => {
    if (pumpTimer !== null) clearTimeout(pumpTimer);
    pumpTimer = null;
  };

  const clearRetryTimer = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    retryDueAt = 0;
    retrying = false;
  };

  const removeReady = (key) => {
    const blob = ready.get(key);
    if (!blob) return null;
    ready.delete(key);
    readyBytes = Math.max(0, readyBytes - Number(blob.size || 0));
    return blob;
  };

  const removeQueued = (key) => {
    if (!queuedKeys.has(key)) return;
    queued = queued.filter((item) => item.key !== key);
    queuedKeys.delete(key);
  };

  let pump;
  const schedulePump = () => {
    if (
      destroyed
      || suspended
      || retrying
      || pumpTimer !== null
      || inFlight.size >= policy.maxConcurrent
      || queued.length === 0
      || readyBytes >= policy.maxBytes
      || bufferedSegmentCount() >= policy.targetReadyCount
    ) return;

    if (readySegmentCount() < requiredStartReadyCount || policy.backgroundDelayMs <= 0) {
      pump();
      return;
    }
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, policy.backgroundDelayMs);
  };

  const retryDelay = (attempt) => Math.min(
    policy.retryMaxDelayMs,
    policy.retryBaseDelayMs * (2 ** Math.max(0, attempt - 1)),
  );

  const queueRetry = (item, error) => {
    const attempt = Number(item.retryAttempt || 0) + 1;
    if (error?.retryable === false || attempt > policy.maxRetryAttempts) return false;

    if (!queuedKeys.has(item.key)) {
      queued.unshift({ ...item, retryAttempt: attempt });
      queuedKeys.add(item.key);
    }
    const dueAt = Date.now() + Math.max(
      Number(error?.retryAfterMs || 0),
      retryDelay(attempt),
    );
    if (retryTimer !== null && dueAt >= retryDueAt) {
      retrying = true;
      return true;
    }
    clearRetryTimer();
    retrying = true;
    retryDueAt = dueAt;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryDueAt = 0;
      retrying = false;
      if (!destroyed && !suspended) pump();
    }, Math.max(0, dueAt - Date.now()));
    return true;
  };

  const startFetch = (item, { foreground = false } = {}) => {
    const requestGeneration = generation;
    const abortController = new AbortController();
    let fetchResult;
    try {
      fetchResult = fetchAudio({
        text: item.text,
        source: item.source,
        signal: abortController.signal,
      });
    } catch (error) {
      fetchResult = Promise.reject(error);
    }

    const promise = waitForOnlineRequest(fetchResult, {
      abortController,
      timeoutMs: policy.requestTimeoutMs,
    })
      .then((blob) => {
        if (!blob || Number(blob.size || 0) <= 0) {
          throw speechError('ONLINE_SPEECH_EMPTY_AUDIO');
        }
        if (
          !destroyed
          && requestGeneration === generation
          && !abortController.signal.aborted
        ) {
          removeReady(item.key);
          ready.set(item.key, blob);
          readyBytes += Number(blob.size || 0);
          if (foreground) suspended = false;
        }
        return blob;
      })
      .catch((error) => {
        if (
          !isAbortError(error)
          && (!abortController.signal.aborted || error?.code === 'ONLINE_SPEECH_TIMEOUT')
          && requestGeneration === generation
        ) {
          const willRetry = !foreground && queueRetry(item, error);
          if (!willRetry) {
            clearRetryTimer();
            suspended = true;
          }
        }
        throw error;
      })
      .finally(() => {
        const currentEntry = inFlight.get(item.key);
        if (currentEntry?.promise === promise) inFlight.delete(item.key);
        emit();
        if (requestGeneration === generation) schedulePump();
      });

    inFlight.set(item.key, { promise, abortController, foreground });
    emit();
    return inFlight.get(item.key);
  };

  pump = () => {
    if (destroyed || suspended || retrying) return;
    clearPumpTimer();

    while (
      inFlight.size < policy.maxConcurrent
      && queued.length > 0
      && readyBytes < policy.maxBytes
      && bufferedSegmentCount() < policy.targetReadyCount
    ) {
      const item = queued.shift();
      queuedKeys.delete(item.key);
      if (ready.has(item.key) || inFlight.has(item.key)) continue;
      startFetch(item).promise.catch(() => {});
    }
    emit();
  };

  const cancel = ({ clearReady = false, preserveForeground = false } = {}) => {
    generation += 1;
    clearPumpTimer();
    clearRetryTimer();
    queued = [];
    queuedKeys = new Set();
    remainingUses = new Map();
    requiredStartReadyCount = 0;
    suspended = false;
    const pendingRequests = Array.from(inFlight.entries());
    pendingRequests.forEach(([key, { abortController, foreground }]) => {
      if (preserveForeground && foreground) return;
      inFlight.delete(key);
      abortController.abort();
    });
    if (clearReady) {
      ready.clear();
      readyBytes = 0;
    }
    emit();
  };

  return {
    getState,
    prefetch({
      source,
      currentSegments = [],
      nextSegments = [],
      clearReady = false,
      preserveForeground = false,
    }) {
      cancel({ clearReady, preserveForeground });
      if (!source) return;

      const selectedSegments = [
        ...currentSegments,
        ...(policy.prefetchNextChapter ? nextSegments : []),
      ].map((value) => String(value || '').trim()).filter(Boolean);
      requiredStartReadyCount = Math.min(policy.initialReadyCount, selectedSegments.length);
      selectedSegments.forEach((value) => {
        const text = value;
        const key = speechAudioKey(source, text);
        remainingUses.set(key, (remainingUses.get(key) || 0) + 1);
        if (ready.has(key) || queuedKeys.has(key)) return;
        queued.push({ key, source, text });
        queuedKeys.add(key);
      });
      pump();
    },
    async take({ source, text, signal }) {
      const key = speechAudioKey(source, text);
      const consumeReady = (blob) => {
        const uses = remainingUses.get(key) || 0;
        if (uses > 1) {
          remainingUses.set(key, uses - 1);
          return;
        }
        remainingUses.delete(key);
        if (ready.get(key) === blob) removeReady(key);
      };
      let blob = ready.get(key) || null;
      if (!blob) {
        let entry = inFlight.get(key);
        if (!entry) {
          removeQueued(key);
          entry = startFetch({ key, source, text }, { foreground: true });
        } else {
          entry.foreground = true;
        }
        blob = await waitForPromise(entry.promise, signal);
      }
      consumeReady(blob);
      emit();
      schedulePump();
      return blob;
    },
    cancel,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel({ clearReady: true });
    },
  };
}

function createDevicePlayback({ synth, Utterance, text, voice, rate, onEnded, onError }) {
  if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function' || !voice) {
    throw speechError('DEVICE_SPEECH_UNAVAILABLE');
  }
  const utterance = new Utterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang || 'vi-VN';
  utterance.rate = rate;
  utterance.onend = onEnded;
  utterance.onerror = (event) => onError(event?.error || 'synthesis-failed');

  return {
    play() { return synth.speak(utterance); },
    pause() { return synth.pause?.(); },
    resume() { return synth.resume?.(); },
    stop() {
      utterance.onend = null;
      utterance.onerror = null;
    },
  };
}

function createAudioPlayback({
  blob,
  rate,
  onEnded,
  onError,
  createAudio,
  createObjectURL,
  revokeObjectURL,
}) {
  const audio = createAudio();
  const objectUrl = createObjectURL(blob);
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    audio.onended = null;
    audio.onerror = null;
    revokeObjectURL(objectUrl);
  };
  const stop = () => {
    audio.pause?.();
    release();
    audio.removeAttribute?.('src');
    audio.load?.();
  };

  audio.src = objectUrl;
  audio.playbackRate = rate;
  audio.onended = () => {
    release();
    onEnded();
  };
  audio.onerror = () => {
    release();
    onError('audio-playback-failed');
  };

  const play = () => Promise.resolve(audio.play()).catch((error) => {
    stop();
    throw error;
  });

  return {
    play,
    pause() { audio.pause?.(); },
    resume: play,
    stop,
  };
}

export function createChapterSpeechPlaybackFactory({
  synth = globalThis?.speechSynthesis,
  Utterance = globalThis?.SpeechSynthesisUtterance,
  fetchImpl = globalThis?.fetch,
  createAudio = () => new Audio(),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  getFallbackVoice = () => null,
  isOnlineAllowed = () => false,
  onFallback = () => {},
  onPrefetchStateChange = () => {},
  prefetchPolicy,
} = {}) {
  const unavailableUntil = new Map();
  const fallbackCooldownMs = 60_000;
  const policy = {
    ...resolveSpeechPrefetchPolicy(),
    ...(prefetchPolicy || {}),
  };
  policy.targetReadyCount = Math.max(1, Number(policy.targetReadyCount) || 20);
  policy.initialReadyCount = Math.min(
    policy.targetReadyCount,
    Math.max(1, Number(policy.initialReadyCount) || policy.targetReadyCount),
  );
  policy.maxRetryAttempts = Math.max(0, Number(policy.maxRetryAttempts) || 0);
  policy.retryBaseDelayMs = Math.max(0, Number(policy.retryBaseDelayMs) || 0);
  policy.retryMaxDelayMs = Math.max(
    policy.retryBaseDelayMs,
    Number(policy.retryMaxDelayMs) || policy.retryBaseDelayMs,
  );
  policy.requestTimeoutMs = Math.max(1, Number(policy.requestTimeoutMs) || 12_000);
  const devicePlayback = (request, voice) => createDevicePlayback({
    ...request,
    synth,
    Utterance,
    voice,
  });

  const audioPlayback = (request, blob) => createAudioPlayback({
    ...request,
    blob,
    createAudio,
    createObjectURL,
    revokeObjectURL,
  });

  const fetchEdgeAudio = async ({ text, source, signal }) => {
    if (!isOnlineAllowed()) throw speechError('ONLINE_SPEECH_CONSENT_REQUIRED');
    if (typeof fetchImpl !== 'function') throw speechError('ONLINE_SPEECH_UNAVAILABLE');
    const response = await fetchImpl('/api/tts/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId: source.voiceId,
      }),
      signal,
    });
    if (!response.ok) throw onlineResponseError(response);
    const blob = await response.blob();
    if (blob.size === 0) throw speechError('ONLINE_SPEECH_EMPTY_AUDIO');
    if (blob.type && blob.type !== 'audio/mpeg') {
      throw speechError('ONLINE_SPEECH_INVALID_AUDIO');
    }
    return blob;
  };

  const fetchGoogleFreeAudio = async ({ text, signal }) => {
    if (!isOnlineAllowed()) throw speechError('ONLINE_SPEECH_CONSENT_REQUIRED');
    if (typeof fetchImpl !== 'function') throw speechError('ONLINE_SPEECH_UNAVAILABLE');
    const response = await fetchImpl('/api/tts/google-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) throw onlineResponseError(response);
    const blob = await response.blob();
    if (blob.size === 0) throw speechError('ONLINE_SPEECH_EMPTY_AUDIO');
    if (blob.type && blob.type !== 'audio/mpeg') {
      throw speechError('ONLINE_SPEECH_INVALID_AUDIO');
    }
    return blob;
  };

  const fetchOnlineAudio = (request) => {
    if (request.source?.kind === 'google-free') return fetchGoogleFreeAudio(request);
    if (request.source?.kind === 'edge') return fetchEdgeAudio(request);
    throw speechError('SPEECH_SOURCE_UNAVAILABLE');
  };

  const prefetcher = createSpeechAudioPrefetcher({
    fetchAudio: fetchOnlineAudio,
    policy,
    onStateChange: onPrefetchStateChange,
  });

  const prepareOnlinePlayback = async (request) => {
    if (!isOnlineAllowed()) throw speechError('ONLINE_SPEECH_CONSENT_REQUIRED');
    const blob = await prefetcher.take(request);
    return audioPlayback(request, blob);
  };

  const createPlayback = async (request) => {
    const { source } = request;
    if (source?.kind === 'device') return devicePlayback(request, source.voice);
    if (!source?.kind && source?.lang) return devicePlayback(request, source);

    const fallbackVoice = getFallbackVoice();
    if ((unavailableUntil.get(source?.key) || 0) > Date.now() && fallbackVoice) {
      return devicePlayback(request, fallbackVoice);
    }

    try {
      if (source?.kind === 'edge' || source?.kind === 'google-free') {
        const playback = await prepareOnlinePlayback(request);
        unavailableUntil.delete(source.key);
        return playback;
      }
      throw speechError('SPEECH_SOURCE_UNAVAILABLE');
    } catch (error) {
      if (isAbortError(error) || error?.code === 'ONLINE_SPEECH_CONSENT_REQUIRED') throw error;
      const availableFallbackVoice = getFallbackVoice();
      if (!availableFallbackVoice) throw error;
      unavailableUntil.set(source?.key, Date.now() + fallbackCooldownMs);
      onFallback({ source, fallbackVoice: availableFallbackVoice, error });
      return devicePlayback(request, availableFallbackVoice);
    }
  };

  return {
    createPlayback,
    prefetchSegments({
      source,
      currentSegments = [],
      nextSegments = [],
      clearReady = false,
      preserveForeground = false,
    } = {}) {
      if (!['edge', 'google-free'].includes(source?.kind) || !isOnlineAllowed()) return false;
      prefetcher.prefetch({
        source,
        currentSegments,
        nextSegments,
        clearReady,
        preserveForeground,
      });
      return true;
    },
    cancelPrefetch(options) {
      prefetcher.cancel(options);
    },
    getPrefetchState() {
      return prefetcher.getState();
    },
    resetPlayback() {
      synth?.cancel?.();
      if (synth?.paused) synth.resume?.();
    },
    destroy() {
      prefetcher.destroy();
    },
  };
}
