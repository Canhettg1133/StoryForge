import { buildChapterReaderModel } from './chapterReaderModel';

const DEFAULT_MAX_SEGMENT_LENGTH = 180;
const BLOCK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

function normalizeSpeechText(value = '') {
  return String(value || '')
    .replace(/\u00a0/gu, ' ')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
}

function collectText(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';

  const tagName = node.tagName || '';
  if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') return '';
  if (tagName === 'BR' || tagName === 'HR') return '\n';

  const text = Array.from(node.childNodes, collectText).join('');
  return BLOCK_ELEMENTS.has(tagName) ? `\n${text}\n` : text;
}

export function htmlToSpeechText(html = '') {
  if (typeof document === 'undefined') {
    return normalizeSpeechText(
      String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<[^>]*>/gu, ' '),
    );
  }

  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  return normalizeSpeechText(collectText(template.content));
}

function splitLongFragment(fragment, maxLength) {
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  fragment.split(/\s+/gu).filter(Boolean).forEach((originalWord) => {
    let word = originalWord;
    if (word.length > maxLength) {
      flush();
      while (word.length > maxLength) {
        chunks.push(word.slice(0, maxLength));
        word = word.slice(maxLength);
      }
      current = word;
      return;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      flush();
      current = word;
    }
  });

  flush();
  return chunks;
}

function splitParagraph(paragraph, maxLength) {
  const sentences = paragraph.match(/[^.!?…]+(?:[.!?…]+["'”’»\])]*|$)/gu) || [paragraph];
  const fragments = sentences.flatMap((sentence) => {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) return [];
    if (cleanSentence.length <= maxLength) return [cleanSentence];
    return splitLongFragment(cleanSentence, maxLength);
  });

  const chunks = [];
  fragments.forEach((fragment) => {
    const previous = chunks.at(-1);
    if (previous && `${previous} ${fragment}`.length <= maxLength) {
      chunks[chunks.length - 1] = `${previous} ${fragment}`;
    } else {
      chunks.push(fragment);
    }
  });
  return chunks;
}

export function splitSpeechText(text = '', { maxLength = DEFAULT_MAX_SEGMENT_LENGTH } = {}) {
  const safeMaxLength = Math.max(16, Number(maxLength) || DEFAULT_MAX_SEGMENT_LENGTH);
  return normalizeSpeechText(text)
    .split(/\n+/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitParagraph(paragraph, safeMaxLength))
    .filter(Boolean);
}

export function buildChapterSpeechSegments(scenes = [], chapterId = null, options = {}) {
  const { readableScenes } = buildChapterReaderModel(scenes, chapterId);
  return readableScenes.flatMap((scene) => (
    splitSpeechText(htmlToSpeechText(scene.draft_text || ''), options)
  ));
}

function isVietnameseVoice(voice) {
  return /^vi(?:[-_]|$)/iu.test(String(voice?.lang || ''));
}

const GOOGLE_ANDROID_LOCAL_VOICES = new Map([
  ['gft', { label: 'Tiếng Việt 1 (gft)', order: 0 }],
  ['vic', { label: 'Tiếng Việt 2 (vic)', order: 1 }],
  ['vid', { label: 'Tiếng Việt 3 (vid)', order: 2 }],
  ['vie', { label: 'Tiếng Việt 4 (vie)', order: 3 }],
  ['vif', { label: 'Tiếng Việt 5 (vif)', order: 4 }],
]);

function getGoogleAndroidLocalVoice(voice) {
  const identity = `${voice?.name || ''} ${voice?.voiceURI || ''}`.toLowerCase();
  const androidVoiceMatch = identity.match(
    /vi[-_]vn[-_]x[-_](gft|vic|vid|vie|vif)[-_]local\b/u,
  );
  if (androidVoiceMatch) return GOOGLE_ANDROID_LOCAL_VOICES.get(androidVoiceMatch[1]) || null;

  if (voice?.localService === false) return null;
  if (!identity.includes('google') || !/vi[-_]vn/u.test(identity)) return null;
  const googleLabelMatch = identity.match(/\b(gft|vic|vid|vie|vif)\b/u);
  return googleLabelMatch ? GOOGLE_ANDROID_LOCAL_VOICES.get(googleLabelMatch[1]) || null : null;
}

export function isGoogleAndroidLocalVoice(voice) {
  return Boolean(getGoogleAndroidLocalVoice(voice));
}

export function getSpeechVoiceDisplayName(voice) {
  return getGoogleAndroidLocalVoice(voice)?.label
    || String(voice?.name || voice?.lang || 'Giọng không tên');
}

export function sortSpeechVoices(voices = []) {
  return Array.from(voices || []).filter(isVietnameseVoice).sort((left, right) => {
    const leftGoogleVoice = getGoogleAndroidLocalVoice(left);
    const rightGoogleVoice = getGoogleAndroidLocalVoice(right);
    const leftRank = leftGoogleVoice ? 0 : left?.localService === false ? 2 : 1;
    const rightRank = rightGoogleVoice ? 0 : right?.localService === false ? 2 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (leftGoogleVoice && rightGoogleVoice) return leftGoogleVoice.order - rightGoogleVoice.order;
    if (Boolean(left?.default) !== Boolean(right?.default)) return left?.default ? -1 : 1;
    return String(left?.name || '').localeCompare(String(right?.name || ''), 'vi');
  });
}

export function getSpeechVoiceSourceLabel(voice) {
  if (isGoogleAndroidLocalVoice(voice)) return 'Google TTS · đã cài trên thiết bị';
  const identity = `${voice?.name || ''} ${voice?.voiceURI || ''}`.toLowerCase();
  if (identity.includes('google') || identity.includes('com.google.android.tts')) {
    return 'Google TTS · trên thiết bị';
  }
  if (identity.includes('microsoft')) return 'Microsoft · trên thiết bị';
  if (identity.includes('apple') || identity.includes('com.apple')) {
    return 'Apple · trên thiết bị';
  }
  return 'Giọng hệ thống';
}

function clampRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

function clampGapMs(value) {
  const gapMs = Number(value);
  if (!Number.isFinite(gapMs)) return 0;
  return Math.min(5000, Math.max(0, Math.round(gapMs)));
}

function sameVoice(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.voiceURI === right.voiceURI
    && left.name === right.name
    && left.lang === right.lang;
}

export function createChapterPlaybackController({
  createPlayback,
  resetPlayback = () => {},
  onStateChange = () => {},
} = {}) {
  if (typeof createPlayback !== 'function') {
    throw new TypeError('Speech playback factory is unavailable.');
  }
  let segments = [];
  let index = 0;
  let status = 'idle';
  let error = null;
  let source = null;
  let rate = 1;
  let gapMs = 0;
  let currentPlayback = null;
  let preparationAbortController = null;
  let gapTimer = null;
  let gapStartedAt = 0;
  let remainingGapMs = 0;
  let waiting = false;
  let session = 0;
  let destroyed = false;
  let restartOnResume = false;

  const getState = () => ({
    status,
    index,
    total: segments.length,
    error,
    waiting,
  });

  const emit = () => {
    if (!destroyed) onStateChange(getState());
  };

  const clearGapTimer = () => {
    if (gapTimer !== null) clearTimeout(gapTimer);
    gapTimer = null;
    gapStartedAt = 0;
  };

  const resetGap = () => {
    clearGapTimer();
    remainingGapMs = 0;
    waiting = false;
  };

  const fail = (reason) => {
    resetGap();
    preparationAbortController = null;
    currentPlayback = null;
    restartOnResume = false;
    status = 'error';
    error = String(reason?.code || reason || 'synthesis-failed');
    emit();
  };

  const stopActivePlayback = ({ reset = false } = {}) => {
    preparationAbortController?.abort();
    preparationAbortController = null;
    currentPlayback?.stop?.();
    currentPlayback = null;
    if (reset) resetPlayback();
  };

  const scheduleNext = (delayMs) => {
    const safeDelayMs = clampGapMs(delayMs);
    if (safeDelayMs === 0) {
      resetGap();
      prepareCurrent();
      return;
    }

    clearGapTimer();
    waiting = true;
    remainingGapMs = safeDelayMs;
    gapStartedAt = Date.now();
    status = 'playing';
    emit();
    const activeSession = session;
    gapTimer = setTimeout(() => {
      if (destroyed || activeSession !== session || status !== 'playing') return;
      resetGap();
      prepareCurrent();
    }, safeDelayMs);
  };

  const handlePlaybackEnded = (playback, activeSession) => {
    if (destroyed || activeSession !== session || currentPlayback !== playback) return;
    currentPlayback = null;
    index += 1;
    if (index >= segments.length) {
      prepareCurrent();
      return;
    }
    if (status === 'paused') {
      waiting = gapMs > 0;
      remainingGapMs = gapMs;
      restartOnResume = true;
      emit();
      return;
    }
    scheduleNext(gapMs);
  };

  const activatePlayback = (playback, activeSession, abortController) => {
    if (
      destroyed
      || activeSession !== session
      || abortController.signal.aborted
      || preparationAbortController !== abortController
    ) {
      playback?.stop?.();
      return;
    }
    preparationAbortController = null;
    if (!playback || typeof playback.play !== 'function') {
      fail('invalid-playback');
      return;
    }

    currentPlayback = playback;
    if (status === 'paused') {
      restartOnResume = true;
      return;
    }
    status = 'playing';
    error = null;
    emit();
    try {
      const playResult = playback.play();
      Promise.resolve(playResult).catch((playError) => {
        if (activeSession === session && currentPlayback === playback) fail(playError);
      });
    } catch (playError) {
      if (activeSession === session && currentPlayback === playback) fail(playError);
    }
  };

  function prepareCurrent() {
    if (destroyed) return;
    if (index >= segments.length) {
      currentPlayback = null;
      preparationAbortController = null;
      resetGap();
      status = 'ended';
      error = null;
      emit();
      return;
    }

    const activeSession = session;
    const abortController = new AbortController();
    preparationAbortController = abortController;
    let playback = null;
    const playbackRequest = {
      text: segments[index],
      source,
      rate,
      signal: abortController.signal,
      onEnded: () => handlePlaybackEnded(playback, activeSession),
      onError: (playbackError) => {
        if (destroyed || activeSession !== session || currentPlayback !== playback) return;
        fail(playbackError);
      },
    };

    error = null;
    try {
      const result = createPlayback(playbackRequest);
      if (result && typeof result.then === 'function') {
        status = 'preparing';
        emit();
        Promise.resolve(result).then((preparedPlayback) => {
          playback = preparedPlayback;
          activatePlayback(playback, activeSession, abortController);
        }).catch((preparationError) => {
          if (
            abortController.signal.aborted
            || activeSession !== session
            || preparationAbortController !== abortController
          ) return;
          fail(preparationError);
        });
        return;
      }
      playback = result;
      activatePlayback(playback, activeSession, abortController);
    } catch (preparationError) {
      if (
        !abortController.signal.aborted
        && activeSession === session
        && preparationAbortController === abortController
      ) fail(preparationError);
    }
  }

  const stop = () => {
    session += 1;
    stopActivePlayback({ reset: true });
    restartOnResume = false;
    resetGap();
    index = 0;
    status = 'idle';
    error = null;
    emit();
  };

  const resume = () => {
    if (destroyed || status !== 'paused') return;
    if (restartOnResume) {
      restartOnResume = false;
      if (waiting) {
        status = 'playing';
        scheduleNext(remainingGapMs);
        return;
      }
      if (!currentPlayback) {
        status = 'playing';
        prepareCurrent();
        return;
      }
    }

    status = 'playing';
    emit();
    const resumedPlayback = currentPlayback;
    const activeSession = session;
    try {
      const resumeResult = typeof resumedPlayback?.resume === 'function'
        ? resumedPlayback.resume()
        : resumedPlayback?.play?.();
      Promise.resolve(resumeResult).catch((resumeError) => {
        if (
          status === 'playing'
          && activeSession === session
          && currentPlayback === resumedPlayback
        ) fail(resumeError);
      });
    } catch (resumeError) {
      if (activeSession === session && currentPlayback === resumedPlayback) fail(resumeError);
    }
  };

  return {
    getState,
    setSegments(nextSegments = [], { force = false } = {}) {
      const normalized = Array.from(nextSegments || [])
        .map((segment) => String(segment || '').trim())
        .filter(Boolean);
      if (
        !force && normalized.length === segments.length
        && normalized.every((segment, segmentIndex) => segment === segments[segmentIndex])
      ) return false;

      const shouldCancel = force || segments.length > 0
        || currentPlayback || preparationAbortController || status !== 'idle';
      session += 1;
      stopActivePlayback({ reset: shouldCancel });
      restartOnResume = false;
      resetGap();
      segments = normalized;
      index = 0;
      status = 'idle';
      error = null;
      emit();
      return true;
    },
    setOptions(nextOptions = {}) {
      const nextSource = Object.hasOwn(nextOptions, 'source') ? nextOptions.source : source;
      const nextRate = Object.hasOwn(nextOptions, 'rate') ? clampRate(nextOptions.rate) : rate;
      const nextGapMs = Object.hasOwn(nextOptions, 'gapMs')
        ? clampGapMs(nextOptions.gapMs)
        : gapMs;
      const sameSource = nextSource === source
        || (nextSource?.key && nextSource.key === source?.key)
        || sameVoice(nextSource, source);
      if (sameSource && nextRate === rate && nextGapMs === gapMs) return;

      source = nextSource;
      rate = nextRate;
      gapMs = nextGapMs;
    },
    play() {
      if (destroyed || segments.length === 0) return;
      if (status === 'paused') {
        resume();
        return;
      }
      session += 1;
      stopActivePlayback({ reset: true });
      restartOnResume = false;
      resetGap();
      index = 0;
      status = 'playing';
      error = null;
      prepareCurrent();
    },
    pause() {
      if (destroyed || (status !== 'playing' && status !== 'preparing')) return;
      if (waiting) {
        const elapsedMs = Math.max(0, Date.now() - gapStartedAt);
        remainingGapMs = Math.max(0, remainingGapMs - elapsedMs);
        clearGapTimer();
        restartOnResume = true;
        status = 'paused';
        emit();
        return;
      }
      if (status === 'preparing') {
        preparationAbortController?.abort();
        preparationAbortController = null;
        restartOnResume = true;
      } else {
        currentPlayback?.pause?.();
      }
      status = 'paused';
      emit();
    },
    resume,
    stop,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      session += 1;
      stopActivePlayback({ reset: true });
      restartOnResume = false;
      resetGap();
    },
  };
}

export function createChapterSpeechController({
  synth,
  Utterance,
  onStateChange = () => {},
} = {}) {
  if (!synth || typeof synth.speak !== 'function' || typeof synth.cancel !== 'function') {
    throw new TypeError('Speech synthesis engine is unavailable.');
  }
  if (typeof Utterance !== 'function') {
    throw new TypeError('SpeechSynthesisUtterance is unavailable.');
  }

  const resetPlayback = () => {
    synth.cancel();
    if (synth.paused && typeof synth.resume === 'function') synth.resume();
  };
  const controller = createChapterPlaybackController({
    onStateChange,
    resetPlayback,
    createPlayback({ text, source: voice, rate, onEnded, onError }) {
      const utterance = new Utterance(text);
      utterance.rate = rate;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || 'vi-VN';
      } else {
        utterance.lang = 'vi-VN';
      }
      utterance.onend = onEnded;
      utterance.onerror = (event) => onError(event?.error);
      return {
        play() { synth.speak(utterance); },
        pause() { synth.pause(); },
        resume() { synth.resume(); },
        stop() {},
      };
    },
  });

  return {
    ...controller,
    setOptions(nextOptions = {}) {
      const mappedOptions = { ...nextOptions };
      if (Object.hasOwn(mappedOptions, 'voice')) {
        mappedOptions.source = mappedOptions.voice;
        delete mappedOptions.voice;
      }
      controller.setOptions(mappedOptions);
    },
  };
}
