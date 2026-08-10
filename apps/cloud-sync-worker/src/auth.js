import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose';

const remoteJwksByIssuer = new Map();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function unauthorized() {
  const error = new Error('Authentication required.');
  error.code = 'UNAUTHORIZED';
  error.status = 401;
  return error;
}

function normalizeSupabaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//iu.test(normalized)) throw unauthorized();
  return normalized;
}

function readBearerToken(request) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!authorization.startsWith('Bearer ')) throw unauthorized();
  const token = authorization.slice(7).trim();
  if (!token || token.length > 16_384) throw unauthorized();
  return token;
}

function getRemoteJwks(supabaseUrl) {
  const issuer = `${supabaseUrl}/auth/v1`;
  let jwks = remoteJwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30_000,
      timeoutDuration: 10_000,
    });
    remoteJwksByIssuer.set(issuer, jwks);
  }
  return { issuer, jwks };
}

function validateUserClaims(payload) {
  const id = String(payload?.sub || '').trim();
  const role = String(payload?.role || '').trim();
  if (!UUID_PATTERN.test(id) || role !== 'authenticated') throw unauthorized();
  return { id, role };
}

async function verifyAsymmetricToken(token, supabaseUrl) {
  const { issuer, jwks } = getRemoteJwks(supabaseUrl);
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['ES256'],
    issuer,
    audience: 'authenticated',
    requiredClaims: ['sub', 'exp', 'role'],
  });
  return validateUserClaims(payload);
}

async function verifyLegacyToken(token, env, fetchImpl) {
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!publishableKey) throw unauthorized();
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw unauthorized();
    const user = await response.json();
    const id = String(user?.id || '').trim();
    const role = String(user?.role || user?.app_metadata?.role || user?.aud || '').trim();
    if (!UUID_PATTERN.test(id) || role !== 'authenticated') throw unauthorized();
    return { id, role };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function authenticateRequest(request, env, fetchImpl = fetch) {
  try {
    const token = readBearerToken(request);
    const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
    const header = decodeProtectedHeader(token);
    if (header.alg === 'ES256') {
      return await verifyAsymmetricToken(token, supabaseUrl);
    }
    if (header.alg === 'HS256') {
      return await verifyLegacyToken(token, env, fetchImpl);
    }
    throw unauthorized();
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') throw error;
    throw unauthorized();
  }
}

export function clearCloudSyncJwksCache() {
  remoteJwksByIssuer.clear();
}
