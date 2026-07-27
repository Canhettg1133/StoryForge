const AG_CHAT_URL = 'https://ag.beijixingxing.com/v1/chat/completions';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8192;

function upstreamError() {
  const error = new Error('SUPREME_UPSTREAM_FAILED');
  error.status = 502;
  error.code = 'SUPREME_UPSTREAM_FAILED';
  return error;
}

async function readJsonResponse(response) {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    await response.body?.cancel?.('SUPREME_UPSTREAM_RESPONSE_TOO_LARGE').catch(() => {});
    throw upstreamError();
  }
  if (!response.body?.getReader) throw upstreamError();
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
        throw upstreamError();
      }
      text += decoder.decode(bytes, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
  if (!response.ok) throw upstreamError();
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamError();
  }
}

async function callAgProxy({ route, messages, upstreamKey, signal }) {
  const response = await fetch(AG_CHAT_URL, {
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
  if (!text) throw upstreamError();
  return text;
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
  const response = await fetch(url, {
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
  if (!text) throw upstreamError();
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
  if (options.route.provider === 'gemini_direct') return callGeminiDirect(options);
  throw Object.assign(new Error('SUPREME_PROVIDER_UNSUPPORTED'), {
    status: 422,
    code: 'SUPREME_PROVIDER_UNSUPPORTED',
  });
}
