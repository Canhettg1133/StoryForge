import { RelayRoomCore, createRoomCode } from './room-core.js';

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_OAUTH_CLIENT_ID = '861823451650-heam38v432jq22s22ja09fhuo5o2hevm.apps.googleusercontent.com';
const DEFAULT_OAUTH_REDIRECT_URI = 'http://localhost:11451';

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
        || hostname.startsWith('ais-pre-')
        || hostname.startsWith('ais-prod-')
        || hostname.startsWith('aistudio-')
      )
    );
}

function isAllowedOpaqueOrigin(request) {
  // Some AI Studio previews/mobile browsers run connector code in a sandboxed
  // frame, so browser fetch uses the opaque CORS origin "null".
  return request.headers.get('Origin') === 'null';
}

function isOriginAllowed(request, env) {
  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins.length === 0) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  if (isAllowedOpaqueOrigin(request)) return true;
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
    isAllowedOpaqueOrigin(request)
    || isTrustedAIStudioOrigin(origin)
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

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function getOAuthClientSecret(env) {
  return String(env.OAUTH_CLIENT_SECRET || '').trim();
}

function getOAuthClientId(env) {
  return String(env.OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID).trim();
}

async function proxyGoogleOAuthToken(formBody) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function handleOAuthStatus(env, requestCorsHeaders) {
  return json({
    ok: true,
    oauthConfigured: Boolean(getOAuthClientSecret(env)),
    clientId: getOAuthClientId(env),
    redirectUri: DEFAULT_OAUTH_REDIRECT_URI,
  }, 200, requestCorsHeaders);
}

async function handleOAuthExchange(request, env, requestCorsHeaders) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
  }

  const clientSecret = getOAuthClientSecret(env);
  if (!clientSecret) {
    return json({ error: 'OAuth relay secret is not configured', code: 'OAUTH_SECRET_MISSING' }, 500, requestCorsHeaders);
  }

  const payload = await readJson(request);
  const code = String(payload.code || '').trim();
  if (!code) {
    return json({ error: 'Missing OAuth code', code: 'OAUTH_CODE_REQUIRED' }, 400, requestCorsHeaders);
  }

  const { response, payload: tokenPayload } = await proxyGoogleOAuthToken(new URLSearchParams({
    client_id: getOAuthClientId(env),
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: String(payload.redirect_uri || DEFAULT_OAUTH_REDIRECT_URI),
  }));

  if (!response.ok || tokenPayload.error) {
    return json({
      error: tokenPayload.error_description || tokenPayload.error || 'OAuth exchange failed',
      code: 'OAUTH_EXCHANGE_FAILED',
    }, response.status || 400, requestCorsHeaders);
  }

  return json({
    access_token: tokenPayload.access_token,
    refresh_token: tokenPayload.refresh_token,
    expires_in: tokenPayload.expires_in,
    token_type: tokenPayload.token_type,
    scope: tokenPayload.scope,
  }, 200, requestCorsHeaders);
}

async function handleOAuthRefresh(request, env, requestCorsHeaders) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
  }

  const clientSecret = getOAuthClientSecret(env);
  if (!clientSecret) {
    return json({ error: 'OAuth relay secret is not configured', code: 'OAUTH_SECRET_MISSING' }, 500, requestCorsHeaders);
  }

  const payload = await readJson(request);
  const refreshToken = String(payload.refresh_token || '').trim();
  if (!refreshToken) {
    return json({ error: 'Missing refresh token', code: 'OAUTH_REFRESH_TOKEN_REQUIRED' }, 400, requestCorsHeaders);
  }

  const { response, payload: tokenPayload } = await proxyGoogleOAuthToken(new URLSearchParams({
    client_id: getOAuthClientId(env),
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }));

  if (!response.ok || tokenPayload.error) {
    return json({
      error: tokenPayload.error_description || tokenPayload.error || 'OAuth refresh failed',
      code: 'OAUTH_REFRESH_FAILED',
    }, response.status || 400, requestCorsHeaders);
  }

  return json({
    access_token: tokenPayload.access_token,
    expires_in: tokenPayload.expires_in,
    token_type: tokenPayload.token_type,
    scope: tokenPayload.scope,
  }, 200, requestCorsHeaders);
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

    if (url.pathname === '/oauth/status') {
      return handleOAuthStatus(env, requestCorsHeaders);
    }

    if (url.pathname === '/oauth/exchange') {
      return handleOAuthExchange(request, env, requestCorsHeaders);
    }

    if (url.pathname === '/oauth/refresh') {
      return handleOAuthRefresh(request, env, requestCorsHeaders);
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
