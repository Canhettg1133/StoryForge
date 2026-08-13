const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_VERSION = '143.0.3650.75';
const EDGE_VERSION_HEADER = `1-${EDGE_VERSION}`;
const EDGE_EXTENSION_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export const EDGE_VIETNAMESE_VOICES = Object.freeze({
  'hoai-my': 'vi-VN-HoaiMyNeural',
  'nam-minh': 'vi-VN-NamMinhNeural',
});

function ttsError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function randomId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ');
}

function escapeXml(value) {
  return cleanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function timestampString(date) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return [
    dayNames[date.getUTCDay()],
    monthNames[date.getUTCMonth()],
    String(date.getUTCDate()).padStart(2, '0'),
    date.getUTCFullYear(),
    `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`,
    'GMT+0000 (Coordinated Universal Time)',
  ].join(' ');
}

async function generateSecMsGec(date) {
  let seconds = date.getTime() / 1000 + 11_644_473_600;
  seconds -= seconds % 300;
  const ticks = Math.floor(seconds * 10_000_000);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('').toUpperCase();
}

export async function buildEdgeSpeechRequest({
  text,
  voiceId,
  now = new Date(),
  connectionId = randomId(),
  requestId = randomId(),
} = {}) {
  const voiceName = Object.hasOwn(EDGE_VIETNAMESE_VOICES, voiceId)
    ? EDGE_VIETNAMESE_VOICES[voiceId]
    : '';
  if (!voiceName) throw ttsError('TTS_VOICE_NOT_ALLOWED');
  const normalizedText = cleanText(text).trim();
  if (!normalizedText) throw ttsError('TTS_TEXT_REQUIRED');

  const secMsGec = await generateSecMsGec(now);
  const query = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    ConnectionId: connectionId,
    'Sec-MS-GEC': secMsGec,
    'Sec-MS-GEC-Version': EDGE_VERSION_HEADER,
  });
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${query}`;
  const timestamp = timestampString(now);
  const configMessage = [
    `X-Timestamp:${timestamp}`,
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
  ].join('\r\n');
  const ssml = [
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>",
    `<voice name='${voiceName}'>`,
    "<prosody pitch='+0Hz' rate='+0%' volume='+0%'>",
    escapeXml(normalizedText),
    '</prosody></voice></speak>',
  ].join('');
  const ssmlMessage = [
    `X-RequestId:${requestId}`,
    'Content-Type:application/ssml+xml',
    `X-Timestamp:${timestamp}Z`,
    'Path:ssml',
    '',
    ssml,
  ].join('\r\n');

  return {
    url,
    configMessage,
    ssmlMessage,
    headers: {
      Origin: EDGE_EXTENSION_ORIGIN,
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE_VERSION.split('.')[0]}.0.0.0`,
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Cookie: `muid=${randomId().toUpperCase()};`,
    },
  };
}

function bytesFromFrame(frame) {
  if (frame instanceof Uint8Array) return frame;
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) {
    return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  throw ttsError('TTS_PROVIDER_INVALID_FRAME');
}

export function parseEdgeAudioFrame(frame) {
  const bytes = bytesFromFrame(frame);
  if (bytes.byteLength < 2) throw ttsError('TTS_PROVIDER_INVALID_FRAME');
  const headerLength = (bytes[0] << 8) | bytes[1];
  const dataStart = headerLength + 2;
  if (headerLength <= 0 || dataStart > bytes.byteLength) {
    throw ttsError('TTS_PROVIDER_INVALID_FRAME');
  }
  const header = new TextDecoder().decode(bytes.subarray(2, dataStart));
  if (!/(?:^|\r\n)Path:audio(?:\r\n|$)/u.test(header)) {
    throw ttsError('TTS_PROVIDER_INVALID_FRAME');
  }
  const contentType = header.match(/(?:^|\r\n)Content-Type:([^\r\n]+)/u)?.[1]?.trim();
  if (contentType && contentType !== 'audio/mpeg') {
    throw ttsError('TTS_PROVIDER_INVALID_FRAME');
  }
  return bytes.slice(dataStart);
}

async function connectCloudflareWebSocket(url, headers, fetchImpl, signal) {
  const response = await fetchImpl(url.replace(/^wss:/u, 'https:'), {
    headers: { ...headers, Upgrade: 'websocket' },
    signal,
  });
  if (!response.webSocket) throw ttsError('TTS_PROVIDER_CONNECTION_FAILED');
  response.webSocket.binaryType = 'arraybuffer';
  response.webSocket.accept();
  return response.webSocket;
}

async function connectNodeWebSocket(url, headers, signal, timeoutMs) {
  const moduleName = 'ws';
  const { default: WebSocket } = await import(/* @vite-ignore */ moduleName);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers,
      handshakeTimeout: Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
    });
    socket.binaryType = 'arraybuffer';
    const handleOpen = () => {
      socket.removeEventListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
      resolve(socket);
    };
    const handleError = () => {
      socket.removeEventListener('open', handleOpen);
      signal?.removeEventListener('abort', handleAbort);
      reject(ttsError('TTS_PROVIDER_CONNECTION_FAILED'));
    };
    const handleAbort = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
      socket.terminate?.();
      reject(new DOMException('TTS request cancelled.', 'AbortError'));
    };
    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('error', handleError, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function defaultConnect({ url, headers, runtime, fetchImpl, signal, timeoutMs }) {
  if (runtime?.platform === 'cloudflare') {
    return connectCloudflareWebSocket(url, headers, fetchImpl, signal);
  }
  return connectNodeWebSocket(url, headers, signal, timeoutMs);
}

async function connectWithAbort(connect, options, signal, timeoutMs) {
  if (signal?.aborted) throw new DOMException('TTS request cancelled.', 'AbortError');
  let acceptLateSocket = true;
  let timeout = null;
  let handleAbort = null;
  const connection = Promise.resolve().then(() => connect(options));
  const interruption = new Promise((_, reject) => {
    handleAbort = () => reject(new DOMException('TTS request cancelled.', 'AbortError'));
    signal?.addEventListener('abort', handleAbort, { once: true });
    timeout = setTimeout(() => {
      reject(ttsError('TTS_PROVIDER_TIMEOUT'));
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  });

  try {
    const socket = await Promise.race([connection, interruption]);
    return socket;
  } catch (error) {
    acceptLateSocket = false;
    connection.then((socket) => {
      if (!acceptLateSocket) {
        try { socket?.close?.(1000, 'cancelled'); } catch { /* Socket already closed. */ }
      }
    }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', handleAbort);
  }
}

function concatChunks(chunks, totalBytes) {
  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return audio;
}

export async function synthesizeEdgeSpeech({
  text,
  voiceId,
  signal,
  runtime = {},
  fetchImpl = fetch,
  connect = defaultConnect,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (signal?.aborted) throw new DOMException('TTS request cancelled.', 'AbortError');
  const request = await buildEdgeSpeechRequest({ text, voiceId });
  const socket = await connectWithAbort(connect, {
    url: request.url,
    headers: request.headers,
    runtime,
    fetchImpl,
    signal,
    timeoutMs,
  }, signal, timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let totalBytes = 0;
    const chunks = [];
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      socket.removeEventListener?.('message', handleMessage);
      socket.removeEventListener?.('error', handleError);
      socket.removeEventListener?.('close', handleClose);
      try { socket.close?.(1000, 'done'); } catch { /* Socket is already closed. */ }
      callback(value);
    };
    const handleAbort = () => finish(reject, new DOMException('TTS request cancelled.', 'AbortError'));
    const handleError = () => finish(reject, ttsError('TTS_PROVIDER_CONNECTION_FAILED'));
    const handleClose = () => {
      if (!settled) finish(reject, ttsError('TTS_PROVIDER_NO_AUDIO'));
    };
    const handleMessage = async (event) => {
      try {
        if (typeof event.data === 'string') {
          if (event.data.includes('Path:turn.end')) {
            if (totalBytes === 0) throw ttsError('TTS_PROVIDER_NO_AUDIO');
            finish(resolve, concatChunks(chunks, totalBytes));
          }
          return;
        }
        const rawFrame = event.data instanceof Blob
          ? new Uint8Array(await event.data.arrayBuffer())
          : event.data;
        const chunk = parseEdgeAudioFrame(rawFrame);
        if (chunk.byteLength === 0) return;
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_AUDIO_BYTES) throw ttsError('TTS_PROVIDER_AUDIO_TOO_LARGE');
        chunks.push(chunk);
      } catch (error) {
        finish(reject, error);
      }
    };
    const timeout = setTimeout(() => {
      finish(reject, ttsError('TTS_PROVIDER_TIMEOUT'));
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    signal?.addEventListener('abort', handleAbort, { once: true });
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleError, { once: true });
    socket.addEventListener('close', handleClose, { once: true });
    try {
      socket.send(request.configMessage);
      socket.send(request.ssmlMessage);
    } catch (error) {
      finish(reject, ttsError('TTS_PROVIDER_CONNECTION_FAILED', error?.message));
    }
  });
}
