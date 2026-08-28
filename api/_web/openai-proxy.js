import {
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_IMAGE_GENERATIONS_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  isLocalProxyHost,
  parseOpenAIModelIds,
} from '../../src/services/ai/openAIProxyCore.js';
import { checkRateLimit } from '../_lib/rate-limit.js';
import {
  ACCESS_FEATURES,
  requireFeature,
  requireFeatures,
} from '../_lib/access-control.js';
import {
  getBoundedEnvInteger,
  jsonResponse,
  normalizeRuntime,
  publicErrorResponse,
  readJsonRequest,
  relayResponse,
  toReadableStream,
} from '../_lib/web.js';

const ALLOWED_ACTIONS = new Set(['models', 'model_catalog', 'chat', 'chat_stream_batch', 'image_generation']);
export const MAX_CHAT_STREAM_BATCH_SIZE = 30;
const DEFAULT_OPENAI_PROXY_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_OPENAI_PROXY_RATE_LIMIT = 120;
const DEFAULT_OPENAI_PROXY_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_CHAT_STREAM_BATCH_CONCURRENCY = 6;
const DEFAULT_USAGE_LOGGING_TIMEOUT_MS = 2000;
const AG_PROXY_HOSTS = new Set(['ag.beijixingxing.com']);
const AG_PROXY_SAFE_SUFFIXES = ['.beijixingxing.com'];
const MODEL_CATALOG_URLS = new Map([
  ['9router_opencode', 'https://opencode.ai/zen/v1/models'],
]);

export const TRANSLATOR_TEMPLATE_IDS = new Set([
  'convert',
  'novel',
  'wuxia',
  'romance',
  'adult',
  'sacHiep',
  'sacHiepPro',
  'sacHiepENI',
]);
export const TRANSLATOR_ADULT_TEMPLATE_IDS = new Set([
  'adult',
  'sacHiep',
  'sacHiepPro',
  'sacHiepENI',
]);
const ADULT_RUNTIME_MODES = new Set([
  'adult',
  '18+',
  'eni',
  'sachiep',
  'sachiepeni',
  'sac-hiep',
  'sac-hiep-eni',
]);

function withRelay(response, headers = {}) {
  const merged = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => merged.set(key, value));
  return relayResponse(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  }));
}

function relayJson(payload, status = 200, headers = {}) {
  return withRelay(jsonResponse(payload, status), headers);
}

function relayPublicError(request, status, options, headers = {}) {
  return withRelay(publicErrorResponse(request, status, options), headers);
}

function getOpenAIProxyMaxBodyBytes(env) {
  return getBoundedEnvInteger(env, 'OPENAI_PROXY_MAX_BODY_BYTES', DEFAULT_OPENAI_PROXY_MAX_BODY_BYTES, {
    min: 16 * 1024,
    max: 8 * 1024 * 1024,
  });
}

function getOpenAIProxyRateLimit(env) {
  return getBoundedEnvInteger(env, 'OPENAI_PROXY_RATE_LIMIT_MAX', DEFAULT_OPENAI_PROXY_RATE_LIMIT, {
    min: 1,
    max: 10_000,
  });
}

function getOpenAIProxyRateWindowMs(env) {
  return getBoundedEnvInteger(env, 'OPENAI_PROXY_RATE_LIMIT_WINDOW_MS', DEFAULT_OPENAI_PROXY_RATE_WINDOW_MS, {
    min: 10_000,
    max: 10 * 60 * 1000,
  });
}

function getChatStreamBatchConcurrency(env) {
  return getBoundedEnvInteger(env, 'OPENAI_PROXY_BATCH_CONCURRENCY', DEFAULT_CHAT_STREAM_BATCH_CONCURRENCY, {
    min: 1,
    max: 6,
  });
}

function getUpstreamKey(request) {
  return String(request.headers.get('x-storyforge-upstream-key') || '').trim();
}

function normalizeHost(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/\.+$/u, '');
}

function parseRelayTarget(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return { ok: false };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }

  const hostname = normalizeHost(parsed.hostname);
  if (parsed.protocol !== 'https:') return { ok: false };
  if (parsed.username || parsed.password) return { ok: false };
  if (isLocalProxyHost(hostname)) return { ok: false };
  return { ok: true, parsed, hostname };
}

function isAgProxyHostname(hostname = '') {
  const host = normalizeHost(hostname);
  return AG_PROXY_HOSTS.has(host) || AG_PROXY_SAFE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function getProviderFeature(targetInfo) {
  return isAgProxyHostname(targetInfo?.hostname)
    ? ACCESS_FEATURES.AG_PROXY
    : ACCESS_FEATURES.CUSTOM_PROXY;
}

function getProviderName(providerFeature) {
  if (providerFeature === ACCESS_FEATURES.AG_PROXY) return 'ag_proxy';
  if (providerFeature === ACCESS_FEATURES.CUSTOM_PROXY) return 'custom_proxy';
  return 'openai_proxy';
}

function normalizeTemplateId(value) {
  return String(value || '').trim();
}

function getTranslatorTemplateId(body = {}) {
  const templateId = normalizeTemplateId(
    body.templateId
      || body.template_id
      || body.runtimeMode
      || body.runtime_mode
      || body.template,
  );
  return TRANSLATOR_TEMPLATE_IDS.has(templateId) ? templateId : '';
}

export function isTranslatorAdultTemplate(templateId) {
  return TRANSLATOR_ADULT_TEMPLATE_IDS.has(normalizeTemplateId(templateId));
}

function normalizeRuntimeMode(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\u0111/giu, 'd')
    .toLowerCase()
    .replace(/[\s_]+/gu, '-');
}

function isServerRecognizedAdultRuntime(body = {}) {
  return [
    body.templateId,
    body.template_id,
    body.runtimeMode,
    body.runtime_mode,
    body.contentMode,
    body.content_mode,
    body.projectContentMode,
    body.project_content_mode,
  ].some((value) => ADULT_RUNTIME_MODES.has(normalizeRuntimeMode(value)));
}

function getWorkflowFeature(action, workflowFeature) {
  return action === 'models' ? '' : workflowFeature;
}

function createAccessError(status, reason, feature = '') {
  return {
    ok: false,
    status,
    reason,
    decision: { allowed: false, status, reason, feature },
  };
}

async function callRequireFeature(request, featureKey, runtime, requireFeatureImpl) {
  if (requireFeatureImpl) return requireFeatureImpl(request, featureKey, runtime);
  return requireFeature(request, featureKey, {}, runtime);
}

async function requireFeatureSequence(request, featureKeys, runtime, requireFeatureImpl) {
  if (!requireFeatureImpl) return requireFeatures(request, featureKeys, runtime);
  let lastAccess = null;
  for (const featureKey of featureKeys) {
    lastAccess = await requireFeatureImpl(request, featureKey, runtime);
    if (!lastAccess.ok) return lastAccess;
  }
  return lastAccess || { ok: true, decision: { allowed: true } };
}

async function requireProxyAccess(request, {
  body,
  action,
  targetInfo,
  workflowFeature,
  requireTranslatorTemplate,
  requireFeatureImpl,
  runtime,
}) {
  const requiredWorkflowFeature = getWorkflowFeature(action, workflowFeature);
  const providerFeature = getProviderFeature(targetInfo);
  const templateId = requireTranslatorTemplate && action !== 'models'
    ? getTranslatorTemplateId(body)
    : '';

  if (requireTranslatorTemplate && action !== 'models' && !templateId) {
    return createAccessError(400, 'TRANSLATOR_TEMPLATE_REQUIRED', 'translator.template');
  }

  const needsAdultMode = requireTranslatorTemplate
    ? isTranslatorAdultTemplate(templateId)
    : isServerRecognizedAdultRuntime(body);
  const requiredFeatures = [
    requiredWorkflowFeature,
    providerFeature,
    needsAdultMode ? ACCESS_FEATURES.ADULT_MODE : '',
  ].filter(Boolean);
  const access = await requireFeatureSequence(request, requiredFeatures, runtime, requireFeatureImpl);
  if (!access.ok) return access;

  return {
    ...access,
    workflowFeature: requiredWorkflowFeature,
    providerFeature,
    adultFeature: needsAdultMode ? ACCESS_FEATURES.ADULT_MODE : '',
    templateId,
  };
}

function accessDeniedResponse(access, rateHeaders = {}) {
  const code = access?.reason || 'FEATURE_NOT_ALLOWED';
  return relayJson({ error: code, code }, access?.status || 403, rateHeaders);
}

async function handleModelCatalogAction(request, body, runtime, requireFeatureImpl, rateHeaders) {
  const catalog = String(body?.catalog || '').trim();
  const catalogUrl = MODEL_CATALOG_URLS.get(catalog);
  if (!catalogUrl) {
    return relayJson({
      error: 'Model catalog is not supported.',
      code: 'OPENAI_PROXY_BAD_MODEL_CATALOG',
    }, 400, rateHeaders);
  }

  const access = await callRequireFeature(request, ACCESS_FEATURES.CUSTOM_PROXY, runtime, requireFeatureImpl);
  if (!access.ok) return accessDeniedResponse(access, rateHeaders);

  try {
    const upstream = await fetch(catalogUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal: request.signal,
    });
    if (!upstream.ok) {
      return relayJson({
        error: 'Could not load model catalog.',
        code: 'OPENAI_PROXY_MODEL_CATALOG_FAILED',
      }, 502, rateHeaders);
    }
    const payload = await upstream.json().catch(() => null);
    const models = parseOpenAIModelIds(payload);
    return relayJson({
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', owned_by: catalog })),
    }, 200, rateHeaders);
  } catch {
    return relayJson({
      error: 'Could not load model catalog.',
      code: 'OPENAI_PROXY_MODEL_CATALOG_FAILED',
    }, 502, rateHeaders);
  }
}

function createUsageRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `openai-proxy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const USAGE_METADATA_KEYS = ['taskType', 'taskGroup', 'taskLabel', 'surface', 'chatMode'];

function sanitizeUsageMetadata(body) {
  const source = body?.usage && typeof body.usage === 'object' ? body.usage : body?.usageContext;
  if (!source || typeof source !== 'object') return {};
  return USAGE_METADATA_KEYS.reduce((acc, key) => {
    const value = String(source[key] || '').trim().replace(/\s+/gu, ' ');
    if (value) acc[key] = value.slice(0, 80);
    return acc;
  }, {});
}

function getRequestModel(body, action) {
  if (action === 'chat_stream_batch') return String(body?.payloads?.[0]?.model || '').trim();
  return String(body?.payload?.model || '').trim();
}

async function logProxyUsage(access, { body, action, status }) {
  if (!access?.supabase || !access?.user?.id) return;
  const provider = getProviderName(access.providerFeature);
  const count = action === 'chat_stream_batch'
    ? Math.max(1, Array.isArray(body?.payloads) ? body.payloads.length : 0)
    : 1;
  await access.supabase.from('usage_events').insert({
    request_id: createUsageRequestId(),
    user_id: access.user.id,
    feature_key: access.workflowFeature || access.providerFeature || null,
    provider,
    model: getRequestModel(body, action),
    event_type: action || 'request',
    count,
    status,
    metadata: {
      action,
      providerFeature: access.providerFeature || '',
      workflowFeature: access.workflowFeature || '',
      ...sanitizeUsageMetadata(body),
    },
  });
}

function isUsageLoggingEnabled(env) {
  return String(env.USAGE_LOGGING_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function getUsageLoggingTimeoutMs(env) {
  return getBoundedEnvInteger(env, 'USAGE_LOGGING_TIMEOUT_MS', DEFAULT_USAGE_LOGGING_TIMEOUT_MS, {
    min: 500,
    max: 10_000,
  });
}

function withTimeout(promise, timeoutMs, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function scheduleProxyUsageLog(access, usageArgs, runtime) {
  if (!isUsageLoggingEnabled(runtime.env)) return;
  runtime.defer(withTimeout(
    logProxyUsage(access, usageArgs),
    getUsageLoggingTimeoutMs(runtime.env),
    'USAGE_LOG_TIMEOUT',
  ).catch((error) => {
    console.warn('[openai-proxy] usage logging skipped', {
      code: error?.code || 'USAGE_LOG_FAILED',
      action: usageArgs?.action || '',
    });
  }));
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

function parseRetryAfterSeconds(value, now = Date.now()) {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const retryAt = Date.parse(String(value));
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

async function fetchChatPayload(endpoint, headers, payload, signal) {
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: JSON.stringify(payload || {}),
      signal,
    });
    return {
      ok: upstream.ok,
      status: upstream.status,
      retryAfterSeconds: parseRetryAfterSeconds(upstream.headers.get('retry-after')),
      body: await readUpstreamResponseBody(upstream),
    };
  } catch {
    return {
      ok: false,
      status: 502,
      body: { error: 'OpenAI relay failed.', code: 'OPENAI_PROXY_UPSTREAM_FAILED' },
    };
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index], index);
    }
  }));
}

function createBatchStreamResponse({ payloads, endpoint, headers, request, runtime, rateHeaders }) {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener('abort', abort, { once: true });
  const encoder = new TextEncoder();
  const stream = new TransformStream(undefined, undefined, { highWaterMark: 0 });
  const writer = stream.writable.getWriter();
  const completion = mapWithConcurrency(
    payloads,
    getChatStreamBatchConcurrency(runtime.env),
    async (payload, index) => {
      const result = await fetchChatPayload(endpoint, headers, payload, controller.signal);
      await writer.write(encoder.encode(`${JSON.stringify({ index, ...result })}\n`));
    },
  ).then(
    () => writer.close(),
    async (error) => {
      controller.abort();
      await writer.abort(error).catch(() => {});
      throw error;
    },
  ).finally(() => {
    request.signal.removeEventListener?.('abort', abort);
  });

  return {
    completion,
    response: withRelay(new Response(stream.readable, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
    }), rateHeaders),
  };
}

export function createOpenAIProxyWebHandler({
  workflowFeature = ACCESS_FEATURES.AI_CHAT_ACCESS,
  requireTranslatorTemplate = false,
  requireFeatureImpl = null,
} = {}) {
  return async function openAIProxyWebHandler(request, runtimeInput = {}) {
    const runtime = normalizeRuntime(runtimeInput);
    if (request.method === 'OPTIONS') return relayResponse(new Response(null, { status: 204 }));
    if (request.method !== 'POST') {
      return relayJson({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
    }

    const rateLimit = checkRateLimit(request, {
      keyPrefix: 'openai-proxy',
      limit: getOpenAIProxyRateLimit(runtime.env),
      windowMs: getOpenAIProxyRateWindowMs(runtime.env),
    });
    const rateHeaders = rateLimit.headers;
    if (!rateLimit.allowed) {
      return relayPublicError(request, 429, {
        code: 'OPENAI_PROXY_RATE_LIMITED',
        error: 'Too many AI requests. Try again later.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }, rateHeaders);
    }

    let body;
    try {
      body = await readJsonRequest(request, { maxBytes: getOpenAIProxyMaxBodyBytes(runtime.env) });
    } catch (error) {
      if (error?.code === 'JSON_BODY_TOO_LARGE') {
        return relayPublicError(request, 413, {
          code: 'OPENAI_PROXY_BODY_TOO_LARGE',
          error: 'AI request body exceeds the safe limit.',
        }, rateHeaders);
      }
      return relayJson({ error: 'Invalid JSON body.', code: 'OPENAI_PROXY_BAD_JSON' }, 400, rateHeaders);
    }

    const action = String(body?.action || '').trim();
    if (!ALLOWED_ACTIONS.has(action)) {
      return relayJson({ error: 'Unsupported proxy action.', code: 'OPENAI_PROXY_BAD_ACTION' }, 400, rateHeaders);
    }
    if (action === 'model_catalog') {
      return handleModelCatalogAction(request, body, runtime, requireFeatureImpl, rateHeaders);
    }

    const baseUrl = String(body?.baseUrl || body?.targetBaseUrl || '').trim();
    const targetInfo = parseRelayTarget(baseUrl);
    if (!targetInfo.ok) {
      return relayJson({
        error: 'Proxy target must be a public HTTPS URL.',
        code: 'OPENAI_PROXY_TARGET_BLOCKED',
      }, 400, rateHeaders);
    }

    if (action === 'chat_stream_batch') {
      const payloads = Array.isArray(body?.payloads) ? body.payloads : [];
      if (payloads.length === 0 || payloads.length > MAX_CHAT_STREAM_BATCH_SIZE) {
        return relayJson({
          error: `Chat stream batch must contain 1-${MAX_CHAT_STREAM_BATCH_SIZE} payloads.`,
          code: 'OPENAI_PROXY_BAD_BATCH',
        }, 400, rateHeaders);
      }
    }

    const access = await requireProxyAccess(request, {
      body,
      action,
      targetInfo,
      workflowFeature,
      requireTranslatorTemplate,
      requireFeatureImpl,
      runtime,
    });
    if (!access.ok) return accessDeniedResponse(access, rateHeaders);

    const upstreamKey = getUpstreamKey(request);
    if (!upstreamKey) {
      return relayJson({
        error: 'Missing provider key in X-StoryForge-Upstream-Key.',
        code: 'OPENAI_PROXY_UPSTREAM_KEY_REQUIRED',
      }, 400, rateHeaders);
    }

    const endpoint = action === 'models'
      ? buildOpenAIProxyEndpoint(baseUrl, body?.modelsPath || DEFAULT_PROXY_MODELS_PATH)
      : action === 'image_generation'
        ? buildOpenAIProxyEndpoint(baseUrl, body?.imageGenerationsPath || DEFAULT_PROXY_IMAGE_GENERATIONS_PATH)
        : buildOpenAIProxyEndpoint(baseUrl, body?.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH);
    const upstreamAuthHeaders = { Authorization: `Bearer ${upstreamKey}` };
    const chatHeaders = { 'Content-Type': 'application/json', ...upstreamAuthHeaders };
    let usageLogged = false;
    const logUsageOnce = (status) => {
      if (usageLogged) return;
      usageLogged = true;
      scheduleProxyUsageLog(access, { body, action, status }, runtime);
    };

    if (action === 'chat_stream_batch') {
      const batch = createBatchStreamResponse({
        payloads: body.payloads,
        endpoint,
        headers: chatHeaders,
        request,
        runtime,
        rateHeaders,
      });
      batch.completion.then(
        () => logUsageOnce('ok'),
        () => logUsageOnce('error'),
      );
      return batch.response;
    }

    try {
      const upstream = await fetch(endpoint, action === 'models'
        ? {
          method: 'GET',
          redirect: 'manual',
          headers: upstreamAuthHeaders,
          signal: request.signal,
        }
        : {
          method: 'POST',
          redirect: 'manual',
          headers: chatHeaders,
          body: JSON.stringify(body?.payload || {}),
          signal: request.signal,
        });
      logUsageOnce(upstream.ok ? 'ok' : 'error');
      const headers = new Headers(rateHeaders);
      const contentType = upstream.headers.get('content-type');
      if (contentType) headers.set('Content-Type', contentType);
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter) headers.set('Retry-After', retryAfter);
      return withRelay(new Response(toReadableStream(upstream.body), {
        status: upstream.status,
        headers,
      }));
    } catch {
      logUsageOnce('error');
      return relayJson({
        error: 'OpenAI relay failed.',
        code: 'OPENAI_PROXY_UPSTREAM_FAILED',
      }, 502, rateHeaders);
    }
  };
}
