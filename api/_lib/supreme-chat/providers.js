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

function upstreamError({
  upstreamStatus = 0,
  failureKind = 'unknown',
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
  return error;
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
  try {
    return await fetch(endpoint, init);
  } catch {
    throw upstreamError({
      failureKind: init.signal?.aborted ? 'request_aborted' : 'network',
    });
  }
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
    redirect: 'error',
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
    redirect: 'error',
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
