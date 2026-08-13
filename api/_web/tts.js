import { getClientIp } from '../_lib/http.js';
import { checkRateLimit } from '../_lib/rate-limit.js';
import {
  getRequestId,
  normalizeRuntime,
  publicErrorResponse,
  readJsonRequest,
} from '../_lib/web.js';
import {
  EDGE_VIETNAMESE_VOICES,
  synthesizeEdgeSpeech,
} from '../_lib/edge-tts.js';
import { synthesizeGoogleTranslateSpeech } from '../_lib/google-translate-tts.js';

const MAX_BODY_BYTES = 4096;
const MAX_TEXT_LENGTH = 600;

async function hashIdentity(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value || 'unknown')),
  );
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
}

async function enforceRateLimit(request, runtime) {
  const identity = await hashIdentity(getClientIp(request) || 'unknown');
  const limiter = runtime.env?.TTS_EDGE_RATE_LIMITER;
  if (limiter?.limit) {
    try {
      const result = await limiter.limit({ key: `ip:${identity}` });
      if (!result?.success) {
        throw Object.assign(new Error('TTS_RATE_LIMITED'), {
          code: 'TTS_RATE_LIMITED',
          status: 429,
        });
      }
      return;
    } catch (error) {
      if (error?.code === 'TTS_RATE_LIMITED') throw error;
      throw Object.assign(new Error('TTS_RATE_LIMIT_UNAVAILABLE'), {
        code: 'TTS_PROVIDER_UNAVAILABLE',
        status: 503,
      });
    }
  }

  const result = checkRateLimit(request, {
    keyPrefix: 'tts-edge',
    identity: `ip:${identity}`,
    limit: 90,
    windowMs: 60_000,
  });
  if (!result.allowed) {
    throw Object.assign(new Error('TTS_RATE_LIMITED'), {
      code: 'TTS_RATE_LIMITED',
      status: 429,
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

function validatePayload(payload) {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    throw Object.assign(new Error('TTS_TEXT_REQUIRED'), {
      code: 'TTS_TEXT_REQUIRED',
      status: 422,
    });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw Object.assign(new Error('TTS_TEXT_TOO_LONG'), {
      code: 'TTS_TEXT_TOO_LONG',
      status: 413,
    });
  }
  const voiceId = String(payload?.voiceId || '');
  if (!Object.hasOwn(EDGE_VIETNAMESE_VOICES, voiceId)) {
    throw Object.assign(new Error('TTS_VOICE_NOT_ALLOWED'), {
      code: 'TTS_VOICE_NOT_ALLOWED',
      status: 422,
    });
  }
  return { text, voiceId };
}

function publicMessage(code) {
  if (code === 'METHOD_NOT_ALLOWED') return 'Chỉ hỗ trợ yêu cầu POST.';
  if (code === 'TTS_CONTENT_TYPE_REQUIRED') return 'Yêu cầu giọng đọc phải dùng JSON.';
  if (code === 'TTS_INVALID_JSON') return 'Dữ liệu giọng đọc không hợp lệ.';
  if (code === 'TTS_TEXT_REQUIRED') return 'Đoạn cần đọc đang trống.';
  if (code === 'TTS_TEXT_TOO_LONG') return 'Đoạn cần đọc quá dài.';
  if (code === 'TTS_VOICE_NOT_ALLOWED') return 'Giọng đọc không được hỗ trợ.';
  if (code === 'TTS_RATE_LIMITED') return 'Đang có quá nhiều yêu cầu đọc. Hãy thử lại sau.';
  return 'Giọng online đang tạm thời gián đoạn.';
}

export function createEdgeTtsWebHandler({
  synthesize = synthesizeEdgeSpeech,
} = {}) {
  return async function edgeTtsWebHandler(request, runtimeInput = {}) {
    const runtime = normalizeRuntime(runtimeInput);
    const requestId = getRequestId(request);
    try {
      if (request.method !== 'POST') {
        throw Object.assign(new Error('METHOD_NOT_ALLOWED'), {
          code: 'METHOD_NOT_ALLOWED',
          status: 405,
        });
      }
      if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') || '')) {
        throw Object.assign(new Error('TTS_CONTENT_TYPE_REQUIRED'), {
          code: 'TTS_CONTENT_TYPE_REQUIRED',
          status: 415,
        });
      }
      await enforceRateLimit(request, runtime);
      const payload = await readJsonRequest(request, { maxBytes: MAX_BODY_BYTES });
      const { text, voiceId } = validatePayload(payload);
      const abortController = new AbortController();
      const abortFromRequest = () => abortController.abort();
      request.signal?.addEventListener('abort', abortFromRequest, { once: true });
      let audio;
      try {
        audio = await synthesize({
          text,
          voiceId,
          signal: abortController.signal,
          runtime,
        });
      } finally {
        request.signal?.removeEventListener('abort', abortFromRequest);
      }
      const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
      if (bytes.byteLength === 0) throw new Error('TTS_PROVIDER_NO_AUDIO');
      return new Response(bytes, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Length': String(bytes.byteLength),
          'Content-Type': 'audio/mpeg',
          'X-Content-Type-Options': 'nosniff',
          'X-Request-Id': requestId,
        },
      });
    } catch (error) {
      const knownCode = error?.code;
      const invalidJson = error instanceof SyntaxError;
      const status = Number(error?.status)
        || (knownCode === 'JSON_BODY_TOO_LARGE' ? 413 : invalidJson ? 400 : 503);
      const code = knownCode === 'JSON_BODY_TOO_LARGE'
        ? 'TTS_TEXT_TOO_LONG'
        : invalidJson
          ? 'TTS_INVALID_JSON'
        : knownCode && status < 500
          ? knownCode
          : 'TTS_PROVIDER_UNAVAILABLE';
      if (status >= 500) {
        console.warn('[storyforge-tts] provider request failed', {
          code: error?.code || 'TTS_PROVIDER_UNAVAILABLE',
          requestId,
        });
      }
      return publicErrorResponse(request, status, {
        code,
        error: publicMessage(code),
        requestId,
        retryAfterSeconds: error?.retryAfterSeconds || 0,
        headers: status === 405 ? { Allow: 'POST' } : {},
      });
    }
  };
}

export function createGoogleFreeTtsWebHandler({
  synthesize = synthesizeGoogleTranslateSpeech,
} = {}) {
  return async function googleFreeTtsWebHandler(request, runtimeInput = {}) {
    const runtime = normalizeRuntime(runtimeInput);
    const requestId = getRequestId(request);
    try {
      if (request.method !== 'POST') {
        throw Object.assign(new Error('METHOD_NOT_ALLOWED'), {
          code: 'METHOD_NOT_ALLOWED',
          status: 405,
        });
      }
      if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') || '')) {
        throw Object.assign(new Error('TTS_CONTENT_TYPE_REQUIRED'), {
          code: 'TTS_CONTENT_TYPE_REQUIRED',
          status: 415,
        });
      }
      await enforceRateLimit(request, runtime);
      const payload = await readJsonRequest(request, { maxBytes: MAX_BODY_BYTES });
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text) {
        throw Object.assign(new Error('TTS_TEXT_REQUIRED'), {
          code: 'TTS_TEXT_REQUIRED',
          status: 422,
        });
      }
      if (text.length > 200) {
        throw Object.assign(new Error('TTS_TEXT_TOO_LONG'), {
          code: 'TTS_TEXT_TOO_LONG',
          status: 413,
        });
      }
      const abortController = new AbortController();
      const abortFromRequest = () => abortController.abort();
      request.signal?.addEventListener('abort', abortFromRequest, { once: true });
      let audio;
      try {
        audio = await synthesize({ text, signal: abortController.signal, runtime });
      } finally {
        request.signal?.removeEventListener('abort', abortFromRequest);
      }
      const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
      if (bytes.byteLength === 0) throw new Error('TTS_PROVIDER_NO_AUDIO');
      return new Response(bytes, {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Length': String(bytes.byteLength),
          'Content-Type': 'audio/mpeg',
          'X-Content-Type-Options': 'nosniff',
          'X-Request-Id': requestId,
        },
      });
    } catch (error) {
      const knownCode = error?.code;
      const invalidJson = error instanceof SyntaxError;
      const status = Number(error?.status)
        || (knownCode === 'JSON_BODY_TOO_LARGE' ? 413 : invalidJson ? 400 : 503);
      const code = knownCode === 'JSON_BODY_TOO_LARGE'
        ? 'TTS_TEXT_TOO_LONG'
        : invalidJson
          ? 'TTS_INVALID_JSON'
          : knownCode && status < 500
            ? knownCode
            : 'TTS_PROVIDER_UNAVAILABLE';
      if (status >= 500) {
        console.warn('[storyforge-tts] Google source request failed', {
          code: error?.code || 'TTS_PROVIDER_UNAVAILABLE',
          requestId,
        });
      }
      return publicErrorResponse(request, status, {
        code,
        error: publicMessage(code),
        requestId,
        retryAfterSeconds: error?.retryAfterSeconds || 0,
        headers: status === 405 ? { Allow: 'POST' } : {},
      });
    }
  };
}
