const DEFAULT_JSON_BODY_MAX_BYTES = 4 * 1024 * 1024;

function createHttpError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES } = {}) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      throw createHttpError(413, 'JSON_BODY_TOO_LARGE', 'JSON body is too large.');
    }
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw createHttpError(413, 'JSON_BODY_TOO_LARGE', 'JSON body is too large.');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function getHeader(req, name) {
  const target = String(name || '').toLowerCase();
  const headers = req?.headers || {};
  if (typeof headers.get === 'function') {
    return String(headers.get(name) || headers.get(target) || '');
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : String(value || '');
    }
  }
  return '';
}

export function getBearerToken(req) {
  const authorization = getHeader(req, 'authorization').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

export function getClientIp(req) {
  return getHeader(req, 'cf-connecting-ip').trim()
    || getHeader(req, 'x-forwarded-for').split(',')[0]?.trim()
    || getHeader(req, 'x-real-ip').trim()
    || '';
}

export function getUserAgent(req) {
  return getHeader(req, 'user-agent').trim();
}

export function getQueryValue(req, key) {
  const value = req.query?.[key];
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '');
}

export function getRequestId(req) {
  const incoming = getHeader(req, 'x-request-id') || getHeader(req, 'x-correlation-id');
  if (incoming) return incoming.trim().slice(0, 120);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sendPublicError(req, res, status, {
  code = 'REQUEST_FAILED',
  error = 'Request failed.',
  requestId = '',
  retryAfterSeconds = 0,
} = {}) {
  const safeRequestId = requestId || getRequestId(req);
  res.setHeader('X-Request-Id', safeRequestId);
  if (retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(Math.ceil(retryAfterSeconds)));
  }
  sendJson(res, status, {
    ok: false,
    code,
    error,
    requestId: safeRequestId,
  });
}
