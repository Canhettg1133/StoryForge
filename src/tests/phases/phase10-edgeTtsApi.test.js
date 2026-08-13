import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEdgeSpeechRequest,
  parseEdgeAudioFrame,
  synthesizeEdgeSpeech,
} from '../../../api/_lib/edge-tts.js';
import { synthesizeGoogleTranslateSpeech } from '../../../api/_lib/google-translate-tts.js';
import {
  createEdgeTtsWebHandler,
  createGoogleFreeTtsWebHandler,
} from '../../../api/_web/tts.js';
import { clearRateLimitState } from '../../../api/_lib/rate-limit.js';
import { handleStoryForgeWorkerRequest } from '../../../worker/index.js';

function createRequest(body, options = {}) {
  return new Request('https://storyforge.test/api/tts/edge', {
    method: options.method || 'POST',
    headers: {
      'Content-Type': options.contentType || 'application/json',
      'CF-Connecting-IP': options.ip || '203.0.113.10',
    },
    body: (options.method || 'POST') === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function createAudioFrame(audio) {
  const header = new TextEncoder().encode('Path:audio\r\nContent-Type:audio/mpeg\r\n');
  const frame = new Uint8Array(2 + header.length + audio.length);
  frame[0] = (header.length >> 8) & 0xff;
  frame[1] = header.length & 0xff;
  frame.set(header, 2);
  frame.set(audio, 2 + header.length);
  return frame;
}

describe('Edge/Bing Vietnamese TTS protocol', () => {
  it('escapes story text and only emits a whitelisted Vietnamese voice', async () => {
    const request = await buildEdgeSpeechRequest({
      text: 'An nói: <đừng đi> & "hãy ở lại".',
      voiceId: 'hoai-my',
      now: new Date('2026-08-13T00:00:00.000Z'),
      connectionId: 'connection-id',
      requestId: 'request-id',
    });

    expect(request.url).toContain('TrustedClientToken=');
    expect(request.url).toContain('ConnectionId=connection-id');
    expect(request.url).toMatch(/Sec-MS-GEC=[A-F0-9]{64}/u);
    expect(request.ssmlMessage).toContain("name='vi-VN-HoaiMyNeural'");
    expect(request.ssmlMessage).toContain('&lt;đừng đi&gt; &amp; &quot;hãy ở lại&quot;');
    expect(request.ssmlMessage).not.toContain('<đừng đi>');
  });

  it('uses the UTC timestamp format required by the Edge speech protocol', async () => {
    const request = await buildEdgeSpeechRequest({
      text: 'Xin chào.',
      voiceId: 'hoai-my',
      now: new Date('2026-08-13T05:06:07.000Z'),
      connectionId: 'connection-id',
      requestId: 'request-id',
    });

    const expectedTimestamp = 'Thu Aug 13 2026 05:06:07 GMT+0000 (Coordinated Universal Time)';
    expect(request.configMessage).toContain(`X-Timestamp:${expectedTimestamp}\r\n`);
    expect(request.ssmlMessage).toContain(`X-Timestamp:${expectedTimestamp}Z\r\n`);
  });

  it('rejects voice ids that are not in the server catalog', async () => {
    await Promise.all(['en-us-unknown', '__proto__', 'constructor'].map((voiceId) => (
      expect(buildEdgeSpeechRequest({
        text: 'Xin chào.',
        voiceId,
      })).rejects.toMatchObject({ code: 'TTS_VOICE_NOT_ALLOWED' })
    )));
  });

  it('aborts while the provider connection is still opening', async () => {
    const abortController = new AbortController();
    const synthesis = synthesizeEdgeSpeech({
      text: 'Không được treo request.',
      voiceId: 'hoai-my',
      signal: abortController.signal,
      connect: () => new Promise(() => {}),
    });
    await Promise.resolve();
    abortController.abort();

    await expect(synthesis).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('extracts only the audio payload from an Edge binary frame', () => {
    const audio = Uint8Array.from([0xff, 0xf3, 1, 2, 3, 4]);
    const frame = createAudioFrame(audio);

    expect(Array.from(parseEdgeAudioFrame(frame))).toEqual([0xff, 0xf3, 1, 2, 3, 4]);
  });

  it('uses the Cloudflare outbound WebSocket path and joins provider audio frames', async () => {
    const socket = new EventTarget();
    socket.accept = vi.fn();
    socket.close = vi.fn();
    socket.send = vi.fn((message) => {
      if (!String(message).includes('Path:ssml')) return;
      queueMicrotask(() => {
        socket.dispatchEvent(new MessageEvent('message', {
          data: createAudioFrame(Uint8Array.from([0x49, 0x44, 0x33, 7])),
        }));
        socket.dispatchEvent(new MessageEvent('message', { data: 'Path:turn.end\r\n' }));
      });
    });
    const fetchImpl = vi.fn().mockResolvedValue({ webSocket: socket });

    const audio = await synthesizeEdgeSpeech({
      text: 'Xin chào từ Cloudflare.',
      voiceId: 'nam-minh',
      runtime: { platform: 'cloudflare' },
      fetchImpl,
      timeoutMs: 1000,
    });

    expect(Array.from(audio)).toEqual([0x49, 0x44, 0x33, 7]);
    expect(socket.accept).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/speech\.platform\.bing\.com\//u),
      expect.objectContaining({
        headers: expect.objectContaining({ Upgrade: 'websocket' }),
      }),
    );
  });
});

describe('/api/tts/edge', () => {
  beforeEach(() => clearRateLimitState());

  it('returns private MP3 audio for a valid Vietnamese segment', async () => {
    const synthesize = vi.fn().mockResolvedValue(Uint8Array.from([0x49, 0x44, 0x33, 1]));
    const response = await createEdgeTtsWebHandler({ synthesize })(
      createRequest({ text: 'Trời đổ mưa.', voiceId: 'hoai-my' }),
      { platform: 'cloudflare', env: {} },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await response.arrayBuffer())))
      .toEqual([0x49, 0x44, 0x33, 1]);
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Trời đổ mưa.',
      voiceId: 'hoai-my',
      signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    ['GET requests', createRequest(null, { method: 'GET' }), 405, 'METHOD_NOT_ALLOWED'],
    ['non-JSON bodies', createRequest({}, { contentType: 'text/plain' }), 415, 'TTS_CONTENT_TYPE_REQUIRED'],
    ['empty text', createRequest({ text: '   ', voiceId: 'hoai-my' }), 422, 'TTS_TEXT_REQUIRED'],
    ['oversized segments', createRequest({ text: 'a'.repeat(601), voiceId: 'hoai-my' }), 413, 'TTS_TEXT_TOO_LONG'],
    ['unknown voices', createRequest({ text: 'Xin chào.', voiceId: 'unknown' }), 422, 'TTS_VOICE_NOT_ALLOWED'],
    ['inherited object keys', createRequest({ text: 'Xin chào.', voiceId: '__proto__' }), 422, 'TTS_VOICE_NOT_ALLOWED'],
  ])('rejects %s without calling the provider', async (_label, request, status, code) => {
    const synthesize = vi.fn();
    const response = await createEdgeTtsWebHandler({ synthesize })(request, {
      platform: 'cloudflare',
      env: {},
    });

    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without exposing a provider error', async () => {
    const synthesize = vi.fn();
    const request = new Request('https://storyforge.test/api/tts/edge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
      },
      body: '{not-json',
    });
    const response = await createEdgeTtsWebHandler({ synthesize })(request, {
      platform: 'cloudflare',
      env: {},
    });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('TTS_INVALID_JSON');
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('uses the Cloudflare rate-limit binding before synthesis', async () => {
    const synthesize = vi.fn();
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const response = await createEdgeTtsWebHandler({ synthesize })(
      createRequest({ text: 'Xin chào.', voiceId: 'nam-minh' }),
      { platform: 'cloudflare', env: { TTS_EDGE_RATE_LIMITER: limiter } },
    );

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('TTS_RATE_LIMITED');
    expect(limiter.limit).toHaveBeenCalledTimes(1);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('hides provider errors behind a stable public response', async () => {
    const synthesize = vi.fn().mockRejectedValue(new Error('secret upstream detail'));
    const response = await createEdgeTtsWebHandler({ synthesize })(
      createRequest({ text: 'Xin chào.', voiceId: 'nam-minh' }),
      { platform: 'cloudflare', env: {} },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe('TTS_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(payload)).not.toContain('secret upstream detail');
  });

  it('is wired into the StoryForge Cloudflare worker router', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('audio', {
      headers: { 'Content-Type': 'audio/mpeg' },
    }));
    const response = await handleStoryForgeWorkerRequest(
      createRequest({ text: 'Xin chào.', voiceId: 'hoai-my' }),
      {},
      {},
      { handlers: { '/api/tts/edge': handler } },
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is wired into local development and keeps module workers buildable', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');

    expect(viteConfig).toContain("'/api/tts/edge': './api/tts/edge.js'");
    expect(viteConfig).toContain("'/api/tts/google-free': './api/tts/google-free.js'");
    expect(viteConfig).toContain('server.ssrLoadModule(moduleId)');
    expect(viteConfig).toContain("apiPathname.startsWith('/api/tts/')");
  });
});

describe('Google Translate Vietnamese TTS fallback', () => {
  beforeEach(() => clearRateLimitState());

  it('calls only the fixed Google Translate audio origin with Vietnamese text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([0x49, 0x44, 0x33, 1]),
      { headers: { 'Content-Type': 'audio/mpeg' } },
    ));

    const audio = await synthesizeGoogleTranslateSpeech({
      text: 'Trời đổ mưa.',
      fetchImpl,
    });

    const [requestedUrl, options] = fetchImpl.mock.calls[0];
    const url = new URL(requestedUrl);
    expect(url.origin).toBe('https://translate.google.com');
    expect(url.pathname).toBe('/translate_tts');
    expect(url.searchParams.get('tl')).toBe('vi');
    expect(url.searchParams.get('q')).toBe('Trời đổ mưa.');
    expect(options).toMatchObject({ method: 'GET' });
    expect(Array.from(audio)).toEqual([0x49, 0x44, 0x33, 1]);
  });

  it('rejects non-audio provider responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('blocked', {
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(synthesizeGoogleTranslateSpeech({ text: 'Xin chào.', fetchImpl }))
      .rejects.toMatchObject({ code: 'TTS_PROVIDER_INVALID_AUDIO' });
  });

  it('cancels an in-flight provider request when playback is stopped', async () => {
    const requestController = new AbortController();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'));
      }, { once: true });
    }));
    const synthesis = synthesizeGoogleTranslateSpeech({
      text: 'Xin chào.',
      fetchImpl,
      signal: requestController.signal,
    });

    requestController.abort();

    await expect(synthesis).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns private MP3 audio for a valid Google Vietnamese segment', async () => {
    const synthesize = vi.fn().mockResolvedValue(Uint8Array.from([0x49, 0x44, 0x33, 2]));
    const response = await createGoogleFreeTtsWebHandler({ synthesize })(
      createRequest({ text: 'Trời đổ mưa.' }),
      { platform: 'cloudflare', env: {} },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Trời đổ mưa.',
      signal: expect.any(AbortSignal),
    }));
  });

  it('is wired into the StoryForge Cloudflare worker router', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('audio', {
      headers: { 'Content-Type': 'audio/mpeg' },
    }));
    const response = await handleStoryForgeWorkerRequest(
      new Request('https://storyforge.test/api/tts/google-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Xin chào.' }),
      }),
      {},
      {},
      { handlers: { '/api/tts/google-free': handler } },
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects text longer than the measured Google endpoint limit', async () => {
    const synthesize = vi.fn();
    const response = await createGoogleFreeTtsWebHandler({ synthesize })(
      createRequest({ text: 'a'.repeat(201) }),
      { platform: 'cloudflare', env: {} },
    );

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('TTS_TEXT_TOO_LONG');
    expect(synthesize).not.toHaveBeenCalled();
  });
});
