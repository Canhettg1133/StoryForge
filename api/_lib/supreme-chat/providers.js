import {
  CUSTOM_PROXY_PROFILE_ID,
  buildOpenAIProxyEndpoint,
  isOpenAIProxyRequestPathAllowed,
  isRelayAllowedTarget,
} from '../../../src/services/ai/openAIProxyCore.js';

const AG_CHAT_URL = 'https://ag.beijixingxing.com/v1/chat/completions';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_SAME_ORIGIN_REDIRECTS = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function upstreamError({
  upstreamStatus = 0,
  failureKind = 'unknown',
  networkReason = '',
  targetKind = '',
} = {}) {
  const providerKeyRejected = upstreamStatus === 401 || upstreamStatus === 403;
  const code = providerKeyRejected
    ? 'SUPREME_PROVIDER_KEY_REJECTED'
    : 'SUPREME_UPSTREAM_FAILED';
  const error = new Error(code);
  error.status = providerKeyRejected ? 422 : 502;
  error.code = code;
  error.upstreamStatus = Number.isInteger(upstreamStatus) ? upstreamStatus : 0;
  error.failureKind = String(failureKind || 'unknown');
  error.networkReason = String(networkReason || '');
  error.targetKind = String(targetKind || '');
  return error;
}

function classifyNetworkReason(error, signal) {
  if (signal?.aborted) return 'request_aborted';
  const details = [
    error?.name,
    error?.code,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  if (details.includes('too many subrequest') || details.includes('subrequest limit')) {
    return 'subrequest_limit';
  }
  if (details.includes('1042') || details.includes('another worker') || details.includes('same zone')) {
    return 'worker_to_worker';
  }
  if (
    details.includes('1021')
    || details.includes('cannot access')
    || details.includes('not allowed')
    || details.includes('unsupported port')
  ) {
    return 'target_not_allowed';
  }
  if (details.includes('redirect')) return 'redirect_rejected';
  if (details.includes('dns') || details.includes('resolve') || details.includes('enotfound')) {
    return 'dns';
  }
  if (
    details.includes('tls')
    || details.includes('ssl')
    || details.includes('certificate')
    || details.includes('cert_')
  ) {
    return 'tls';
  }
  if (
    details.includes('network connection lost')
    || details.includes('connection reset')
    || details.includes('econnreset')
    || details.includes('econnrefused')
    || details.includes('timed out')
    || details.includes('timeout')
  ) {
    return 'connection';
  }
  return 'unknown';
}

function classifyTarget(endpoint) {
  try {
    const target = new URL(endpoint);
    if (target.port && target.port !== '443') return 'nonstandard_https_port';
    if (target.hostname.endsWith('.workers.dev')) return 'workers_dev';
    if (target.hostname.endsWith('.pages.dev')) return 'pages_dev';
  } catch {
    return 'invalid';
  }
  return 'public_https';
}

async function readJsonResponse(response) {
  if (!response.ok) {
    await response.body?.cancel?.('SUPREME_UPSTREAM_HTTP_ERROR').catch(() => {});
    throw upstreamError({
      upstreamStatus: response.status,
      failureKind: 'upstream_http',
    });
  }
  const contentLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    await response.body?.cancel?.('SUPREME_UPSTREAM_RESPONSE_TOO_LARGE').catch(() => {});
    throw upstreamError({ failureKind: 'response_too_large' });
  }
  if (!response.body?.getReader) throw upstreamError({ failureKind: 'response_unreadable' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
        await reader.cancel('SUPREME_UPSTREAM_RESPONSE_TOO_LARGE').catch(() => {});
        throw upstreamError({ failureKind: 'response_too_large' });
      }
      text += decoder.decode(bytes, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamError({ failureKind: 'response_invalid_json' });
  }
}

async function fetchUpstream(endpoint, init) {
  const initialTarget = new URL(endpoint);
  let currentTarget = initialTarget;
  for (let redirectCount = 0; redirectCount <= MAX_SAME_ORIGIN_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetch(currentTarget.toString(), {
        ...init,
        redirect: 'manual',
      });
    } catch (error) {
      throw upstreamError({
        failureKind: init.signal?.aborted ? 'request_aborted' : 'network',
        networkReason: classifyNetworkReason(error, init.signal),
        targetKind: classifyTarget(endpoint),
      });
    }
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    let nextTarget;
    try {
      nextTarget = new URL(location || '', currentTarget);
    } catch {
      nextTarget = null;
    }
    const safeRedirect = Boolean(nextTarget)
      && Boolean(location)
      && nextTarget.protocol === 'https:'
      && !nextTarget.username
      && !nextTarget.password
      && nextTarget.origin === initialTarget.origin;
    if (!safeRedirect || redirectCount === MAX_SAME_ORIGIN_REDIRECTS) {
      await response.body?.cancel?.('SUPREME_UPSTREAM_REDIRECT_BLOCKED').catch(() => {});
      throw upstreamError({
        upstreamStatus: response.status,
        failureKind: safeRedirect ? 'redirect_limit' : 'redirect_blocked',
        targetKind: classifyTarget(endpoint),
      });
    }
    await response.body?.cancel?.('SUPREME_UPSTREAM_REDIRECT_FOLLOWED').catch(() => {});
    currentTarget = nextTarget;
  }
  throw upstreamError({ failureKind: 'redirect_limit', targetKind: classifyTarget(endpoint) });
}

async function callOpenAICompatible({
  endpoint,
  route,
  messages,
  upstreamKey,
  signal,
}) {
  const response = await fetchUpstream(endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: {
      Authorization: `Bearer ${upstreamKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: false,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
  const payload = await readJsonResponse(response);
  const text = String(payload?.choices?.[0]?.message?.content || '');
  if (!text) throw upstreamError({ failureKind: 'response_empty' });
  return text;
}

function callAgProxy(options) {
  return callOpenAICompatible({ ...options, endpoint: AG_CHAT_URL });
}

function callCustomProxy(options) {
  const { route } = options;
  if (
    !isRelayAllowedTarget(route.baseUrl)
    || !isOpenAIProxyRequestPathAllowed(route.chatCompletionsPath)
  ) {
    throw Object.assign(new Error('SUPREME_PROVIDER_UNSUPPORTED'), {
      status: 422,
      code: 'SUPREME_PROVIDER_UNSUPPORTED',
    });
  }
  const endpoint = buildOpenAIProxyEndpoint(route.baseUrl, route.chatCompletionsPath);
  const baseUrl = new URL(route.baseUrl);
  const targetUrl = new URL(endpoint);
  if (targetUrl.origin !== baseUrl.origin || !isRelayAllowedTarget(endpoint)) {
    throw Object.assign(new Error('SUPREME_PROVIDER_UNSUPPORTED'), {
      status: 422,
      code: 'SUPREME_PROVIDER_UNSUPPORTED',
    });
  }
  return callOpenAICompatible({ ...options, endpoint });
}

function toGeminiContents(messages) {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }],
    }));
}

async function callGeminiDirect({ route, messages, upstreamKey, signal }) {
  const systemMessage = messages.find((message) => message.role === 'system');
  const url = `${GEMINI_API_ROOT}/${encodeURIComponent(route.model)}:generateContent`;
  const response = await fetchUpstream(url, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': upstreamKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: String(systemMessage?.content || '') }],
      },
      contents: toGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    }),
  });
  const payload = await readJsonResponse(response);
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => String(part?.text || ''))
    .join('');
  if (!text) throw upstreamError({ failureKind: 'response_empty' });
  return text;
}

export async function callSupremeProvider(options) {
  if (!options.upstreamKey) throw Object.assign(new Error('SUPREME_PROVIDER_KEY_REQUIRED'), {
    status: 422,
    code: 'SUPREME_CHAT_REQUEST_INVALID',
  });
  if (options.route.provider === 'openai_proxy' && options.route.proxyProfileId === 'ag-gemini-proxy') {
    return callAgProxy(options);
  }
  if (
    options.route.provider === 'openai_proxy'
    && options.route.proxyProfileId === CUSTOM_PROXY_PROFILE_ID
  ) {
    return callCustomProxy(options);
  }
  if (options.route.provider === 'gemini_direct') return callGeminiDirect(options);
  throw Object.assign(new Error('SUPREME_PROVIDER_UNSUPPORTED'), {
    status: 422,
    code: 'SUPREME_PROVIDER_UNSUPPORTED',
  });
}
