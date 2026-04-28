export const ROOM_TTL_MS = 30 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
export const POLLING_TIMEOUT_MS = 5 * 60 * 1000;

const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const VALID_ROLES = new Set(['client', 'connector']);

function hashString(value) {
  let hash = 5381;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

function safeSend(socket, payload) {
  try {
    socket?.send?.(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function createRoomCode(randomFn = Math.random) {
  let raw = '';
  for (let index = 0; index < 6; index += 1) {
    const randomValue = Math.max(0, Math.min(0.999999999, Number(randomFn()) || 0));
    raw += ROOM_ALPHABET[Math.floor(randomValue * ROOM_ALPHABET.length)];
  }
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  return VALID_ROLES.has(value) ? value : '';
}

export function sanitizeRelayLogEvent(event = {}) {
  return {
    roomCodeHash: hashString(event.roomCode),
    role: event.role,
    eventType: event.eventType,
    byteLength: event.byteLength,
    status: event.status,
    errorCode: event.errorCode,
  };
}

export class RelayRoomCore {
  constructor({
    roomCode,
    now = () => Date.now(),
    logger = () => {},
    ttlMs = ROOM_TTL_MS,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    maxMessageBytes = MAX_MESSAGE_BYTES,
    pollingTimeoutMs = POLLING_TIMEOUT_MS,
  } = {}) {
    this.roomCode = roomCode || createRoomCode();
    this.now = now;
    this.logger = logger;
    this.ttlMs = ttlMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxMessageBytes = maxMessageBytes;
    this.pollingTimeoutMs = pollingTimeoutMs;
    this.createdAt = this.now();
    this.lastActivityAt = this.createdAt;
    this.sockets = new Map();
    this.pollingRoles = new Map();
    this.queues = new Map([
      ['client', []],
      ['connector', []],
    ]);
  }

  log(event) {
    this.logger(sanitizeRelayLogEvent({ roomCode: this.roomCode, ...event }));
  }

  canConnect(role) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) {
      return { ok: false, status: 400, error: 'INVALID_ROLE' };
    }
    if (this.sockets.has(normalizedRole)) {
      return { ok: false, status: 409, error: 'ROLE_ALREADY_CONNECTED' };
    }
    return { ok: true, role: normalizedRole };
  }

  connect(role, socket) {
    const check = this.canConnect(role);
    if (!check.ok) return check;

    const normalizedRole = check.role;
    this.sockets.set(normalizedRole, socket);
    this.lastActivityAt = this.now();
    this.log({ role: normalizedRole, eventType: 'connected', status: 'ok' });

    socket.addEventListener?.('message', (event) => {
      this.handleMessage(normalizedRole, event.data);
    });
    socket.addEventListener?.('close', () => {
      this.disconnect(normalizedRole);
    });
    socket.addEventListener?.('error', () => {
      this.disconnect(normalizedRole, 'SOCKET_ERROR');
    });

    safeSend(socket, { type: 'ready', role: normalizedRole });
    const client = this.sockets.get('client');
    if (normalizedRole === 'connector' && client) {
      safeSend(client, { type: 'ready' });
    }
    if (normalizedRole === 'client' && this.isPollingConnected('connector')) {
      safeSend(socket, { type: 'ready' });
    }
    return { ok: true };
  }

  disconnect(role, errorCode = undefined) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole || !this.sockets.has(normalizedRole)) return;
    this.sockets.delete(normalizedRole);
    this.lastActivityAt = this.now();
    this.log({ role: normalizedRole, eventType: 'disconnected', status: 'ok', errorCode });
  }

  isPollingConnected(role) {
    const normalizedRole = normalizeRole(role);
    const lastSeenAt = this.pollingRoles.get(normalizedRole);
    return Boolean(lastSeenAt && this.now() - lastSeenAt <= this.pollingTimeoutMs);
  }

  markPollingConnected(role) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) {
      return { ok: false, status: 400, error: 'INVALID_ROLE' };
    }

    const wasConnected = this.isPollingConnected(normalizedRole);
    this.pollingRoles.set(normalizedRole, this.now());
    this.lastActivityAt = this.now();

    if (!wasConnected) {
      this.log({ role: normalizedRole, eventType: 'polling_connected', status: 'ok' });
      const client = this.sockets.get('client');
      if (normalizedRole === 'connector' && client) {
        safeSend(client, { type: 'ready' });
      }
    }

    return { ok: true, role: normalizedRole };
  }

  enqueue(role, payload) {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) return false;
    const queue = this.queues.get(normalizedRole) || [];
    queue.push(payload);
    this.queues.set(normalizedRole, queue);
    return true;
  }

  poll(role) {
    const check = this.markPollingConnected(role);
    if (!check.ok) return check;

    const queue = this.queues.get(check.role) || [];
    this.queues.set(check.role, []);
    return {
      ok: true,
      role: check.role,
      messages: queue,
      ts: this.now(),
    };
  }

  getPeerRole(role) {
    return normalizeRole(role) === 'client' ? 'connector' : 'client';
  }

  handleMessage(role, rawData) {
    const normalizedRole = normalizeRole(role);
    const payloadBytes = byteLength(rawData);
    this.lastActivityAt = this.now();

    if (payloadBytes > this.maxMessageBytes) {
      this.log({
        role: normalizedRole,
        eventType: 'message_rejected',
        byteLength: payloadBytes,
        status: 'too_large',
        errorCode: 'MESSAGE_TOO_LARGE',
      });
      safeSend(this.sockets.get(normalizedRole), {
        type: 'error',
        code: 'MESSAGE_TOO_LARGE',
        message: 'Relay message is too large.',
      });
      return;
    }

    let payload = null;
    try {
      payload = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      this.log({
        role: normalizedRole,
        eventType: 'message_rejected',
        byteLength: payloadBytes,
        status: 'invalid_json',
        errorCode: 'INVALID_JSON',
      });
      return;
    }

    const eventType = String(payload?.type || 'unknown');
    this.log({ role: normalizedRole, eventType, byteLength: payloadBytes, status: 'forward' });

    if (eventType === 'heartbeat') {
      safeSend(this.sockets.get(normalizedRole), { type: 'heartbeat', ts: this.now() });
      return;
    }

    return this.forwardPayload(normalizedRole, payload, rawData, payloadBytes);
  }

  forwardPayload(normalizedRole, payload, rawData, payloadBytes) {
    const peerRole = this.getPeerRole(normalizedRole);
    const peer = this.sockets.get(peerRole);
    if (peer) {
      safeSend(peer, rawData);
      return { ok: true, forwarded: 'websocket' };
    }

    if (this.isPollingConnected(peerRole)) {
      this.enqueue(peerRole, payload);
      return { ok: true, forwarded: 'polling' };
    }

    const errorPayload = {
      type: 'error',
      requestId: payload?.requestId,
      code: 'PEER_NOT_CONNECTED',
      message: peerRole === 'connector'
        ? 'AI Studio Connector is not connected.'
        : 'StoryForge client is not connected.',
    };

    const sender = this.sockets.get(normalizedRole);
    if (sender) {
      safeSend(sender, errorPayload);
    }

    return {
      ok: false,
      status: 409,
      error: 'PEER_NOT_CONNECTED',
      payload: errorPayload,
      byteLength: payloadBytes,
    };
  }

  sendFromHttp(role, rawData) {
    const normalizedRole = normalizeRole(role);
    const payloadBytes = byteLength(rawData);
    this.lastActivityAt = this.now();

    if (!normalizedRole) {
      return { ok: false, status: 400, error: 'INVALID_ROLE' };
    }

    if (payloadBytes > this.maxMessageBytes) {
      this.log({
        role: normalizedRole,
        eventType: 'message_rejected',
        byteLength: payloadBytes,
        status: 'too_large',
        errorCode: 'MESSAGE_TOO_LARGE',
      });
      return {
        ok: false,
        status: 413,
        error: 'MESSAGE_TOO_LARGE',
        payload: {
          type: 'error',
          code: 'MESSAGE_TOO_LARGE',
          message: 'Relay message is too large.',
        },
      };
    }

    let payload = null;
    try {
      payload = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      this.log({
        role: normalizedRole,
        eventType: 'message_rejected',
        byteLength: payloadBytes,
        status: 'invalid_json',
        errorCode: 'INVALID_JSON',
      });
      return { ok: false, status: 400, error: 'INVALID_JSON' };
    }

    const eventType = String(payload?.type || 'unknown');
    this.log({ role: normalizedRole, eventType, byteLength: payloadBytes, status: 'forward' });
    this.markPollingConnected(normalizedRole);

    if (eventType === 'heartbeat') {
      return {
        ok: true,
        payload: { type: 'heartbeat', ts: this.now() },
      };
    }

    return this.forwardPayload(normalizedRole, payload, rawData, payloadBytes);
  }

  getConnectedState(role) {
    return this.sockets.has(role) || this.isPollingConnected(role);
  }

  isExpired() {
    const now = this.now();
    return now - this.createdAt > this.ttlMs || now - this.lastActivityAt > this.idleTimeoutMs;
  }

  getStatus() {
    return {
      code: this.roomCode,
      createdAt: this.createdAt,
      expiresAt: this.createdAt + this.ttlMs,
      clientConnected: this.getConnectedState('client'),
      connectorConnected: this.getConnectedState('connector'),
      expired: this.isExpired(),
    };
  }
}
