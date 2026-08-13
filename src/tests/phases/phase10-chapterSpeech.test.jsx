import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChapterSpeechControl from '../../components/editor/ChapterSpeechControl.jsx';
import {
  buildChapterSpeechSegments,
  createChapterSpeechController,
  getSpeechVoiceSourceLabel,
  sortSpeechVoices,
} from '../../components/editor/chapterSpeech.js';

afterEach(() => {
  vi.useRealTimers();
});

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}

class FakeSpeechSynthesis {
  constructor(voices = []) {
    this.voices = voices;
    this.listeners = new Map();
    this.paused = false;
    this.cancel = vi.fn();
    this.pause = vi.fn(() => {
      this.paused = true;
    });
    this.resume = vi.fn(() => {
      this.paused = false;
    });
    this.speak = vi.fn();
  }

  getVoices() {
    return this.voices;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

function createScene(overrides = {}) {
  return {
    id: 1,
    chapter_id: 10,
    order_index: 0,
    draft_text: '<p>Nội dung chương.</p>',
    ...overrides,
  };
}

function createVoice(overrides = {}) {
  return {
    name: 'Microsoft HoaiMy',
    lang: 'vi-VN',
    voiceURI: 'microsoft-hoaimy',
    default: false,
    localService: true,
    ...overrides,
  };
}

function voiceKeyForTest(voice) {
  return [voice?.voiceURI, voice?.name, voice?.lang].filter(Boolean).join('::');
}

describe('phase10 chapter speech text model', () => {
  it('turns formatted scene HTML into clean Vietnamese speech without crossing chapters', () => {
    const segments = buildChapterSpeechSegments([
      createScene({
        id: 3,
        order_index: 2,
        draft_text: '<p>Cô nói: <strong>“Đừng đi!”</strong></p><script>không được đọc</script>',
      }),
      createScene({
        id: 1,
        order_index: 0,
        draft_text: '<h2>Mưa đầu mùa</h2><p>Trời đổ mưa&nbsp;rất lớn.<br>Họ chạy vào hiên.</p>',
      }),
      createScene({ id: 2, order_index: 1, draft_text: '<p>&nbsp;</p>' }),
      createScene({ id: 4, chapter_id: 20, draft_text: '<p>Chương khác.</p>' }),
    ], 10, { maxLength: 80 });

    expect(segments.join(' ')).toBe(
      'Mưa đầu mùa Trời đổ mưa rất lớn. Họ chạy vào hiên. Cô nói: “Đừng đi!”',
    );
    expect(segments.every((segment) => segment.length <= 80)).toBe(true);
    expect(segments.join(' ')).not.toContain('không được đọc');
    expect(segments.join(' ')).not.toContain('Chương khác');
  });

  it('splits a long paragraph at punctuation or word boundaries and never emits blank chunks', () => {
    const segments = buildChapterSpeechSegments([
      createScene({
        draft_text: '<p>Một câu ngắn. Đây là một câu dài hơn để kiểm tra việc chia đoạn an toàn. TừRấtDàiKhôngCóKhoảngTrắng.</p>',
      }),
    ], 10, { maxLength: 32 });

    expect(segments.length).toBeGreaterThan(3);
    expect(segments.every((segment) => segment.trim() === segment)).toBe(true);
    expect(segments.every((segment) => segment.length > 0 && segment.length <= 32)).toBe(true);
    expect(segments.join(' ').replace(/\s+/gu, ' ')).toBe(
      'Một câu ngắn. Đây là một câu dài hơn để kiểm tra việc chia đoạn an toàn. TừRấtDàiKhôngCóKhoảngTrắng.',
    );
  });

  it('keeps default online segments within the measured Google request limit', () => {
    const segments = buildChapterSpeechSegments([
      createScene({ draft_text: `<p>${'Một câu chuyện rất dài cần được chia an toàn. '.repeat(20)}</p>` }),
    ], 10);

    expect(segments.length).toBeGreaterThan(1);
    expect(Math.max(...segments.map((segment) => segment.length))).toBeLessThanOrEqual(180);
  });

  it('keeps only Vietnamese voices and prioritizes local voices', () => {
    const voices = [
      createVoice({ name: 'English local', lang: 'en-US', voiceURI: 'en', default: true }),
      createVoice({ name: 'Vietnamese online', voiceURI: 'vi-online', localService: false }),
      createVoice({ name: 'Vietnamese local', voiceURI: 'vi-local' }),
      createVoice({ name: 'Vietnamese alternate locale', lang: 'VI_vn', voiceURI: 'vi-alt' }),
    ];

    expect(sortSpeechVoices(voices).map((voice) => voice.voiceURI)).toEqual([
      'vi-alt',
      'vi-local',
      'vi-online',
    ]);
  });

  it('recognizes and prioritizes the five installed Google Android Vietnamese voices', () => {
    const voices = [
      createVoice({ name: 'Giọng hệ thống mặc định', voiceURI: 'vi-system', default: true }),
      createVoice({ name: 'Vietnamese 5', voiceURI: 'vi-vn-x-vif-local' }),
      createVoice({ name: 'Vietnamese 3', voiceURI: 'vi-vn-x-vid-local' }),
      createVoice({ name: 'Vietnamese 1', voiceURI: 'vi-vn-x-gft-local' }),
      createVoice({ name: 'Vietnamese 4', voiceURI: 'vi-vn-x-vie-local' }),
      createVoice({ name: 'Vietnamese 2', voiceURI: 'vi-vn-x-vic-local' }),
    ];

    const sorted = sortSpeechVoices(voices);

    expect(sorted.map((voice) => voice.voiceURI)).toEqual([
      'vi-vn-x-gft-local',
      'vi-vn-x-vic-local',
      'vi-vn-x-vid-local',
      'vi-vn-x-vie-local',
      'vi-vn-x-vif-local',
      'vi-system',
    ]);
    expect(sorted.slice(0, 5).map(getSpeechVoiceSourceLabel)).toEqual([
      'Google TTS · đã cài trên thiết bị',
      'Google TTS · đã cài trên thiết bị',
      'Google TTS · đã cài trên thiết bị',
      'Google TTS · đã cài trên thiết bị',
      'Google TTS · đã cài trên thiết bị',
    ]);
  });

  it('does not mistake a network voice with a similar Google code for an installed voice', () => {
    const networkVoice = createVoice({
      name: 'Vietnamese network voice',
      voiceURI: 'vi-vn-x-gft-network',
      localService: false,
    });
    const localSystemVoice = createVoice({
      name: 'Giọng hệ thống cục bộ',
      voiceURI: 'vi-system-local',
    });

    expect(sortSpeechVoices([networkVoice, localSystemVoice]).map((voice) => voice.voiceURI))
      .toEqual(['vi-system-local', 'vi-vn-x-gft-network']);
    expect(getSpeechVoiceSourceLabel(networkVoice)).toBe('Giọng hệ thống');
  });

  it('labels Google voices only when the device actually exposes a Google TTS voice', () => {
    expect(getSpeechVoiceSourceLabel(createVoice({
      name: 'Google Tiếng Việt',
      voiceURI: 'com.google.android.tts:vi-VN',
    }))).toBe('Google TTS · trên thiết bị');
    expect(getSpeechVoiceSourceLabel(createVoice({
      name: 'Microsoft HoaiMy Online (Natural)',
      voiceURI: 'Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)',
    }))).toBe('Microsoft · trên thiết bị');
    expect(getSpeechVoiceSourceLabel(createVoice({
      name: 'Giọng Việt',
      voiceURI: 'vi-local',
    }))).toBe('Giọng hệ thống');
  });
});

describe('phase10 chapter speech controller', () => {
  it('plays chunks in order and reaches a completed state', () => {
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn một.', 'Đoạn hai.']);
    controller.play();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0].text).toBe('Đoạn một.');
    expect(controller.getState()).toMatchObject({ status: 'playing', index: 0, total: 2 });

    synth.speak.mock.calls[0][0].onend();
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls[1][0].text).toBe('Đoạn hai.');

    synth.speak.mock.calls[1][0].onend();
    expect(controller.getState()).toMatchObject({ status: 'ended', index: 2, total: 2 });
  });

  it('applies changed voice and rate to the next chunk without replaying the current chunk', () => {
    const synth = new FakeSpeechSynthesis();
    const firstVoice = createVoice({ voiceURI: 'first' });
    const secondVoice = createVoice({ voiceURI: 'second', name: 'Giọng hai' });
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn đang đọc.', 'Đoạn tiếp theo.']);
    controller.setOptions({ voice: firstVoice, rate: 1 });
    controller.play();
    const currentUtterance = synth.speak.mock.calls[0][0];
    controller.setOptions({ voice: secondVoice, rate: 1.5 });

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    currentUtterance.onend();

    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls[1][0]).toMatchObject({
      text: 'Đoạn tiếp theo.',
      voice: secondVoice,
      lang: 'vi-VN',
      rate: 1.5,
    });
  });

  it('cancels old callbacks on stop and chapter replacement so audio cannot overlap', () => {
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Chương cũ một.', 'Chương cũ hai.']);
    controller.play();
    const staleUtterance = synth.speak.mock.calls[0][0];

    controller.setSegments(['Chương mới.']);
    staleUtterance.onend();

    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0, total: 1 });

    controller.play();
    const currentUtterance = synth.speak.mock.calls[1][0];
    controller.stop();
    currentUtterance.onend();

    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0, total: 1 });
  });

  it('forces cancellation when a different chapter happens to have identical text', () => {
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Nội dung trùng nhau.']);
    controller.play();
    const staleUtterance = synth.speak.mock.calls[0][0];

    expect(controller.setSegments(['Nội dung trùng nhau.'], { force: true })).toBe(true);
    staleUtterance.onend();

    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0, total: 1 });
  });

  it('keeps the current paused chunk and applies changed settings after it finishes', () => {
    const synth = new FakeSpeechSynthesis();
    const nextVoice = createVoice({ voiceURI: 'paused-next' });
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đang dừng ở đây.', 'Đoạn sau.']);
    controller.play();
    controller.pause();
    const currentUtterance = synth.speak.mock.calls[0][0];
    controller.setOptions({ voice: nextVoice, rate: 1.75 });

    expect(controller.getState().status).toBe('paused');
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    controller.resume();

    expect(synth.resume).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    currentUtterance.onend();

    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls[1][0]).toMatchObject({
      text: 'Đoạn sau.',
      voice: nextVoice,
      rate: 1.75,
    });
  });

  it('surfaces synthesis failures without advancing into another chunk', () => {
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn lỗi.', 'Không được tự phát.']);
    controller.play();
    synth.speak.mock.calls[0][0].onerror({ error: 'synthesis-failed' });

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      status: 'error',
      index: 0,
      error: 'synthesis-failed',
    });
  });

  it('waits for the configured gap before speaking the next chunk', () => {
    vi.useFakeTimers();
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn một.', 'Đoạn hai.']);
    controller.setOptions({ gapMs: 400 });
    controller.play();
    synth.speak.mock.calls[0][0].onend();

    expect(controller.getState()).toMatchObject({
      status: 'playing',
      index: 1,
      waiting: true,
    });
    vi.advanceTimersByTime(399);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls[1][0].text).toBe('Đoạn hai.');
    vi.useRealTimers();
  });

  it('preserves the remaining gap across pause and resume without duplicating a chunk', () => {
    vi.useFakeTimers();
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn một.', 'Đoạn hai.']);
    controller.setOptions({ gapMs: 500 });
    controller.play();
    synth.speak.mock.calls[0][0].onend();
    vi.advanceTimersByTime(180);
    controller.pause();
    vi.advanceTimersByTime(1000);

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'paused', index: 1, waiting: true });

    controller.resume();
    vi.advanceTimersByTime(319);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls[1][0].text).toBe('Đoạn hai.');
    vi.useRealTimers();
  });

  it('clears a pending segment gap on stop so stale audio cannot start later', () => {
    vi.useFakeTimers();
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn một.', 'Đoạn hai.']);
    controller.setOptions({ gapMs: 700 });
    controller.play();
    synth.speak.mock.calls[0][0].onend();
    controller.stop();
    vi.advanceTimersByTime(1000);

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0, waiting: false });
    vi.useRealTimers();
  });

  it('finishes immediately after the final chunk without adding a trailing gap', () => {
    vi.useFakeTimers();
    const synth = new FakeSpeechSynthesis();
    const controller = createChapterSpeechController({
      synth,
      Utterance: FakeUtterance,
    });

    controller.setSegments(['Đoạn cuối.']);
    controller.setOptions({ gapMs: 1000 });
    controller.play();
    synth.speak.mock.calls[0][0].onend();

    expect(controller.getState()).toMatchObject({
      status: 'ended',
      index: 1,
      waiting: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('phase10 ChapterSpeechControl', () => {
  let container;
  let root;
  let originalSpeechSynthesis;
  let originalUtterance;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    window.localStorage.clear();
    originalSpeechSynthesis = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
    originalUtterance = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance');
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    if (originalSpeechSynthesis) {
      Object.defineProperty(window, 'speechSynthesis', originalSpeechSynthesis);
    } else {
      delete window.speechSynthesis;
    }
    if (originalUtterance) {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', originalUtterance);
    } else {
      delete window.SpeechSynthesisUtterance;
    }
  });

  async function renderControl(synth, speechServices, props = {}) {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: synth,
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeUtterance,
    });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChapterSpeechControl
          chapterId={10}
          scenes={[createScene({ draft_text: '<p>Trời đổ mưa. Họ chạy vào hiên.</p>' })]}
          speechServices={speechServices}
          {...props}
        />,
      );
    });
  }

  it('opens a compact floating panel without starting audio and keeps playback controls inside it', async () => {
    const voice = createVoice();
    window.localStorage.setItem(
      'storyforge.chapter-speech.voice-v2-fast-default',
      `device:${voiceKeyForTest(voice)}`,
    );
    const synth = new FakeSpeechSynthesis([voice]);
    await renderControl(synth);

    const trigger = container.querySelector('.chapter-speech-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('Mở điều khiển nghe chương');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger.click());

    expect(synth.speak).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-label')).toBe('Đóng điều khiển nghe chương');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.chapter-speech-panel')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Chọn giọng đọc"]')).not.toBeNull();
    expect(container.querySelectorAll(
      'select[aria-label="Chọn giọng đọc"] optgroup[label="Trên thiết bị"] option',
    )).toHaveLength(1);
    expect(container.textContent).not.toContain('Mặc định của thiết bị');
    const rateSelect = container.querySelector('select[aria-label="Tốc độ đọc"]');
    expect(rateSelect).not.toBeNull();
    expect(Array.from(rateSelect.options).map((option) => option.value)).toEqual([
      '0.75',
      '0.9',
      '1',
      '1.15',
      '1.3',
      '1.5',
      '1.75',
      '2',
    ]);
    const gapSelect = container.querySelector('select[aria-label="Khoảng nghỉ giữa các đoạn"]');
    expect(gapSelect).not.toBeNull();
    expect(Array.from(gapSelect.options).map((option) => option.value)).toEqual([
      '0',
      '200',
      '400',
      '700',
      '1000',
    ]);
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuemin')).toBe('0');
    expect(progress?.getAttribute('aria-valuemax')).toBe('1');
    expect(progress?.getAttribute('aria-valuenow')).toBe('0');
    expect(container.textContent).toContain('Đã đọc 0/1');
    expect(container.textContent).toContain('áp dụng từ đoạn tiếp theo');
    expect(container.querySelector('button[aria-label="Dừng đọc chương"]')).not.toBeNull();
    expect(container.textContent).toMatch(/không qua máy chủ StoryForge/iu);

    const playbackToggle = container.querySelector('.chapter-speech-playback-toggle');
    expect(playbackToggle?.getAttribute('aria-label')).toBe('Bắt đầu nghe chương');

    await act(async () => playbackToggle.click());
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(playbackToggle.getAttribute('aria-label')).toBe('Tạm dừng đọc chương');

    await act(async () => playbackToggle.click());
    expect(synth.pause).toHaveBeenCalledTimes(1);
    expect(playbackToggle.getAttribute('aria-label')).toBe('Tiếp tục đọc chương');

    await act(async () => playbackToggle.click());
    expect(synth.resume).toHaveBeenCalledTimes(1);

    await act(async () => trigger.click());
    expect(container.querySelector('.chapter-speech-panel')).toBeNull();
    expect(synth.pause).toHaveBeenCalledTimes(1);
  });

  it('defaults to the fast Google source on connected PCs even when a device voice exists', async () => {
    const synth = new FakeSpeechSynthesis([createVoice({ name: 'Microsoft An' })]);
    await renderControl(synth, { fetchImpl: vi.fn() });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());

    expect(container.querySelector('select[aria-label="Chọn giọng đọc"]')?.value)
      .toBe('google-free:vi');
  });

  it('offers Hoài My and Nam Minh on a PC without device voices and asks before sending text', async () => {
    const synth = new FakeSpeechSynthesis();
    const audio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' })),
    });
    await renderControl(synth, {
      fetchImpl,
      createAudio: () => audio,
      createObjectURL: () => 'blob:edge',
      revokeObjectURL: vi.fn(),
    });

    const trigger = container.querySelector('.chapter-speech-trigger');
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());

    const sourceSelect = container.querySelector('select[aria-label="Chọn giọng đọc"]');
    expect(sourceSelect.textContent).toContain('Chị Google');
    expect(sourceSelect.textContent).toContain('Hoài My');
    expect(sourceSelect.textContent).toContain('Nam Minh');
    expect(fetchImpl).not.toHaveBeenCalled();
    const consent = container.querySelector(
      'input[aria-label="Cho phép gửi các đoạn sắp nghe tới nguồn giọng online"]',
    );
    expect(consent).not.toBeNull();

    await act(async () => {
      consent.click();
    });
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Online thử nghiệm');
    expect(container.textContent).not.toContain('VIP');
  });

  it('waits for the complete startup buffer before playing and then continues background loading', async () => {
    window.localStorage.setItem('storyforge.chapter-speech.online-consent-v3-prefetch', 'granted');
    const pending = [];
    const audio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const fetchImpl = vi.fn((_url, options) => new Promise((resolve) => {
      pending.push({ resolve, text: JSON.parse(options.body).text });
    }));
    const scenes = Array.from({ length: 5 }, (_, index) => createScene({
      id: index + 1,
      order_index: index,
      draft_text: `<p>Đoạn thứ ${index + 1}.</p>`,
    }));
    await renderControl(new FakeSpeechSynthesis(), {
      fetchImpl,
      createAudio: () => audio,
      createObjectURL: () => 'blob:startup-buffer',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024 * 1024,
        initialReadyCount: 3,
        targetReadyCount: 5,
        prefetchNextChapter: false,
        backgroundDelayMs: 0,
      },
    }, { scenes });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    expect(audio.play).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Tải đủ 3 đoạn rồi mới phát');
    expect(container.textContent).toContain('đang tải đoạn tiếp theo');

    await act(async () => {
      pending.splice(0, 2).forEach(({ resolve }) => resolve({
        ok: true,
        blob: async () => new Blob(['mp3'], { type: 'audio/mpeg' }),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(audio.play).not.toHaveBeenCalled();

    await act(async () => {
      pending.shift().resolve({
        ok: true,
        blob: async () => new Blob(['mp3'], { type: 'audio/mpeg' }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(3);
  });

  it('restarts the startup buffer when the online voice changes before playback begins', async () => {
    window.localStorage.setItem('storyforge.chapter-speech.online-consent-v3-prefetch', 'granted');
    const requests = [];
    const audio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const fetchImpl = vi.fn((url, options) => new Promise((resolve, reject) => {
      const request = { url, resolve, signal: options.signal };
      requests.push(request);
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'));
      }, { once: true });
    }));
    await renderControl(new FakeSpeechSynthesis(), {
      fetchImpl,
      createAudio: () => audio,
      createObjectURL: () => 'blob:changed-startup-voice',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024 * 1024,
        initialReadyCount: 2,
        targetReadyCount: 2,
        prefetchNextChapter: false,
        backgroundDelayMs: 0,
      },
    }, {
      scenes: [
        createScene({ id: 1, order_index: 0, draft_text: '<p>Đoạn một.</p>' }),
        createScene({ id: 2, order_index: 1, draft_text: '<p>Đoạn hai.</p>' }),
      ],
    });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    const sourceSelect = container.querySelector('select[aria-label="Chọn giọng đọc"]');
    await act(async () => {
      sourceSelect.value = 'edge:hoai-my';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(requests.slice(0, 2).every(({ signal }) => signal.aborted)).toBe(true);
    expect(requests.slice(2).map(({ url }) => url)).toEqual([
      '/api/tts/edge',
      '/api/tts/edge',
    ]);

    await act(async () => {
      requests.slice(2).forEach(({ resolve }) => resolve({
        ok: true,
        blob: async () => new Blob(['mp3'], { type: 'audio/mpeg' }),
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('moves PCs off the previous slow Edge default and selects the measured fast Google source', async () => {
    window.localStorage.setItem('storyforge.chapter-speech.voice', 'edge:hoai-my');
    await renderControl(new FakeSpeechSynthesis(), { fetchImpl: vi.fn() });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());

    expect(container.querySelector('select[aria-label="Chọn giọng đọc"]')?.value)
      .toBe('google-free:vi');
  });

  it('asks again when preload expands an older Edge consent to more story segments', async () => {
    window.localStorage.setItem('storyforge.chapter-speech.edge-consent-v1', 'granted');
    const fetchImpl = vi.fn();
    await renderControl(new FakeSpeechSynthesis(), { fetchImpl });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(container.querySelector(
      'input[aria-label="Cho phép gửi các đoạn sắp nghe tới nguồn giọng online"]',
    )?.checked).toBe(false);
  });

  it('preloads the current chapter before continuing into the next chapter', async () => {
    window.localStorage.setItem('storyforge.chapter-speech.online-consent-v3-prefetch', 'granted');
    const synth = new FakeSpeechSynthesis();
    const fetchImpl = vi.fn((_url, options) => Promise.resolve({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob([
        JSON.parse(options.body).text,
      ], { type: 'audio/mpeg' })),
    }));
    await renderControl(synth, {
      fetchImpl,
      createAudio: () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        load: vi.fn(),
        removeAttribute: vi.fn(),
      }),
      createObjectURL: () => 'blob:prefetched-chapter',
      revokeObjectURL: vi.fn(),
      prefetchPolicy: {
        maxConcurrent: 2,
        maxBytes: 1024,
        prefetchNextChapter: true,
        backgroundDelayMs: 0,
      },
    }, {
      nextChapterId: 20,
      scenes: [
        createScene({ draft_text: '<p>Đoạn của chương hiện tại.</p>' }),
        createScene({
          id: 2,
          chapter_id: 20,
          draft_text: '<p>Đoạn đầu chương kế tiếp.</p>',
        }),
      ],
    });

    await act(async () => container.querySelector('.chapter-speech-trigger').click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body).text)).toEqual([
      'Đoạn của chương hiện tại.',
      'Đoạn đầu chương kế tiếp.',
    ]);
    expect(container.textContent).toContain('Bộ đệm trượt 20 đoạn: chương này, rồi chương kế tiếp.');
  });

  it('shows Google TTS as a device source instead of pretending it is a StoryForge cloud voice', async () => {
    const synth = new FakeSpeechSynthesis([createVoice({
      name: 'Google Tiếng Việt',
      voiceURI: 'com.google.android.tts:vi-VN',
    })]);
    await renderControl(synth);

    await act(async () => container.querySelector('.chapter-speech-trigger').click());

    expect(container.querySelector('select[aria-label="Chọn giọng đọc"]').textContent)
      .toContain('Google TTS · trên thiết bị');
    expect(container.textContent).not.toContain('Google Cloud');
    expect(container.textContent).not.toContain('VIP');
  });

  it('presents installed Google Android voices with stable Vietnamese labels', async () => {
    window.localStorage.setItem(
      'storyforge.chapter-speech.voice-v2-fast-default',
      'device:vi-vn-x-gft-local::Vietnamese 1::vi-VN',
    );
    const synth = new FakeSpeechSynthesis([
      createVoice({ name: 'Vietnamese 5', voiceURI: 'vi-vn-x-vif-local' }),
      createVoice({ name: 'Vietnamese 3', voiceURI: 'vi-vn-x-vid-local' }),
      createVoice({ name: 'Vietnamese 1', voiceURI: 'vi-vn-x-gft-local' }),
      createVoice({ name: 'Vietnamese 4', voiceURI: 'vi-vn-x-vie-local' }),
      createVoice({ name: 'Vietnamese 2', voiceURI: 'vi-vn-x-vic-local' }),
    ]);
    await renderControl(synth);

    await act(async () => container.querySelector('.chapter-speech-trigger').click());

    const options = Array.from(
      container.querySelectorAll('select[aria-label="Chọn giọng đọc"] optgroup[label="Trên thiết bị"] option'),
      (option) => option.textContent,
    );
    expect(options).toEqual([
      'Tiếng Việt 1 (gft) · Google TTS · đã cài trên thiết bị',
      'Tiếng Việt 2 (vic) · Google TTS · đã cài trên thiết bị',
      'Tiếng Việt 3 (vid) · Google TTS · đã cài trên thiết bị',
      'Tiếng Việt 4 (vie) · Google TTS · đã cài trên thiết bị',
      'Tiếng Việt 5 (vif) · Google TTS · đã cài trên thiết bị',
    ]);
    expect(container.textContent).toContain('Đã tìm thấy 5 giọng Google TTS miễn phí trên thiết bị.');
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    expect(synth.speak.mock.calls[0][0].voice.voiceURI).toBe('vi-vn-x-gft-local');
  });

  it('updates the voice picker when Chrome publishes voices asynchronously', async () => {
    const synth = new FakeSpeechSynthesis();
    await renderControl(synth);

    const trigger = container.querySelector('.chapter-speech-trigger');
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    expect(container.querySelector('.chapter-speech-panel')).not.toBeNull();

    synth.voices = [createVoice({ name: 'Giọng Việt vừa nạp' })];
    await act(async () => synth.emit('voiceschanged'));

    expect(container.querySelector('select[aria-label="Chọn giọng đọc"]').textContent)
      .toContain('Giọng Việt vừa nạp');
  });

  it('never exposes or falls back to a non-Vietnamese device voice', async () => {
    const synth = new FakeSpeechSynthesis([
      createVoice({ name: 'English default', lang: 'en-US', voiceURI: 'en', default: true }),
    ]);
    await renderControl(synth);

    const trigger = container.querySelector('.chapter-speech-trigger');
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    expect(container.textContent).not.toContain('English default');

    synth.voices = [
      createVoice({ name: 'English default', lang: 'en-US', voiceURI: 'en', default: true }),
      createVoice({ name: 'Giọng Việt', lang: 'vi-VN', voiceURI: 'vi' }),
    ];
    await act(async () => synth.emit('voiceschanged'));
    const sourceSelect = container.querySelector('select[aria-label="Chọn giọng đọc"]');
    await act(async () => {
      sourceSelect.value = `device:${voiceKeyForTest(synth.voices[1])}`;
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());

    const voiceOptions = Array.from(
      container.querySelectorAll('select[aria-label="Chọn giọng đọc"] optgroup[label="Trên thiết bị"] option'),
    );
    expect(voiceOptions).toHaveLength(1);
    expect(voiceOptions[0].textContent).toContain('Giọng Việt');
    expect(container.textContent).not.toContain('English default');
    expect(synth.speak.mock.calls[0][0].voice).toMatchObject({ lang: 'vi-VN' });
  });

  it('stops safely if Vietnamese voices disappear during playback', async () => {
    const voice = createVoice({ voiceURI: 'vi' });
    window.localStorage.setItem(
      'storyforge.chapter-speech.voice-v2-fast-default',
      `device:${voiceKeyForTest(voice)}`,
    );
    const synth = new FakeSpeechSynthesis([voice]);
    await renderControl(synth);

    const trigger = container.querySelector('.chapter-speech-trigger');
    await act(async () => trigger.click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    const staleUtterance = synth.speak.mock.calls[0][0];

    synth.voices = [createVoice({ name: 'English fallback', lang: 'en-US', voiceURI: 'en' })];
    await act(async () => synth.emit('voiceschanged'));

    expect(staleUtterance.onend).toBeNull();
    expect(trigger.disabled).toBe(false);
    expect(container.querySelector('.chapter-speech-panel')).toBeNull();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('keeps free online playback available when the PC browser has no speech synthesis support', async () => {
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    root = createRoot(container);

    await act(async () => {
      root.render(<ChapterSpeechControl chapterId={10} scenes={[createScene()]} />);
    });

    const trigger = container.querySelector('.chapter-speech-trigger');
    expect(trigger.disabled).toBe(false);
    expect(trigger.title).toBe('Mở điều khiển nghe chương');
  });

  it('cancels playback when the reader unmounts', async () => {
    const voice = createVoice();
    window.localStorage.setItem(
      'storyforge.chapter-speech.voice-v2-fast-default',
      `device:${voiceKeyForTest(voice)}`,
    );
    const synth = new FakeSpeechSynthesis([voice]);
    await renderControl(synth);

    await act(async () => container.querySelector('.chapter-speech-trigger').click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    await act(async () => root.unmount());
    root = null;

    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it('keeps controls open for equivalent content but resets for a new chapter', async () => {
    const voice = createVoice();
    window.localStorage.setItem(
      'storyforge.chapter-speech.voice-v2-fast-default',
      `device:${voiceKeyForTest(voice)}`,
    );
    const synth = new FakeSpeechSynthesis([voice]);
    await renderControl(synth);

    await act(async () => container.querySelector('.chapter-speech-trigger').click());
    await act(async () => container.querySelector('.chapter-speech-playback-toggle').click());
    expect(container.querySelector('.chapter-speech-panel')).not.toBeNull();

    await act(async () => {
      root.render(
        <ChapterSpeechControl
          chapterId={10}
          scenes={[createScene({ title: 'Metadata mới', draft_text: '<p>Trời đổ mưa. Họ chạy vào hiên.</p>' })]}
        />,
      );
    });

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.chapter-speech-panel')).not.toBeNull();

    await act(async () => {
      root.render(
        <ChapterSpeechControl
          chapterId={20}
          scenes={[createScene({ chapter_id: 20, draft_text: '<p>Trời đổ mưa. Họ chạy vào hiên.</p>' })]}
        />,
      );
    });

    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.chapter-speech-panel')).toBeNull();
  });
});
