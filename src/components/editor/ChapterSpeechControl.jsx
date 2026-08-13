import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloudDownload, Headphones, Pause, Play, Square, Volume2, X } from 'lucide-react';
import {
  buildChapterSpeechSegments,
  createChapterPlaybackController,
  getSpeechVoiceDisplayName,
  getSpeechVoiceSourceLabel,
  isGoogleAndroidLocalVoice,
  sortSpeechVoices,
} from './chapterSpeech';
import {
  GOOGLE_FREE_VIETNAMESE_SOURCES,
  ONLINE_VIETNAMESE_SOURCES,
  createChapterSpeechPlaybackFactory,
} from './chapterSpeechSources';
import './ChapterSpeechControl.css';

const SOURCE_STORAGE_KEY = 'storyforge.chapter-speech.voice-v2-fast-default';
const RATE_STORAGE_KEY = 'storyforge.chapter-speech.rate';
const GAP_STORAGE_KEY = 'storyforge.chapter-speech.gap-ms';
const ONLINE_CONSENT_STORAGE_KEY = 'storyforge.chapter-speech.online-consent-v3-prefetch';
const RATE_OPTIONS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const GAP_OPTIONS = [0, 200, 400, 700, 1000];

function readStoredValue(key, fallback = '') {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function storeValue(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Playback must continue even when storage is unavailable.
  }
}

function removeStoredValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Consent can still be changed for the current page.
  }
}

function voiceKey(voice) {
  return [voice?.voiceURI, voice?.name, voice?.lang].filter(Boolean).join('::');
}

function createDeviceSource(voice) {
  return {
    key: `device:${voiceKey(voice)}`,
    kind: 'device',
    voice,
    name: getSpeechVoiceDisplayName(voice),
    language: voice.lang || 'vi-VN',
  };
}

function sourceLabel(source) {
  if (source?.kind === 'device') return getSpeechVoiceSourceLabel(source.voice);
  if (source?.kind === 'edge') return 'Online thử nghiệm · Microsoft Edge';
  if (source?.kind === 'google-free') return 'Online thử nghiệm · Google';
  return 'Chưa chọn giọng';
}

function isOnlineSource(source) {
  return source?.kind === 'edge' || source?.kind === 'google-free';
}

function statusText(state) {
  if (state.status === 'preparing') {
    return `Đang chuẩn bị đoạn ${Math.min(state.index + 1, state.total)}/${state.total}`;
  }
  if (state.status === 'playing' && state.waiting) {
    return `Chuẩn bị đoạn ${Math.min(state.index + 1, state.total)}/${state.total}`;
  }
  if (state.status === 'playing') return `Đang đọc đoạn ${state.index + 1}/${state.total}`;
  if (state.status === 'paused') return `Đã tạm dừng ở đoạn ${state.index + 1}/${state.total}`;
  if (state.status === 'ended') return 'Đã đọc xong chương';
  if (state.status === 'error') return 'Không thể tiếp tục đọc. Hãy thử giọng khác.';
  return 'Sẵn sàng đọc chương';
}

function prefetchStatusText({ source, consent, state }) {
  if (!isOnlineSource(source)) return 'Giọng trên thiết bị không cần tải trước.';
  if (!consent) return 'Tải trước bắt đầu sau khi bạn cho phép.';
  if (state.suspended) return 'Không thể tiếp tục tải nền. Hãy bấm nghe để thử lại.';
  if (state.retrying) {
    return state.readyCount > 0
      ? `Đã tải ${state.readyCount}/${state.targetReadyCount || 20} đoạn · kết nối chập chờn, đang thử lại…`
      : 'Kết nối chập chờn, StoryForge đang thử tải lại…';
  }

  const busy = state.loadingCount > 0;
  if (state.readyCount > 0) {
    return `Sẵn ${state.readyCount}/${state.targetReadyCount || 20} đoạn${busy ? ' · đang tải nền' : ''}`;
  }
  return busy ? 'Đang tải trước các đoạn sắp nghe…' : 'Sẽ tải nền ngay khi bạn bấm nghe.';
}

function initialBufferStatusText(state) {
  const target = state.requiredStartReadyCount || state.initialReadyCount;
  const activity = state.retrying
    ? ' · kết nối chập chờn, đang thử lại'
    : state.loadingCount > 0
      ? ' · đang tải đoạn tiếp theo'
      : '';
  return `Tải đủ ${target} đoạn rồi mới phát · ${state.readyCount}/${target}${activity}`;
}

export default function ChapterSpeechControl({
  chapterId,
  nextChapterId = null,
  placement = 'reader',
  scenes = [],
  speechServices,
}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
  const deviceSpeechSupported = Boolean(
    synth
    && typeof synth.speak === 'function'
    && typeof synth.getVoices === 'function'
    && typeof Utterance === 'function',
  );
  const fetchImpl = speechServices?.fetchImpl || globalThis.fetch;
  const onlineSupported = typeof fetchImpl === 'function';
  const segments = useMemo(
    () => buildChapterSpeechSegments(scenes, chapterId),
    [chapterId, scenes],
  );
  const nextChapterSegments = useMemo(
    () => (nextChapterId ? buildChapterSpeechSegments(scenes, nextChapterId) : []),
    [nextChapterId, scenes],
  );
  const controllerRef = useRef(null);
  const factoryRef = useRef(null);
  const previousChapterIdRef = useRef(chapterId);
  const voicesRef = useRef([]);
  const onlineConsentRef = useRef(false);
  const [voices, setVoices] = useState(() => (
    deviceSpeechSupported ? sortSpeechVoices(synth.getVoices()) : []
  ));
  const [selectedSourceKey, setSelectedSourceKey] = useState(
    () => readStoredValue(SOURCE_STORAGE_KEY),
  );
  const [onlineConsent, setOnlineConsent] = useState(
    () => readStoredValue(ONLINE_CONSENT_STORAGE_KEY) === 'granted',
  );
  const [notice, setNotice] = useState('');
  const [rate, setRate] = useState(() => {
    const storedRate = Number(readStoredValue(RATE_STORAGE_KEY, '1'));
    return RATE_OPTIONS.includes(storedRate) ? storedRate : 1;
  });
  const [gapMs, setGapMs] = useState(() => {
    const storedGap = Number(readStoredValue(GAP_STORAGE_KEY, '200'));
    return GAP_OPTIONS.includes(storedGap) ? storedGap : 200;
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [waitingForInitialBuffer, setWaitingForInitialBuffer] = useState(false);
  const [speechState, setSpeechState] = useState({
    status: 'idle',
    index: 0,
    total: segments.length,
    error: null,
    waiting: false,
  });
  const [prefetchState, setPrefetchState] = useState({
    readyCount: 0,
    initialReadyCount: 20,
    requiredStartReadyCount: 0,
    loadingCount: 0,
    queuedCount: 0,
    retrying: false,
    suspended: false,
    prefetchNextChapter: true,
    targetReadyCount: 20,
  });

  useEffect(() => {
    voicesRef.current = voices;
  }, [voices]);

  useEffect(() => {
    onlineConsentRef.current = onlineConsent;
  }, [onlineConsent]);

  useEffect(() => {
    if (!deviceSpeechSupported) return undefined;
    const updateVoices = () => setVoices(sortSpeechVoices(synth.getVoices()));
    updateVoices();

    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', updateVoices);
      return () => synth.removeEventListener?.('voiceschanged', updateVoices);
    }

    const previousHandler = synth.onvoiceschanged;
    synth.onvoiceschanged = updateVoices;
    return () => {
      if (synth.onvoiceschanged === updateVoices) synth.onvoiceschanged = previousHandler || null;
    };
  }, [deviceSpeechSupported, synth]);

  const deviceSources = useMemo(() => voices.map(createDeviceSource), [voices]);
  const sourceCatalog = useMemo(() => [
    ...deviceSources,
    ...(onlineSupported ? ONLINE_VIETNAMESE_SOURCES : []),
  ], [deviceSources, onlineSupported]);

  useEffect(() => {
    if (sourceCatalog.length === 0) return;
    if (sourceCatalog.some((source) => source.key === selectedSourceKey)) return;
    const preferredSource = (onlineSupported ? GOOGLE_FREE_VIETNAMESE_SOURCES[0] : null)
      || deviceSources[0]
      || sourceCatalog[0];
    setSelectedSourceKey(preferredSource.key);
  }, [deviceSources, onlineSupported, selectedSourceKey, sourceCatalog]);

  const selectedSource = sourceCatalog.find((source) => source.key === selectedSourceKey) || null;
  useEffect(() => {
    const factory = createChapterSpeechPlaybackFactory({
      synth: deviceSpeechSupported ? synth : null,
      Utterance: deviceSpeechSupported ? Utterance : null,
      fetchImpl,
      createAudio: speechServices?.createAudio,
      createObjectURL: speechServices?.createObjectURL,
      revokeObjectURL: speechServices?.revokeObjectURL,
      getFallbackVoice: () => voicesRef.current[0] || null,
      isOnlineAllowed: () => onlineConsentRef.current,
      onFallback: ({ fallbackVoice }) => {
        setNotice(
          'Giọng online đang gián đoạn; '
          + `StoryForge tiếp tục bằng ${getSpeechVoiceDisplayName(fallbackVoice)} trên thiết bị.`,
        );
      },
      onPrefetchStateChange: setPrefetchState,
      prefetchPolicy: speechServices?.prefetchPolicy,
    });
    const controller = createChapterPlaybackController({
      createPlayback: factory.createPlayback,
      resetPlayback: factory.resetPlayback,
      onStateChange: setSpeechState,
    });
    factoryRef.current = factory;
    controllerRef.current = controller;
    controller.setSegments(segments);
    return () => {
      controller.destroy();
      factory.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (factoryRef.current === factory) factoryRef.current = null;
    };
  }, [
    Utterance,
    deviceSpeechSupported,
    fetchImpl,
    speechServices?.createAudio,
    speechServices?.createObjectURL,
    speechServices?.prefetchPolicy,
    speechServices?.revokeObjectURL,
    synth,
  ]);

  useEffect(() => {
    const chapterChanged = previousChapterIdRef.current !== chapterId;
    const contentChanged = controllerRef.current?.setSegments(segments, {
      force: chapterChanged,
    });
    previousChapterIdRef.current = chapterId;
    if (contentChanged) {
      setWaitingForInitialBuffer(false);
      factoryRef.current?.cancelPrefetch({ clearReady: true });
      setPanelOpen(false);
      setNotice('');
    }
  }, [chapterId, segments]);

  useEffect(() => {
    controllerRef.current?.setOptions({ source: selectedSource, rate, gapMs });
  }, [gapMs, rate, selectedSource]);

  useEffect(() => {
    if (!waitingForInitialBuffer) return;
    if (prefetchState.suspended) {
      setWaitingForInitialBuffer(false);
      setNotice('Không thể tải đủ bộ đệm ban đầu. Hãy thử lại hoặc chọn giọng khác.');
      return;
    }
    if (
      prefetchState.requiredStartReadyCount > 0
      && prefetchState.readyCount >= prefetchState.requiredStartReadyCount
    ) {
      setWaitingForInitialBuffer(false);
      controllerRef.current?.play();
    }
  }, [
    prefetchState.readyCount,
    prefetchState.requiredStartReadyCount,
    prefetchState.suspended,
    waitingForInitialBuffer,
  ]);

  useEffect(() => {
    const selectedDeviceStillExists = selectedSourceKey.startsWith('device:')
      && deviceSources.some((source) => source.key === selectedSourceKey);
    if (!selectedSourceKey.startsWith('device:') || selectedDeviceStillExists) return;
    controllerRef.current?.stop();
    factoryRef.current?.cancelPrefetch({ clearReady: true });
    setPanelOpen(false);
    setNotice('Giọng trên thiết bị vừa bị gỡ. Hãy chọn một giọng khác.');
  }, [deviceSources, selectedSourceKey]);

  const installedGoogleVoiceCount = voices.filter(isGoogleAndroidLocalVoice).length;
  const completedSegments = speechState.status === 'ended'
    ? speechState.total
    : Math.min(speechState.index, speechState.total);
  const progressPercent = speechState.total > 0
    ? Math.round((completedSegments / speechState.total) * 100)
    : 0;
  const sourceReady = isOnlineSource(selectedSource)
    ? onlineConsent
    : Boolean(selectedSource);
  const prefetchStatus = prefetchStatusText({
    source: selectedSource,
    consent: onlineConsent,
    state: prefetchState,
  });

  const startPrefetch = (source, startIndex = 0, options = {}) => {
    if (!isOnlineSource(source) || !onlineConsentRef.current) return false;
    return factoryRef.current?.prefetchSegments({
      source,
      currentSegments: segments.slice(Math.max(0, startIndex)),
      nextSegments: nextChapterSegments,
      ...options,
    });
  };

  const handlePlaybackToggle = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (waitingForInitialBuffer) {
      setWaitingForInitialBuffer(false);
      factoryRef.current?.cancelPrefetch();
      return;
    }
    if (speechState.status === 'playing' || speechState.status === 'preparing') {
      controller.pause();
      return;
    }
    if (!sourceReady) {
      if (isOnlineSource(selectedSource)) {
        setNotice('Hãy cho phép gửi các đoạn sắp nghe tới nguồn giọng online trước khi phát.');
      }
      return;
    }
    setNotice('');
    if (speechState.status === 'paused') {
      controller.resume();
      return;
    }
    if (isOnlineSource(selectedSource)) {
      setWaitingForInitialBuffer(true);
      startPrefetch(selectedSource, 0);
      return;
    }
    controller.play();
  };

  const handleStop = () => {
    setWaitingForInitialBuffer(false);
    controllerRef.current?.stop();
    factoryRef.current?.cancelPrefetch();
    setNotice('');
  };

  const handleConsentChange = (event) => {
    const allowed = event.target.checked;
    setOnlineConsent(allowed);
    onlineConsentRef.current = allowed;
    if (allowed) {
      storeValue(ONLINE_CONSENT_STORAGE_KEY, 'granted');
      setNotice('Đã cho phép giọng online. Bộ đệm 20 đoạn chỉ bắt đầu sau khi bạn bấm nghe.');
    } else {
      setWaitingForInitialBuffer(false);
      removeStoredValue(ONLINE_CONSENT_STORAGE_KEY);
      if (isOnlineSource(selectedSource)) controllerRef.current?.stop();
      factoryRef.current?.cancelPrefetch({ clearReady: true });
      setNotice('Đã tắt quyền gửi nội dung tới nguồn giọng online.');
    }
  };

  const handleSourceChange = (event) => {
    const nextValue = event.target.value;
    const nextSource = sourceCatalog.find((source) => source.key === nextValue);
    const nextSourceNeedsSetup = isOnlineSource(nextSource) && !onlineConsent;
    const initialBufferActive = waitingForInitialBuffer;
    const playbackActive = ['playing', 'preparing', 'paused'].includes(speechState.status);
    if (nextSourceNeedsSetup && ['playing', 'preparing'].includes(speechState.status)) {
      controllerRef.current?.pause();
    }
    setSelectedSourceKey(nextValue);
    storeValue(SOURCE_STORAGE_KEY, nextValue);
    setNotice('');
    if (initialBufferActive) {
      if (isOnlineSource(nextSource) && onlineConsent) {
        startPrefetch(nextSource, 0, { clearReady: true });
      } else {
        setWaitingForInitialBuffer(false);
        factoryRef.current?.cancelPrefetch({ clearReady: true });
      }
      return;
    }
    if (playbackActive && isOnlineSource(nextSource) && onlineConsent) {
      startPrefetch(nextSource, Math.min(speechState.index + 1, segments.length), {
        clearReady: true,
        preserveForeground: ['playing', 'preparing'].includes(speechState.status),
      });
    } else {
      factoryRef.current?.cancelPrefetch({
        clearReady: true,
        preserveForeground: ['playing', 'preparing'].includes(speechState.status),
      });
    }
  };

  const playbackLabel = waitingForInitialBuffer
    ? 'Hủy tải trước khi nghe'
    : speechState.status === 'playing' || speechState.status === 'preparing'
    ? 'Tạm dừng đọc chương'
    : speechState.status === 'paused'
      ? 'Tiếp tục đọc chương'
      : 'Bắt đầu nghe chương';
  const PlaybackIcon = waitingForInitialBuffer
    ? CloudDownload
    : speechState.status === 'playing' || speechState.status === 'preparing'
    ? Pause
    : Play;
  const unavailableReason = segments.length === 0
    ? 'Chương chưa có nội dung để đọc.'
    : sourceCatalog.length === 0
      ? 'Trình duyệt này chưa có nguồn giọng đọc phù hợp.'
      : '';

  return (
    <div className={`chapter-speech-control chapter-speech-control--floating chapter-speech-control--${placement === 'writing' ? 'writing' : 'reader'}`}>
      <button
        type="button"
        className={`chapter-speech-trigger ${waitingForInitialBuffer || ['playing', 'preparing', 'paused'].includes(speechState.status) ? 'chapter-speech-trigger--active' : ''}`}
        onClick={() => setPanelOpen((value) => !value)}
        disabled={Boolean(unavailableReason)}
        title={unavailableReason || (panelOpen ? 'Đóng điều khiển nghe chương' : 'Mở điều khiển nghe chương')}
        aria-label={panelOpen ? 'Đóng điều khiển nghe chương' : 'Mở điều khiển nghe chương'}
        aria-expanded={panelOpen}
        aria-controls={panelOpen ? 'chapter-speech-panel' : undefined}
      >
        <Headphones size={19} aria-hidden="true" />
        <span className="chapter-speech-trigger__status" aria-hidden="true" />
      </button>

      {panelOpen && (
        <div
          id="chapter-speech-panel"
          className="chapter-speech-panel"
          role="group"
          aria-label="Điều khiển giọng đọc chương"
        >
          <div className="chapter-speech-panel__heading">
            <div className="chapter-speech-panel__title">
              <strong><Volume2 size={16} aria-hidden="true" /> Nghe chương</strong>
              <span>{sourceLabel(selectedSource)}</span>
            </div>
            <button
              type="button"
              className="chapter-speech-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Đóng điều khiển nghe chương"
              title="Đóng bảng điều khiển"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="chapter-speech-panel__settings">
            <label className="chapter-speech-setting--voice">
              <span>Giọng Việt</span>
              <select
                aria-label="Chọn giọng đọc"
                value={selectedSourceKey}
                onChange={handleSourceChange}
              >
                {deviceSources.length > 0 && (
                  <optgroup label="Trên thiết bị">
                    {deviceSources.map((source) => (
                      <option key={source.key} value={source.key}>
                        {source.name} · {sourceLabel(source)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {onlineSupported && (
                  <optgroup label="Online miễn phí · thử nghiệm">
                    {ONLINE_VIETNAMESE_SOURCES.map((source) => (
                      <option key={source.key} value={source.key}>
                        {source.name} · {source.kind === 'google-free' ? 'Google' : 'Microsoft Edge'}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              <span>Tốc độ</span>
              <select
                aria-label="Tốc độ đọc"
                value={rate}
                onChange={(event) => {
                  const nextRate = Number(event.target.value);
                  setRate(nextRate);
                  storeValue(RATE_STORAGE_KEY, nextRate);
                }}
              >
                {RATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}×</option>
                ))}
              </select>
            </label>
            <label>
              <span>Khoảng nghỉ</span>
              <select
                aria-label="Khoảng nghỉ giữa các đoạn"
                value={gapMs}
                onChange={(event) => {
                  const nextGap = Number(event.target.value);
                  setGapMs(nextGap);
                  storeValue(GAP_STORAGE_KEY, nextGap);
                }}
              >
                {GAP_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 0 ? 'Không nghỉ' : `${String(option / 1000).replace('.', ',')} giây`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isOnlineSource(selectedSource) && (
            <label className="chapter-speech-consent">
              <input
                type="checkbox"
                checked={onlineConsent}
                onChange={handleConsentChange}
                aria-label="Cho phép gửi các đoạn sắp nghe tới nguồn giọng online"
              />
              <span>
                Cho phép gửi lần lượt các đoạn sắp nghe tới {selectedSource?.kind === 'google-free' ? 'Google' : 'Microsoft Edge'} để tạo audio.
                StoryForge không dùng API trả phí và không gửi cả chương trong một request.
              </span>
            </label>
          )}

          <div className="chapter-speech-buffer" aria-live="polite">
            <CloudDownload size={15} aria-hidden="true" />
            <div>
              <strong>
                {waitingForInitialBuffer
                  ? initialBufferStatusText(prefetchState)
                  : prefetchStatus}
              </strong>
              {isOnlineSource(selectedSource) && onlineConsent && (
                <span>
                  {prefetchState.prefetchNextChapter && nextChapterSegments.length > 0
                    ? 'Bộ đệm trượt 20 đoạn: chương này, rồi chương kế tiếp.'
                    : 'Bộ đệm trượt tối đa 20 đoạn của chương hiện tại.'}
                </span>
              )}
            </div>
          </div>

          <div
            className="chapter-speech-progress"
            role="progressbar"
            aria-label="Tiến độ đọc chương"
            aria-valuemin="0"
            aria-valuemax={speechState.total}
            aria-valuenow={completedSegments}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="chapter-speech-playback-actions">
            <button
              type="button"
              className="chapter-speech-playback-toggle"
              onClick={handlePlaybackToggle}
              disabled={segments.length === 0}
              aria-label={playbackLabel}
            >
              <PlaybackIcon size={16} fill={speechState.status === 'playing' ? 'currentColor' : 'none'} aria-hidden="true" />
              <span>{waitingForInitialBuffer ? 'Hủy tải trước' : speechState.status === 'playing' || speechState.status === 'preparing' ? 'Tạm dừng' : speechState.status === 'paused' ? 'Tiếp tục' : 'Nghe chương'}</span>
            </button>
            <button
              type="button"
              className="chapter-speech-stop"
              onClick={handleStop}
              aria-label="Dừng đọc chương"
              title="Dừng và quay về đầu chương"
              disabled={!waitingForInitialBuffer && !['playing', 'preparing', 'paused'].includes(speechState.status)}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
          </div>
          <div className="chapter-speech-status" role="status" aria-live="polite">
            <span>{waitingForInitialBuffer ? 'Đang chuẩn bị bộ đệm ban đầu' : statusText(speechState)}</span>
            <span>Đã đọc {completedSegments}/{speechState.total}</span>
          </div>
          {notice && <p className="chapter-speech-notice" role="status">{notice}</p>}
          <p className="chapter-speech-settings-note">
            Thay đổi giọng, tốc độ và khoảng nghỉ áp dụng từ đoạn tiếp theo.
          </p>
          {selectedSource?.kind === 'device' && (
            <p className="chapter-speech-device-note">
              {installedGoogleVoiceCount > 0
                ? `Đã tìm thấy ${installedGoogleVoiceCount} giọng Google TTS miễn phí trên thiết bị. StoryForge không gọi API tính phí.`
                : 'Không qua máy chủ StoryForge. Danh sách này do trình duyệt và hệ điều hành cung cấp.'}
            </p>
          )}
          {isOnlineSource(selectedSource) && (
            <p className="chapter-speech-privacy-note">
              Nguồn online miễn phí là thử nghiệm và có thể gián đoạn. Khi lỗi, StoryForge ưu tiên giọng Việt trên thiết bị nếu có.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
