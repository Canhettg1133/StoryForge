import { RelayRoomCore, createRoomCode } from './room-core.js';
import {
  ACCESS_FEATURES,
  resolveFeatureDecision,
} from '../../src/services/access/accessControl.js';

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-StoryForge-Room-Secret',
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
    return json({ error: 'Phương thức yêu cầu không được hỗ trợ', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
  }

  const clientSecret = getOAuthClientSecret(env);
  if (!clientSecret) {
    return json({ error: 'OAuth relay chưa cấu hình secret', code: 'OAUTH_SECRET_MISSING' }, 500, requestCorsHeaders);
  }

  const payload = await readJson(request);
  const code = String(payload.code || '').trim();
  if (!code) {
    return json({ error: 'Thiếu mã OAuth', code: 'OAUTH_CODE_REQUIRED' }, 400, requestCorsHeaders);
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
      error: tokenPayload.error
        ? `Google OAuth từ chối yêu cầu đổi mã (${tokenPayload.error}).`
        : 'Đổi mã OAuth thất bại',
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
    return json({ error: 'Phương thức yêu cầu không được hỗ trợ', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
  }

  const clientSecret = getOAuthClientSecret(env);
  if (!clientSecret) {
    return json({ error: 'OAuth relay chưa cấu hình secret', code: 'OAUTH_SECRET_MISSING' }, 500, requestCorsHeaders);
  }

  const payload = await readJson(request);
  const refreshToken = String(payload.refresh_token || '').trim();
  if (!refreshToken) {
    return json({ error: 'Thiếu refresh token', code: 'OAUTH_REFRESH_TOKEN_REQUIRED' }, 400, requestCorsHeaders);
  }

  const { response, payload: tokenPayload } = await proxyGoogleOAuthToken(new URLSearchParams({
    client_id: getOAuthClientId(env),
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }));

  if (!response.ok || tokenPayload.error) {
    return json({
      error: tokenPayload.error
        ? `Google OAuth từ chối yêu cầu làm mới token (${tokenPayload.error}).`
        : 'Làm mới OAuth thất bại',
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

function getBearerToken(request) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

function getSupabaseWorkerConfig(env = {}) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/u, '');
  const serviceRoleKey = String(
    env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_SECRET_KEY
      || env.SUPABASE_SERVICE_KEY
      || '',
  ).trim();
  return { url, serviceRoleKey, configured: Boolean(url && serviceRoleKey) };
}

async function supabaseRest(env, path) {
  const config = getSupabaseWorkerConfig(env);
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`SUPABASE_REST_${response.status}`);
  return response.json();
}

async function verifySupabaseUserFromWorker(request, env) {
  const config = getSupabaseWorkerConfig(env);
  if (!config.configured) {
    return { ok: false, status: 500, reason: 'SUPABASE_ADMIN_NOT_CONFIGURED' };
  }

  const token = getBearerToken(request);
  if (!token) return { ok: false, status: 401, reason: 'AUTH_REQUIRED' };

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return { ok: false, status: 401, reason: 'AUTH_REQUIRED' };

  const user = await response.json();
  if (!user?.id) return { ok: false, status: 401, reason: 'AUTH_REQUIRED' };
  return { ok: true, user };
}

async function requireWorkerFeature(request, env, featureKey) {
  const auth = await verifySupabaseUserFromWorker(request, env);
  if (!auth.ok) return auth;

  const userId = encodeURIComponent(auth.user.id);
  const [
    profiles,
    features,
    userPlans,
    planFeatures,
    overrides,
    consentVersions,
  ] = await Promise.all([
    supabaseRest(env, `profiles?select=*&user_id=eq.${userId}&limit=1`),
    supabaseRest(env, 'features?select=*'),
    supabaseRest(env, `user_plans?select=*,plans(key,name)&user_id=eq.${userId}`),
    supabaseRest(env, 'plan_features?select=*'),
    supabaseRest(env, `user_entitlement_overrides?select=*&user_id=eq.${userId}`),
    supabaseRest(env, 'consent_versions?select=*&active=eq.true'),
  ]);

  const profile = profiles?.[0] || null;
  const decision = resolveFeatureDecision({
    authenticated: true,
    userId: auth.user.id,
    profile,
    features,
    userPlans: (userPlans || []).map((row) => ({
      ...row,
      plan_key: row?.plans?.key || '',
      plan_name: row?.plans?.name || '',
    })),
    planFeatures,
    overrides,
    consentVersions,
  }, featureKey);

  return decision.allowed
    ? { ok: true, user: auth.user, decision }
    : { ok: false, status: decision.status, reason: decision.reason, decision };
}

function createRoomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashRoomSecret(secret) {
  const input = new TextEncoder().encode(String(secret || ''));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getRequestRoomSecret(request) {
  const url = new URL(request.url);
  return String(
    request.headers.get('X-StoryForge-Room-Secret')
      || url.searchParams.get('secret')
      || '',
  ).trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestCorsHeaders = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: requestCorsHeaders });
    }

    if (!isOriginAllowed(request, env)) {
      return json({ error: 'Origin không được phép truy cập', code: 'ORIGIN_NOT_ALLOWED' }, 403, requestCorsHeaders);
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
      const access = await requireWorkerFeature(request, env, ACCESS_FEATURES.AI_STUDIO_RELAY);
      if (!access.ok) {
        return json({
          error: access.reason || 'FEATURE_NOT_ALLOWED',
          code: access.reason || 'FEATURE_NOT_ALLOWED',
          decision: access.decision || null,
        }, access.status || 403, requestCorsHeaders);
      }

      const code = createRoomCode();
      const roomSecret = createRoomSecret();
      const secretHash = await hashRoomSecret(roomSecret);
      const stub = getRoomStub(env, code);
      await stub.fetch(new Request(`https://relay.local/init?code=${encodeURIComponent(code)}&secretHash=${encodeURIComponent(secretHash)}`, { method: 'POST' }));
      return json({
        ok: true,
        code,
        roomSecret,
        expiresInMs: 30 * 60 * 1000,
      }, 200, requestCorsHeaders);
    }

    const roomPath = parseRoomPath(url.pathname);
    if (!roomPath) {
      return json({ error: 'Không tìm thấy dữ liệu', code: 'NOT_FOUND' }, 404, requestCorsHeaders);
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
      const secretHash = url.searchParams.get('secretHash') || '';
      const core = await this.getCore(roomCode);
      await this.state.storage.put('roomMeta', {
        code: core.roomCode,
        secretHash,
        createdAt: core.createdAt,
        lastActivityAt: core.lastActivityAt,
      });
      return json({ ok: true }, 200, requestCorsHeaders);
    }

    const roomPath = parseRoomPath(url.pathname);
    if (!roomPath) {
      return json({ error: 'Không tìm thấy room', code: 'ROOM_NOT_FOUND' }, 404, requestCorsHeaders);
    }

    const core = await this.getCore(roomPath.code);
    const stored = await this.state.storage.get('roomMeta');
    if (stored?.secretHash) {
      const providedSecret = getRequestRoomSecret(request);
      const providedHash = providedSecret ? await hashRoomSecret(providedSecret) : '';
      if (providedHash !== stored.secretHash) {
        return json({ error: 'Room secret không hợp lệ', code: 'ROOM_SECRET_REQUIRED' }, 403, requestCorsHeaders);
      }
    }

    if (core.isExpired()) {
      return json({ error: 'Room đã hết hạn', code: 'ROOM_EXPIRED' }, 410, requestCorsHeaders);
    }

    if (roomPath.action === 'status') {
      return json(core.getStatus(), 200, requestCorsHeaders);
    }

    if (roomPath.action === 'poll') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ error: 'Phương thức yêu cầu không được hỗ trợ', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
      }

      const result = core.poll(url.searchParams.get('role'));
      return json(result.ok ? result : {
        error: result.error,
        code: result.error,
      }, result.ok ? 200 : result.status, requestCorsHeaders);
    }

    if (roomPath.action === 'send') {
      if (request.method !== 'POST') {
        return json({ error: 'Phương thức yêu cầu không được hỗ trợ', code: 'METHOD_NOT_ALLOWED' }, 405, requestCorsHeaders);
      }

      const result = core.sendFromHttp(url.searchParams.get('role'), await request.text());
      return json(result.ok ? result : {
        error: result.error,
        code: result.error,
        payload: result.payload,
      }, result.ok ? 200 : result.status, requestCorsHeaders);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'Yêu cầu cần nâng cấp lên WebSocket', code: 'WEBSOCKET_REQUIRED' }, 426, requestCorsHeaders);
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
      secretHash: stored?.secretHash || '',
      createdAt: core.createdAt,
      lastActivityAt: core.lastActivityAt,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
