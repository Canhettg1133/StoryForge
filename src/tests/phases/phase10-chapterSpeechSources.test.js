import { describe, expect, it, vi } from 'vitest';

import {
  EDGE_VIETNAMESE_SOURCES,
  GOOGLE_FREE_VIETNAMESE_SOURCES,
  createChapterSpeechPlaybackFactory,
} from '../../components/editor/chapterSpeechSources.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function createAudioHarness() {
  const audio = {
    src: '',
    playbackRate: 1,
    onended: null,
    onerror: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  };
  return audio;
}

function createDeviceSpeech() {
  const synth = {
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const voice = {
    name: 'Microsoft An',
    lang: 'vi-VN',
    voiceURI: 'microsoft-an',
    localService: true,
  };
  return { synth, voice };
}

describe('chapter speech sources', () => {
  it('publishes only the two Vietnamese Edge voices selected for the free online source', () => {
    expect(EDGE_VIETNAMESE_SOURCES).toEqual([
      expect.objectContaining({
        key: 'edge:hoai-my',
        kind: 'edge',
        voiceId: 'hoai-my',
        name: 'Hoài My',
        language: 'vi-VN',
      }),
      expect.objectContaining({
        key: 'edge:nam-minh',
        kind: 'edge',
        voiceId: 'nam-minh',
        name: 'Nam Minh',
        language: 'vi-VN',
      }),
    ]);
  });

  it('requires explicit consent before sending a story segment to the online source', async () => {
    const fetchImpl = vi.fn();
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => false,
    });

    await expect(factory.createPlayback({
      text: 'Một đoạn truyện riêng tư.',
      source: EDGE_VIETNAMESE_SOURCES[0],
      rate: 1,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    })).rejects.toMatchObject({ code: 'ONLINE_SPEECH_CONSENT_REQUIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches the fast Google Vietnamese source through the same-origin private route', async () => {
    const audio = createAudioHarness();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' })),
    });
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => audio,
      createObjectURL: () => 'blob:google-audio',
      revokeObjectURL: vi.fn(),
    });

    const playback = await factory.createPlayback({
      text: 'Trời đổ mưa.',
      source: GOOGLE_FREE_VIETNAMESE_SOURCES[0],
      rate: 1.3,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    });
    await playback.play();

    expect(fetchImpl).toHaveBeenCalledWith('/api/tts/google-free', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'Trời đổ mưa.' }),
      signal: expect.any(AbortSignal),
    }));
    expect(audio.playbackRate).toBe(1.3);
  });

  it('fetches private MP3 audio from the same-origin Edge route and plays at the selected rate', async () => {
    const audio = createAudioHarness();
    const createObjectURL = vi.fn(() => 'blob:edge-audio');
    const revokeObjectURL = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' })),
    });
    const onEnded = vi.fn();
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl,
      isOnlineAllowed: () => true,
      createAudio: () => audio,
      createObjectURL,
      revokeObjectURL,
    });

    const playback = await factory.createPlayback({
      text: 'Trời đổ mưa.',
      source: EDGE_VIETNAMESE_SOURCES[1],
      rate: 1.75,
      signal: new AbortController().signal,
      onEnded,
      onError: vi.fn(),
    });
    playback.play();

    expect(fetchImpl).toHaveBeenCalledWith('/api/tts/edge', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Trời đổ mưa.', voiceId: 'nam-minh' }),
      signal: expect.any(AbortSignal),
    }));
    expect(audio.src).toBe('blob:edge-audio');
    expect(audio.playbackRate).toBe(1.75);
    expect(audio.play).toHaveBeenCalledTimes(1);

    audio.onended();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:edge-audio');
  });

  it('rejects a successful response that does not contain audio', async () => {
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['{}'], { type: 'application/json' })),
      }),
      isOnlineAllowed: () => true,
    });

    await expect(factory.createPlayback({
      text: 'Phản hồi này không phải âm thanh.',
      source: EDGE_VIETNAMESE_SOURCES[0],
      rate: 1,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    })).rejects.toMatchObject({ code: 'ONLINE_SPEECH_INVALID_AUDIO' });
  });

  it('releases generated audio when resuming playback fails', async () => {
    const audio = createAudioHarness();
    audio.play
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('resume blocked'));
    const revokeObjectURL = vi.fn();
    const factory = createChapterSpeechPlaybackFactory({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' })),
      }),
      isOnlineAllowed: () => true,
      createAudio: () => audio,
      createObjectURL: () => 'blob:resume-audio',
      revokeObjectURL,
    });
    const playback = await factory.createPlayback({
      text: 'Tạm dừng rồi đọc tiếp.',
      source: EDGE_VIETNAMESE_SOURCES[0],
      rate: 1,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    });

    await playback.play();
    playback.pause();
    await expect(playback.resume()).rejects.toThrow('resume blocked');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:resume-audio');
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledTimes(1);
  });

  it('falls back to an installed Vietnamese device voice when Edge is unavailable', async () => {
    const { synth, voice } = createDeviceSpeech();
    const onFallback = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const factory = createChapterSpeechPlaybackFactory({
      synth,
      Utterance: FakeUtterance,
      getFallbackVoice: () => voice,
      isOnlineAllowed: () => true,
      fetchImpl,
      onFallback,
    });

    const playback = await factory.createPlayback({
      text: 'Đọc tiếp bằng giọng thiết bị.',
      source: EDGE_VIETNAMESE_SOURCES[0],
      rate: 1.3,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    });
    playback.play();

    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({
      source: EDGE_VIETNAMESE_SOURCES[0],
      fallbackVoice: voice,
    }));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0]).toMatchObject({
      text: 'Đọc tiếp bằng giọng thiết bị.',
      voice,
      lang: 'vi-VN',
      rate: 1.3,
    });

    const nextPlayback = await factory.createPlayback({
      text: 'Đoạn kế tiếp vẫn phải đọc được.',
      source: EDGE_VIETNAMESE_SOURCES[0],
      rate: 1.3,
      signal: new AbortController().signal,
      onEnded: vi.fn(),
      onError: vi.fn(),
    });
    nextPlayback.play();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

});
