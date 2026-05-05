import {
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  isRelayAllowedTarget,
} from '../src/services/ai/openAIProxyCore.js';

const ALLOWED_ACTIONS = new Set(['models', 'chat']);

export const config = {
  maxDuration: 60,
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function copyResponseHeaders(upstream, res) {
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
}

async function pipeUpstreamResponse(upstream, res) {
  res.statusCode = upstream.status;
  copyResponseHeaders(upstream, res);

  if (!upstream.body) {
    res.end(await upstream.text().catch(() => ''));
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

function getForwardAuth(req) {
  return String(req.headers?.authorization || '').trim();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.', code: 'OPENAI_PROXY_BAD_JSON' });
    return;
  }

  const action = String(body?.action || '').trim();
  if (!ALLOWED_ACTIONS.has(action)) {
    sendJson(res, 400, { error: 'Unsupported proxy action.', code: 'OPENAI_PROXY_BAD_ACTION' });
    return;
  }

  const baseUrl = String(body?.baseUrl || body?.targetBaseUrl || '').trim();
  if (!isRelayAllowedTarget(baseUrl)) {
    sendJson(res, 400, {
      error: 'Proxy target must be a public HTTPS URL.',
      code: 'OPENAI_PROXY_TARGET_BLOCKED',
    });
    return;
  }

  const endpoint = action === 'models'
    ? buildOpenAIProxyEndpoint(baseUrl, body?.modelsPath || DEFAULT_PROXY_MODELS_PATH)
    : buildOpenAIProxyEndpoint(baseUrl, body?.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH);
  const authorization = getForwardAuth(req);

  const headers = {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };

  try {
    const upstream = await fetch(endpoint, action === 'models'
      ? {
        method: 'GET',
        redirect: 'manual',
        headers: authorization ? { Authorization: authorization } : {},
      }
      : {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: JSON.stringify(body?.payload || {}),
      });

    await pipeUpstreamResponse(upstream, res);
  } catch (error) {
    sendJson(res, 502, {
      error: error?.message || 'OpenAI proxy relay failed.',
      code: 'OPENAI_PROXY_UPSTREAM_FAILED',
    });
  }
}
