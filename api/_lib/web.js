const DEFAULT_JSON_BODY_MAX_BYTES = 4 * 1024 * 1024;

function getNodeEnv() {
  return typeof process !== 'undefined' && process?.env ? process.env : {};
}

export function normalizeRuntime(runtime = {}) {
  const ctx = runtime?.ctx || {};
  const defer = typeof runtime?.defer === 'function'
    ? runtime.defer
    : (promise) => {
      const task = Promise.resolve(promise).catch((error) => {
        console.warn('[storyforge-runtime] deferred task failed', {
          code: error?.code || 'DEFERRED_TASK_FAILED',
        });
      });
      if (typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
      return task;
    };

  return {
    env: runtime?.env || getNodeEnv(),
    ctx,
    defer,
    platform: runtime?.platform || 'web',
  };
}

export function isPreviewRuntime(runtime = {}) {
  const { env } = normalizeRuntime(runtime);
  return String(env.DEPLOYMENT_MODE || '').trim().toLowerCase() === 'preview';
}

export function getBoundedEnvInteger(env, name, fallback, {
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
} = {}) {
  const parsed = Number.parseInt(env?.[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createHttpError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

export async function readJsonRequest(request, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES } = {}) {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw createHttpError(413, 'JSON_BODY_TOO_LARGE', 'JSON body is too large.');
  }
  if (buffer.byteLength === 0) return {};
  return JSON.parse(new TextDecoder().decode(buffer));
}

export function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function getRequestId(request) {
  const incoming = request?.headers?.get?.('x-request-id')
    || request?.headers?.get?.('x-correlation-id');
  if (incoming) return String(incoming).trim().slice(0, 120);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function publicErrorResponse(request, status, {
  code = 'REQUEST_FAILED',
  error = 'Request failed.',
  requestId = '',
  retryAfterSeconds = 0,
  headers = {},
} = {}) {
  const safeRequestId = requestId || getRequestId(request);
  return jsonResponse({
    ok: false,
    code,
    error,
    requestId: safeRequestId,
  }, status, {
    'X-Request-Id': safeRequestId,
    ...(retryAfterSeconds > 0 ? { 'Retry-After': String(Math.ceil(retryAfterSeconds)) } : {}),
    ...headers,
  });
}

export function relayResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-StoryForge-Relay', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function toReadableStream(body) {
  if (!body) return null;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return body;
  if (typeof body.getReader !== 'function') return body;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel?.(reason);
    },
  });
}

function toWebHeaders(nodeHeaders = {}) {
  const headers = new Headers();
  Object.entries(nodeHeaders || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  });
  return headers;
}

async function readNodeRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string' || req.body instanceof Uint8Array || req.body instanceof ArrayBuffer) {
      return req.body;
    }
    return JSON.stringify(req.body);
  }
  if (!req?.[Symbol.asyncIterator]) return undefined;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  if (size === 0) return undefined;
  const body = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return body;
}

async function nodeRequestToWebRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const headers = toWebHeaders(req.headers);
  const protocol = headers.get('x-forwarded-proto') || 'http';
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost';
  const rawUrl = String(req.url || req.originalUrl || '/');
  const url = /^https?:\/\//iu.test(rawUrl) ? rawUrl : `${protocol}://${host}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
  const controller = new AbortController();
  req.on?.('aborted', () => controller.abort());
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readNodeRequestBody(req);
  if (body && !headers.has('content-type') && typeof req.body === 'object') {
    headers.set('content-type', 'application/json');
  }
  return {
    controller,
    request: new Request(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    }),
  };
}

async function pipeWebResponseToNode(response, res, controller) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const abortOnClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on?.('close', abortOnClose);

  if (!response.body) {
    res.end();
    return;
  }

  if (typeof res.write !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const chunk = globalThis.Buffer?.from ? globalThis.Buffer.from(bytes) : bytes;
    res.end(chunk);
    return;
  }

  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = globalThis.Buffer?.from ? globalThis.Buffer.from(value) : value;
      res.write(chunk);
    }
  } catch (error) {
    controller.abort();
    if (!res.headersSent) throw error;
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export function createVercelHandler(webHandler) {
  return async function vercelHandler(req, res) {
    const { request, controller } = await nodeRequestToWebRequest(req);
    const runtime = normalizeRuntime({
      env: getNodeEnv(),
      platform: 'vercel',
    });
    const response = await webHandler(request, runtime);
    await pipeWebResponseToNode(response, res, controller);
  };
}
