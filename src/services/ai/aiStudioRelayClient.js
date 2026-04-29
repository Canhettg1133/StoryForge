const DEFAULT_RELAY_TIMEOUT_MS = 12 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15000;

function getBrowserOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function buildRelayUrl(relayUrl, roomCode, { websocket = false, status = false } = {}) {
  const trimmedRelayUrl = String(relayUrl || '').trim();
  const trimmedRoomCode = String(roomCode || '').trim();

  if (!trimmedRelayUrl) {
    throw new Error('AI_STUDIO_RELAY_URL_REQUIRED');
  }
  if (!trimmedRoomCode) {
    throw new Error('AI_STUDIO_RELAY_ROOM_REQUIRED');
  }

  const url = new URL(trimmedRelayUrl, getBrowserOrigin());
  const basePath = url.pathname.replace(/\/+$/u, '');
  const encodedRoom = encodeURIComponent(trimmedRoomCode);
  url.pathname = `${basePath}/rooms/${encodedRoom}${status ? '/status' : ''}`;

  if (websocket) {
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = 'role=client';
  }

  return url.toString();
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createRelayError(message, code = 'AI_STUDIO_RELAY_ERROR') {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeModelName(name) {
  return String(name || '').replace(/^models\//u, '').trim();
}

function extractSSEDataValue(rawLine) {
  const trimmed = String(rawLine || '').trim();
  if (!trimmed || !trimmed.startsWith('data:')) return null;
  return trimmed.slice(5).trimStart();
}

function extractGeminiPayloadText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => String(part?.text || ''))
    .join('');
}

function extractGeminiResponseText(payload) {
  const text = extractGeminiPayloadText(payload);
  if (text) return text;
  return (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => String(part?.text || ''))
    .join('');
}

function splitGeminiMessages(messages = []) {
  const systemParts = [];
  const contents = [];

  for (const message of messages) {
    const content = String(message?.content || '');
    if (!content) continue;

    if (message.role === 'system') {
      systemParts.push(content);
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    });
  }

  return {
    systemInstruction: systemParts.join('\n\n'),
    contents,
  };
}

export function buildAIStudioRawGenerateRequest({
  requestId,
  model,
  messages,
  stream = true,
} = {}) {
  const { systemInstruction, contents } = splitGeminiMessages(messages);
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const body = {
    contents,
    ...(systemInstruction && {
      systemInstruction: { parts: [{ text: systemInstruction }] },
    }),
    generationConfig: {
      maxOutputTokens: 65000,
    },
  };

  return {
    request_id: requestId,
    method: 'POST',
    path: `/v1beta/models/${normalizeModelName(model)}:${action}`,
    headers: { 'Content-Type': 'application/json' },
    query_params: stream ? { alt: 'sse' } : undefined,
    body,
  };
}

function isSocketOpen(socket, WebSocketImpl) {
  const openState = WebSocketImpl?.OPEN ?? 1;
  return socket?.readyState === openState;
}

export function toRelayWebSocketUrl(relayUrl, roomCode) {
  return buildRelayUrl(relayUrl, roomCode, { websocket: true });
}

export function toRelayStatusUrl(relayUrl, roomCode) {
  return buildRelayUrl(relayUrl, roomCode, { status: true });
}

export async function createAIStudioRelayRoom(relayUrl, { signal } = {}) {
  const trimmedRelayUrl = String(relayUrl || '').trim();
  if (!trimmedRelayUrl) {
    throw new Error('AI_STUDIO_RELAY_URL_REQUIRED');
  }

  const url = new URL(trimmedRelayUrl, getBrowserOrigin());
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/rooms`;

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw createRelayError(
      payload?.error || `Relay room create failed with status ${response.status}`,
      payload?.code || 'AI_STUDIO_RELAY_ROOM_CREATE_FAILED',
    );
  }

  return payload;
}

export async function getAIStudioRelayRoomStatus(relayUrl, roomCode, { signal } = {}) {
  const response = await fetch(toRelayStatusUrl(relayUrl, roomCode), { signal });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw createRelayError(
      payload?.error || `Relay room status failed with status ${response.status}`,
      payload?.code || 'AI_STUDIO_RELAY_STATUS_FAILED',
    );
  }

  return payload;
}

export function callAIStudioRelayTransport({
  relayUrl,
  roomCode,
  model,
  messages,
  stream = true,
  signal,
  onToken,
  onComplete,
  onError,
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  requestId = createRequestId(),
  timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
} = {}) {
  if (!WebSocketImpl) {
    return Promise.reject(createRelayError('WebSocket is not available in this environment.', 'AI_STUDIO_RELAY_WEBSOCKET_UNAVAILABLE'));
  }

  let socket = null;
  let settled = false;
  let fullText = '';
  let rawStreamBuffer = '';
  let rawResponseText = '';
  let rawResponseStatus = 200;
  let timeoutId = null;
  let heartbeatId = null;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (heartbeatId) clearInterval(heartbeatId);
      timeoutId = null;
      heartbeatId = null;
      signal?.removeEventListener?.('abort', handleAbort);
    };

    const finishResolve = (text) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (isSocketOpen(socket, WebSocketImpl)) socket.close();
      } catch { /* noop */ }
      resolve(text);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (isSocketOpen(socket, WebSocketImpl)) socket.close();
      } catch { /* noop */ }
      onError?.(error);
      reject(error);
    };

    function sendMessage(payload) {
      if (!isSocketOpen(socket, WebSocketImpl)) return false;
      socket.send(JSON.stringify(payload));
      return true;
    }

    function appendText(text) {
      if (!text) return;
      fullText += text;
      onToken?.(text, fullText);
    }

    function readRawStreamChunk(rawChunk) {
      const chunk = String(rawChunk || '');
      if (!chunk) return;

      rawResponseText += chunk;
      rawStreamBuffer += chunk;
      const lines = rawStreamBuffer.split('\n');
      rawStreamBuffer = lines.pop() || '';

      for (const line of lines) {
        const dataValue = extractSSEDataValue(line);
        if (!dataValue || dataValue === '[DONE]') continue;

        try {
          const payload = JSON.parse(dataValue);
          appendText(extractGeminiPayloadText(payload));
        } catch {
          // Keep buffering; malformed partial SSE lines can be completed by a later chunk.
        }
      }
    }

    function readBufferedRawResponse() {
      const lastDataValue = extractSSEDataValue(rawStreamBuffer);
      if (lastDataValue && lastDataValue !== '[DONE]') {
        try {
          appendText(extractGeminiPayloadText(JSON.parse(lastDataValue)));
        } catch {
          // Fall through to whole-response parsing below.
        }
      }

      if (fullText) return fullText;

      try {
        const payload = JSON.parse(rawResponseText);
        return extractGeminiResponseText(payload);
      } catch {
        return '';
      }
    }

    function handleAbort() {
      if (settled) return;
      sendMessage({ type: 'cancel', requestId });
      finishResolve('');
    }

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      socket = new WebSocketImpl(toRelayWebSocketUrl(relayUrl, roomCode));
    } catch (error) {
      finishReject(createRelayError(error?.message || 'Unable to open AI Studio Relay socket.', 'AI_STUDIO_RELAY_CONNECT_FAILED'));
      return;
    }

    timeoutId = setTimeout(() => {
      finishReject(createRelayError('AI Studio Relay request timed out.', 'AI_STUDIO_RELAY_TIMEOUT'));
    }, timeoutMs);

    signal?.addEventListener?.('abort', handleAbort, { once: true });

    socket.addEventListener('open', () => {
      sendMessage(buildAIStudioRawGenerateRequest({
        requestId,
        model,
        messages,
        stream,
      }));

      heartbeatId = setInterval(() => {
        sendMessage({ type: 'heartbeat', ts: Date.now() });
      }, HEARTBEAT_INTERVAL_MS);
    });

    socket.addEventListener('message', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === 'heartbeat') {
        sendMessage({ type: 'heartbeat', ts: Date.now() });
        return;
      }
      if (payload.type === 'ready') return;
      if (payload.requestId && payload.requestId !== requestId) return;
      if (payload.request_id && payload.request_id !== requestId) return;

      if (payload.event_type === 'response_headers') {
        rawResponseStatus = Number(payload.status || 200);
        return;
      }

      if (payload.event_type === 'chunk') {
        readRawStreamChunk(payload.data);
        return;
      }

      if (payload.event_type === 'stream_close') {
        const finalText = readBufferedRawResponse();
        if (!finalText) {
          const code = rawResponseStatus >= 400
            ? `AI_STUDIO_RELAY_HTTP_${rawResponseStatus}`
            : 'AI_STUDIO_RELAY_EMPTY_STREAM';
          finishReject(createRelayError(
            rawResponseStatus >= 400
              ? `AI Studio Relay raw Gemini request failed with HTTP ${rawResponseStatus}.`
              : 'AI Studio Relay returned an empty Gemini stream.',
            code,
          ));
          return;
        }
        onComplete?.(finalText);
        finishResolve(finalText);
        return;
      }

      if (payload.event_type === 'error') {
        finishReject(createRelayError(payload.message || 'AI Studio Relay raw proxy returned an error.', payload.code || `AI_STUDIO_RELAY_HTTP_${payload.status || 500}`));
        return;
      }

      if (payload.type === 'chunk') {
        const text = String(payload.text || '');
        if (!text) return;
        appendText(text);
        return;
      }

      if (payload.type === 'done') {
        const finalText = typeof payload.text === 'string' ? payload.text : fullText;
        onComplete?.(finalText);
        finishResolve(finalText);
        return;
      }

      if (payload.type === 'error') {
        finishReject(createRelayError(payload.message || 'AI Studio Relay connector returned an error.', payload.code || 'AI_STUDIO_RELAY_CONNECTOR_ERROR'));
      }
    });

    socket.addEventListener('error', () => {
      finishReject(createRelayError('AI Studio Relay socket error.', 'AI_STUDIO_RELAY_SOCKET_ERROR'));
    });

    socket.addEventListener('close', () => {
      if (settled) return;
      finishReject(createRelayError('AI Studio Relay disconnected before the request completed.', 'AI_STUDIO_RELAY_DISCONNECTED'));
    });
  });
}
