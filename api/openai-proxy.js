import {
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  isRelayAllowedTarget,
} from '../src/services/ai/openAIProxyCore.js';

const ALLOWED_ACTIONS = new Set(['models', 'chat', 'chat_stream_batch']);
const MAX_CHAT_STREAM_BATCH_SIZE = 50;

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

async function readUpstreamResponseBody(upstream) {
  const contentType = upstream.headers.get('content-type') || '';
  const text = await upstream.text().catch(() => '');
  if (contentType.includes('application/json') && text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function fetchChatPayload(endpoint, headers, payload) {
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: JSON.stringify(payload || {}),
    });
    return {
      ok: upstream.ok,
      status: upstream.status,
      body: await readUpstreamResponseBody(upstream),
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: {
        error: error?.message || 'Relay OpenAI proxy thất bại.',
        code: 'OPENAI_PROXY_UPSTREAM_FAILED',
      },
    };
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Nội dung JSON gửi lên không hợp lệ.', code: 'OPENAI_PROXY_BAD_JSON' });
    return;
  }

  const action = String(body?.action || '').trim();
  if (!ALLOWED_ACTIONS.has(action)) {
    sendJson(res, 400, { error: 'Hành động proxy không được hỗ trợ.', code: 'OPENAI_PROXY_BAD_ACTION' });
    return;
  }

  const baseUrl = String(body?.baseUrl || body?.targetBaseUrl || '').trim();
  if (!isRelayAllowedTarget(baseUrl)) {
    sendJson(res, 400, {
      error: 'Proxy target phải là URL HTTPS public.',
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

  if (action === 'chat_stream_batch') {
    const payloads = Array.isArray(body?.payloads) ? body.payloads : [];
    if (payloads.length === 0 || payloads.length > MAX_CHAT_STREAM_BATCH_SIZE) {
      sendJson(res, 400, {
        error: `Chat stream batch phải có từ 1 đến ${MAX_CHAT_STREAM_BATCH_SIZE} payload.`,
        code: 'OPENAI_PROXY_BAD_BATCH',
      });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    await Promise.all(payloads.map(async (payload, index) => {
      const result = await fetchChatPayload(endpoint, headers, payload);
      res.write(`${JSON.stringify({ index, ...result })}\n`);
    }));
    res.end();
    return;
  }

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
      error: error?.message || 'Relay OpenAI proxy thất bại.',
      code: 'OPENAI_PROXY_UPSTREAM_FAILED',
    });
  }
}
