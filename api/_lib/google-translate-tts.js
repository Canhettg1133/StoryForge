const GOOGLE_TRANSLATE_TTS_URL = 'https://translate.google.com/translate_tts';
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

function ttsError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ').trim();
}

export async function synthesizeGoogleTranslateSpeech({
  text,
  signal,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedText = cleanText(text);
  if (!normalizedText) throw ttsError('TTS_TEXT_REQUIRED');
  if (normalizedText.length > 200) throw ttsError('TTS_TEXT_TOO_LONG');

  const url = new URL(GOOGLE_TRANSLATE_TTS_URL);
  url.search = new URLSearchParams({
    ie: 'UTF-8',
    tl: 'vi',
    client: 'tw-ob',
    q: normalizedText,
  });
  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort(signal?.reason);
  const timeout = setTimeout(() => abortController.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  signal?.addEventListener('abort', abortFromRequest, { once: true });

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'audio/mpeg' },
      signal: abortController.signal,
    });
    if (!response.ok) throw ttsError('TTS_PROVIDER_UNAVAILABLE');
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('audio/mpeg')) throw ttsError('TTS_PROVIDER_INVALID_AUDIO');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_AUDIO_BYTES) throw ttsError('TTS_PROVIDER_AUDIO_TOO_LARGE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw ttsError('TTS_PROVIDER_NO_AUDIO');
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw ttsError('TTS_PROVIDER_AUDIO_TOO_LARGE');
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('TTS request cancelled.', 'AbortError');
    if (abortController.signal.aborted) throw ttsError('TTS_PROVIDER_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromRequest);
  }
}
