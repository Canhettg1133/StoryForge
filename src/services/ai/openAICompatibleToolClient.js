const DEFAULT_MAX_ARGUMENT_BYTES = 32 * 1024;
const DEFAULT_TURN_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function requireNonEmptyText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseToolArguments(value, maxArgumentBytes) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  if (new TextEncoder().encode(raw).byteLength > maxArgumentBytes) {
    throw new Error('Tool call arguments exceed the allowed size.');
  }

  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : (value ?? {});
  } catch {
    throw new Error('Tool call arguments must be valid JSON.');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Tool call arguments must be a JSON object.');
  }
  return parsed;
}

export function buildOpenAICompatibleToolPayload({
  model,
  messages,
  tools,
  ...options
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('At least one message is required.');
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('At least one tool is required.');
  }

  return {
    ...options,
    model: requireNonEmptyText(model, 'Model'),
    messages,
    tools,
    stream: false,
    tool_choice: 'required',
    parallel_tool_calls: false,
  };
}

export function parseOpenAICompatibleToolResponse(response, {
  allowedToolNames = [],
  maxArgumentBytes = DEFAULT_MAX_ARGUMENT_BYTES,
} = {}) {
  const message = response?.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length !== 1) {
    throw new Error('The model must return exactly one tool call.');
  }

  const toolCall = toolCalls[0];
  if (toolCall?.type !== 'function') {
    throw new Error('Unsupported tool call type.');
  }
  const name = requireNonEmptyText(toolCall?.function?.name, 'Tool name');
  if (!allowedToolNames.includes(name)) {
    throw new Error(`Unknown tool call: ${name}.`);
  }

  return {
    message,
    toolCallId: requireNonEmptyText(toolCall.id, 'Tool call id'),
    name,
    arguments: parseToolArguments(toolCall?.function?.arguments, maxArgumentBytes),
  };
}

function parseRetryAfterMs(value, now = Date.now()) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

function createRelayError(status, code = 'CODEX_TOOL_RELAY_FAILED') {
  const error = new Error(`Codex tool relay failed with status ${status}.`);
  error.name = 'CodexToolRelayError';
  error.status = status;
  error.code = code;
  error.retryable = RETRYABLE_STATUSES.has(status);
  return error;
}

async function readBoundedResponseText(response, maxBytes = 16 * 1024) {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0);
  if (contentLength > maxBytes) return '';
  const reader = response?.body?.getReader?.();
  if (!reader) {
    if (typeof response?.text !== 'function') return '';
    const text = await response.text().catch(() => '') || '';
    return new TextEncoder().encode(text).byteLength <= maxBytes ? text : '';
  }

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value?.byteLength || 0;
      if (totalBytes > maxBytes) {
        try { await reader.cancel?.(); } catch { /* Ignore cancellation failures. */ }
        return '';
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

async function createRelayErrorFromResponse(response) {
  const status = Number(response?.status || 0);
  if (status !== 400) return createRelayError(status);

  const body = await readBoundedResponseText(response);
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = String(parsed?.detail || parsed?.error?.message || parsed?.message || '');
  } catch {
    detail = body;
  }
  const code = /invalid argument/iu.test(detail)
    ? 'CODEX_TOOL_UPSTREAM_INVALID_ARGUMENT'
    : 'CODEX_TOOL_UPSTREAM_BAD_REQUEST';
  return createRelayError(status, code);
}

function createTurnTimeoutError(cause) {
  const error = createRelayError(408, 'CODEX_TOOL_TURN_TIMEOUT');
  error.cause = cause;
  return error;
}

function createAttemptSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort(externalSignal?.reason || 'request-aborted');
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort('request-timeout');
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
    },
  };
}

function waitForRetryDelay(ms, signal, sleepImpl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal?.reason || new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => sleepImpl(ms))
      .then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

export async function requestOpenAICompatibleToolTurn({
  profile,
  apiKey,
  accessToken,
  payload,
  allowedToolNames,
  signal,
  timeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  randomImpl = Math.random,
  usage = {
    taskType: 'codex_entity_resolution',
    taskGroup: 'codex',
    surface: 'chapter_completion',
  },
}) {
  const baseUrl = requireNonEmptyText(profile?.baseUrl, 'Proxy base URL');
  const providerKey = requireNonEmptyText(apiKey, 'Provider API key');
  const body = {
    action: 'chat',
    baseUrl,
    chatCompletionsPath: profile?.chatCompletionsPath || '/v1/chat/completions',
    usage,
    payload,
  };
  const turnSignal = createAttemptSignal(signal, timeoutMs);
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl('/api/openai-proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            'X-StoryForge-Upstream-Key': providerKey,
          },
          body: JSON.stringify(body),
          signal: turnSignal.signal,
        });
      } catch (cause) {
        if (turnSignal.timedOut()) throw createTurnTimeoutError(cause);
        throw cause;
      }

      if (response.ok) {
        return parseOpenAICompatibleToolResponse(await response.json(), {
          allowedToolNames,
        });
      }

      const error = await createRelayErrorFromResponse(response);
      if (!error.retryable || attempt >= maxRetries) throw error;

      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('Retry-After'));
      const exponentialMs = 500 * (2 ** attempt);
      const jitterMs = Math.floor(Math.max(0, randomImpl()) * 250);
      try {
        await waitForRetryDelay(
          Math.max(retryAfterMs, exponentialMs) + jitterMs,
          turnSignal.signal,
          sleepImpl,
        );
      } catch (cause) {
        if (turnSignal.timedOut()) throw createTurnTimeoutError(cause);
        throw cause;
      }
    }
  } finally {
    turnSignal.cleanup();
  }

  throw createRelayError(500);
}

export {
  DEFAULT_MAX_ARGUMENT_BYTES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TURN_TIMEOUT_MS,
  RETRYABLE_STATUSES,
  parseRetryAfterMs,
};
