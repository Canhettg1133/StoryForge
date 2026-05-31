export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function getHeader(req, name) {
  const target = String(name || '').toLowerCase();
  const headers = req.headers || {};
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
  return getHeader(req, 'x-forwarded-for').split(',')[0]?.trim()
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
