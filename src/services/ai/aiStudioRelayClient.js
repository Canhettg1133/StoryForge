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
      sendMessage({
        type: 'generate',
        requestId,
        model,
        messages,
        stream,
      });

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

      if (payload.type === 'chunk') {
        const text = String(payload.text || '');
        if (!text) return;
        fullText += text;
        onToken?.(text, fullText);
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
