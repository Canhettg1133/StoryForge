import { RelayRoomCore, createRoomCode } from './room-core.js';

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function matchesAllowedOrigin(origin, allowedOrigin) {
  if (!allowedOrigin || allowedOrigin === '*') return true;
  if (origin === allowedOrigin) return true;
  const wildcardMarker = '://*.';
  const wildcardIndex = allowedOrigin.indexOf(wildcardMarker);
  if (wildcardIndex > -1) {
    const protocolPrefix = allowedOrigin.slice(0, wildcardIndex + 3);
    const suffix = `.${allowedOrigin.slice(wildcardIndex + wildcardMarker.length)}`;
    return origin.startsWith(protocolPrefix)
      && origin.endsWith(suffix)
      && origin.length > protocolPrefix.length + suffix.length;
  }
  return false;
}

export function isTrustedAIStudioOrigin(origin) {
  let parsed = null;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();
  return hostname === 'ai.studio'
    || hostname === 'aistudio.google.com'
    || hostname.endsWith('.googleusercontent.com')
    || hostname.endsWith('.usercontent.goog')
    || (
      hostname.endsWith('.run.app')
      && (
        hostname.startsWith('ais-dev-')
        || hostname.startsWith('ais-prod-')
        || hostname.startsWith('aistudio-')
      )
    );
}

function isOriginAllowed(request, env) {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.length === 0) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  if (origin === 'null' && request.headers.get('Upgrade') === 'websocket') return true;
  if (isTrustedAIStudioOrigin(origin)) return true;
  return allowedOrigins.some((allowedOrigin) => matchesAllowedOrigin(origin, allowedOrigin));
}

function corsHeaders(request, env) {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.length === 0) {
    return {
      ...BASE_CORS_HEADERS,
      'Access-Control-Allow-Origin': '*',
    };
  }

  const origin = request.headers.get('Origin');
  const responseOrigin = origin && (
    isTrustedAIStudioOrigin(origin)
    || allowedOrigins.some((allowedOrigin) => matchesAllowedOrigin(origin, allowedOrigin))
  )
    ? origin
    : allowedOrigins[0];
  return {
    ...BASE_CORS_HEADERS,
    'Access-Control-Allow-Origin': responseOrigin,
    Vary: 'Origin',
  };
}

function json(payload, status = 200, cors = BASE_CORS_HEADERS) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function parseRoomPath(pathname) {
  const match = pathname.match(/^\/rooms\/([^/]+)(?:\/(status|poll|send))?$/u);
  if (!match) return null;
  return {
    code: decodeURIComponent(match[1]),
    action: match[2] || 'connect',
  };
}

function getRoomStub(env, code) {
  const id = env.AI_STUDIO_RELAY_ROOMS.idFromName(code);
  return env.AI_STUDIO_RELAY_ROOMS.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestCorsHeaders = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: requestCorsHeaders });
    }

    if (!isOriginAllowed(request, env)) {
      return json({ error: 'Origin not allowed', code: 'ORIGIN_NOT_ALLOWED' }, 403, requestCorsHeaders);
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'ai-studio-relay' }, 200, requestCorsHeaders);
    }

    if (url.pathname === '/rooms' && request.method === 'POST') {
      const code = createRoomCode();
      const stub = getRoomStub(env, code);
      await stub.fetch(new Request(`https://relay.local/init?code=${encodeURIComponent(code)}`, { method: 'POST' }));
      return json({
        ok: true,
        code,
        expiresInMs: 30 * 60 * 1000,
      }, 200, requestCorsHeaders);
    }

    const roomPath = parseRoomPath(url.pathname);
    if (!roomPath) {
      return json({ error: 'Not found', code: 'NOT_FOUND' }, 404, requestCorsHeaders);
    }

    const stub = getRoomStub(env, roomPath.code);
    return stub.fetch(request);
  },
};

export class AIStudioRelayRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = null;
  }

  async getCore(roomCode) {
    if (!this.core) {
      const stored = await this.state.storage.get('roomMeta');
      this.core = new RelayRoomCore({
        roomCode: stored?.code || roomCode,
        logger: (event) => console.log(JSON.stringify(event)),
      });
      if (stored?.createdAt) {
        this.core.createdAt = stored.createdAt;
        this.core.lastActivityAt = stored.lastActivityAt || stored.createdAt;
      }
    }
    return this.core;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const requestCorsHeaders = corsHeaders(request, this.env || {});

    if (request.method === 'POST' && url.pathname === '/init') {
      const roomCode = url.searchParams.get('code') || this.state.id.toString();
      const core = await this.getCore(roomCode);
      await this.state.storage.put('roomMeta', {
        code: core.roomCode,
        createdAt: core.createdAt,
        lastActivityAt: core.lastActivityAt,
      });
      return json({ ok: true }, 200, requestCorsHeaders);
    }

    const roomPath = parseRoomPath(url.pathname);
    if (!roomPath) {
      return json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' }, 404, requestCorsHeaders);
    }

    const core = await this.getCore(roomPath.code);
    if (core.isExpired()) {
      return json({ error: 'Room expired', code: 'ROOM_EXPIRED' }, 410, requestCorsHeaders);
    }

    if (roomPath.action === 'status') {
      return json(core.getStatus(), 200, requestCorsHeaders);
    }

    if (roomPath.action === 'poll') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
      }

      const result = core.poll(url.searchParams.get('role'));
      return json(result.ok ? result : {
        error: result.error,
        code: result.error,
      }, result.ok ? 200 : result.status, requestCorsHeaders);
    }

    if (roomPath.action === 'send') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
      }

      const result = core.sendFromHttp(url.searchParams.get('role'), await request.text());
      return json(result.ok ? result : {
        error: result.error,
        code: result.error,
        payload: result.payload,
      }, result.ok ? 200 : result.status, requestCorsHeaders);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'Expected WebSocket upgrade', code: 'WEBSOCKET_REQUIRED' }, 426, requestCorsHeaders);
    }

    const role = url.searchParams.get('role');
    const canConnect = core.canConnect(role);
    if (!canConnect.ok) {
      return json({ error: canConnect.error, code: canConnect.error }, canConnect.status, requestCorsHeaders);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    core.connect(role, server);
    await this.state.storage.put('roomMeta', {
      code: core.roomCode,
      createdAt: core.createdAt,
      lastActivityAt: core.lastActivityAt,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
