import {
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  isLocalProxyHost,
} from '../src/services/ai/openAIProxyCore.js';
import { getHeader, readJsonBody, sendJson } from './_lib/http.js';
import {
  ACCESS_FEATURES,
  requireFeature,
  requireFeatures,
  sendAccessDenied,
} from './_lib/access-control.js';

const ALLOWED_ACTIONS = new Set(['models', 'chat', 'chat_stream_batch']);
const MAX_CHAT_STREAM_BATCH_SIZE = 50;
const AG_PROXY_HOSTS = new Set(['ag.beijixingxing.com']);
const AG_PROXY_SAFE_SUFFIXES = ['.beijixingxing.com'];
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

export const config = {
  maxDuration: 300,
};

function copyResponseHeaders(upstream, res) {
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
}

async function pipeUpstreamResponse(upstream, res) {
  res.statusCode = upstream.status;
  copyResponseHeaders(upstream, res);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

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

function getUpstreamKey(req) {
  return getHeader(req, 'x-storyforge-upstream-key').trim();
}

function normalizeHost(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/\.+$/u, '');
}

function parseRelayTarget(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return { ok: false, reason: 'OPENAI_PROXY_TARGET_BLOCKED' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'OPENAI_PROXY_TARGET_BLOCKED' };
  }

  const hostname = normalizeHost(parsed.hostname);
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'OPENAI_PROXY_TARGET_BLOCKED' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'OPENAI_PROXY_TARGET_BLOCKED' };
  if (isLocalProxyHost(hostname)) return { ok: false, reason: 'OPENAI_PROXY_TARGET_BLOCKED' };

  return { ok: true, parsed, hostname };
}

function isAgProxyHostname(hostname = '') {
  const host = normalizeHost(hostname);
  return AG_PROXY_HOSTS.has(host)
    || AG_PROXY_SAFE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function getProviderFeature(targetInfo) {
  return isAgProxyHostname(targetInfo?.hostname)
    ? ACCESS_FEATURES.AG_PROXY
    : ACCESS_FEATURES.CUSTOM_PROXY;
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
  const candidates = [
    body.templateId,
    body.template_id,
    body.runtimeMode,
    body.runtime_mode,
    body.contentMode,
    body.content_mode,
    body.projectContentMode,
    body.project_content_mode,
  ];
  return candidates.some((value) => ADULT_RUNTIME_MODES.has(normalizeRuntimeMode(value)));
}

function getWorkflowFeature(action, workflowFeature = ACCESS_FEATURES.AI_CHAT_ACCESS) {
  return action === 'models' ? '' : workflowFeature;
}

function getProviderName(providerFeature) {
  if (providerFeature === ACCESS_FEATURES.AG_PROXY) return 'ag_proxy';
  if (providerFeature === ACCESS_FEATURES.CUSTOM_PROXY) return 'custom_proxy';
  return 'openai_proxy';
}

function getRequestModel(body, action) {
  if (action === 'chat_stream_batch') {
    return String(body?.payloads?.[0]?.model || '').trim();
  }
  return String(body?.payload?.model || '').trim();
}

function createUsageRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `openai-proxy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function logProxyUsage(access, { body, action, status = 'ok' } = {}) {
  if (!access?.supabase || !access?.user?.id) return;
  const featureKey = access.workflowFeature || access.providerFeature || null;
  const provider = getProviderName(access.providerFeature);
  const count = action === 'chat_stream_batch'
    ? Math.max(1, Array.isArray(body?.payloads) ? body.payloads.length : 0)
    : 1;

  await access.supabase.from('usage_events').insert({
    request_id: createUsageRequestId(),
    user_id: access.user.id,
    feature_key: featureKey,
    provider,
    model: getRequestModel(body, action),
    event_type: action || 'request',
    count,
    status,
    metadata: {
      action,
      providerFeature: access.providerFeature || '',
      workflowFeature: access.workflowFeature || '',
    },
  });
}

function buildUpstreamAuthHeaders(upstreamKey) {
  return upstreamKey
    ? { Authorization: `Bearer ${upstreamKey}` }
    : {};
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

function createProxyAccessError(status, reason, feature = '') {
  return {
    ok: false,
    status,
    reason,
    decision: {
      allowed: false,
      status,
      reason,
      feature,
    },
  };
}

async function requireProxyFeatureSequence(req, featureKeys, requireFeatureImpl) {
  if (requireFeatureImpl === requireFeature) {
    return requireFeatures(req, featureKeys);
  }

  let lastAccess = null;
  for (const featureKey of featureKeys) {
    lastAccess = await requireFeatureImpl(req, featureKey);
    if (!lastAccess.ok) return lastAccess;
  }
  return lastAccess || {
    ok: true,
    decision: { allowed: true },
  };
}

async function requireProxyAccess(req, {
  body,
  action,
  targetInfo,
  workflowFeature: configuredWorkflowFeature = ACCESS_FEATURES.AI_CHAT_ACCESS,
  requireTranslatorTemplate = false,
  requireFeatureImpl = requireFeature,
} = {}) {
  const workflowFeature = getWorkflowFeature(action, configuredWorkflowFeature);
  const providerFeature = getProviderFeature(targetInfo);
  const templateId = requireTranslatorTemplate && action !== 'models'
    ? getTranslatorTemplateId(body)
    : '';

  if (requireTranslatorTemplate && action !== 'models' && !templateId) {
    return createProxyAccessError(400, 'TRANSLATOR_TEMPLATE_REQUIRED', 'translator.template');
  }

  const needsAdultMode = requireTranslatorTemplate
    ? isTranslatorAdultTemplate(templateId)
    : isServerRecognizedAdultRuntime(body);
  const requiredFeatures = [
    workflowFeature,
    providerFeature,
    needsAdultMode ? ACCESS_FEATURES.ADULT_MODE : '',
  ].filter(Boolean);
  const access = await requireProxyFeatureSequence(req, requiredFeatures, requireFeatureImpl);
  if (!access.ok) return access;

  return {
    ...access,
    workflowFeature,
    providerFeature,
    adultFeature: needsAdultMode ? ACCESS_FEATURES.ADULT_MODE : '',
    templateId,
  };
}

export function createOpenAIProxyHandler({
  workflowFeature = ACCESS_FEATURES.AI_CHAT_ACCESS,
  requireTranslatorTemplate = false,
  requireFeatureImpl = requireFeature,
} = {}) {
  return async function handler(req, res) {
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
  const targetInfo = parseRelayTarget(baseUrl);
  if (!targetInfo.ok) {
    sendJson(res, 400, {
      error: 'Proxy target phải là URL HTTPS public.',
      code: 'OPENAI_PROXY_TARGET_BLOCKED',
    });
    return;
  }

  const access = await requireProxyAccess(req, {
    body,
    action,
    targetInfo,
    workflowFeature,
    requireTranslatorTemplate,
    requireFeatureImpl,
  });
  if (!access.ok) {
    sendAccessDenied(res, access);
    return;
  }

  const upstreamKey = getUpstreamKey(req);
  if (!upstreamKey) {
    sendJson(res, 400, {
      error: 'Thiếu provider key. Hãy gửi key bằng header X-StoryForge-Upstream-Key.',
      code: 'OPENAI_PROXY_UPSTREAM_KEY_REQUIRED',
    });
    return;
  }

  const endpoint = action === 'models'
    ? buildOpenAIProxyEndpoint(baseUrl, body?.modelsPath || DEFAULT_PROXY_MODELS_PATH)
    : buildOpenAIProxyEndpoint(baseUrl, body?.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH);

  const upstreamAuthHeaders = buildUpstreamAuthHeaders(upstreamKey);
  const chatHeaders = {
    'Content-Type': 'application/json',
    ...upstreamAuthHeaders,
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
      const result = await fetchChatPayload(endpoint, chatHeaders, payload);
      res.write(`${JSON.stringify({ index, ...result })}\n`);
    }));
    res.end();
    await logProxyUsage(access, { body, action, status: 'ok' }).catch(() => {});
    return;
  }

  try {
    const upstream = await fetch(endpoint, action === 'models'
      ? {
        method: 'GET',
        redirect: 'manual',
        headers: upstreamAuthHeaders,
      }
      : {
        method: 'POST',
        redirect: 'manual',
        headers: chatHeaders,
        body: JSON.stringify(body?.payload || {}),
      });

    await pipeUpstreamResponse(upstream, res);
    await logProxyUsage(access, { body, action, status: upstream.ok ? 'ok' : 'error' }).catch(() => {});
  } catch (error) {
    await logProxyUsage(access, { body, action, status: 'error' }).catch(() => {});
    if (res.headersSent || res.writableEnded) {
      if (!res.writableEnded) res.end();
      return;
    }
    sendJson(res, 502, {
      error: error?.message || 'Relay OpenAI proxy thất bại.',
      code: 'OPENAI_PROXY_UPSTREAM_FAILED',
    });
  }
  };
}

export default createOpenAIProxyHandler();
