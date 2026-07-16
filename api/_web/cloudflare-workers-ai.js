import { ACCESS_FEATURES, requireFeature } from '../_lib/access-control.js';
import { checkRateLimit } from '../_lib/rate-limit.js';
import {
  getBoundedEnvInteger,
  jsonResponse,
  normalizeRuntime,
  publicErrorResponse,
  readJsonRequest,
  relayResponse,
  toReadableStream,
} from '../_lib/web.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const ALLOWED_ACTIONS = new Set(['run', 'models']);
const DEFAULT_MAX_BODY_BYTES = 6 * 1024 * 1024;
const DEFAULT_RATE_LIMIT = 40;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;

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

function trimText(value) {
  return String(value || '').trim();
}

function getUpstreamKey(request) {
  return trimText(request.headers.get('x-storyforge-upstream-key'));
}

function getMaxBodyBytes(env) {
  return getBoundedEnvInteger(env, 'CLOUDFLARE_WORKERS_AI_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES, {
    min: 16 * 1024,
    max: 8 * 1024 * 1024,
  });
}

function getRateLimit(env) {
  return getBoundedEnvInteger(env, 'CLOUDFLARE_WORKERS_AI_RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT, {
    min: 1,
    max: 10_000,
  });
}

function getRateWindowMs(env) {
  return getBoundedEnvInteger(env, 'CLOUDFLARE_WORKERS_AI_RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_WINDOW_MS, {
    min: 10_000,
    max: 10 * 60 * 1000,
  });
}

function isValidAccountId(value) {
  return /^[a-f0-9]{32}$/iu.test(trimText(value));
}

function isValidModelName(value) {
  const model = trimText(value);
  return /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(model)
    && !model.includes('..')
    && !model.includes('?')
    && !model.includes('#');
}

function buildModelSearchUrl(accountId, search) {
  const url = new URL(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/models/search`);
  url.searchParams.set('search', trimText(search) || 'image');
  url.searchParams.set('per_page', '100');
  return url.toString();
}

function isMultipartModel(model) {
  return /^@cf\/black-forest-labs\/flux-2-/iu.test(trimText(model));
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormValue(form, key, item));
    return;
  }
  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value));
    return;
  }
  form.append(key, String(value));
}

function buildMultipartBody(payload = {}) {
  const form = new FormData();
  Object.entries(payload && typeof payload === 'object' ? payload : {}).forEach(([key, value]) => {
    appendFormValue(form, key, value);
  });
  return form;
}

async function callRequireFeature(request, runtime, requireFeatureImpl) {
  if (requireFeatureImpl) return requireFeatureImpl(request, ACCESS_FEATURES.PROJECT_COVER_GENERATION, runtime);
  return requireFeature(request, ACCESS_FEATURES.PROJECT_COVER_GENERATION, {}, runtime);
}

export function createCloudflareWorkersAIWebHandler({ requireFeatureImpl = null } = {}) {
  return async function cloudflareWorkersAIWebHandler(request, runtimeInput = {}) {
    const runtime = normalizeRuntime(runtimeInput);
    if (request.method === 'OPTIONS') return relayResponse(new Response(null, { status: 204 }));
    if (request.method !== 'POST') {
      return relayJson({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
    }

    const rateLimit = checkRateLimit(request, {
      keyPrefix: 'cloudflare-workers-ai',
      limit: getRateLimit(runtime.env),
      windowMs: getRateWindowMs(runtime.env),
    });
    const rateHeaders = rateLimit.headers;
    if (!rateLimit.allowed) {
      return withRelay(publicErrorResponse(request, 429, {
        code: 'CLOUDFLARE_WORKERS_AI_RATE_LIMITED',
        error: 'Too many image requests. Try again later.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }), rateHeaders);
    }

    let body;
    try {
      body = await readJsonRequest(request, { maxBytes: getMaxBodyBytes(runtime.env) });
    } catch (error) {
      if (error?.code === 'JSON_BODY_TOO_LARGE') {
        return withRelay(publicErrorResponse(request, 413, {
          code: 'CLOUDFLARE_WORKERS_AI_BODY_TOO_LARGE',
          error: 'Workers AI request body exceeds the safe limit.',
        }), rateHeaders);
      }
      return relayJson({ error: 'Invalid JSON body.', code: 'CLOUDFLARE_WORKERS_AI_BAD_JSON' }, 400, rateHeaders);
    }

    const action = trimText(body?.action);
    if (!ALLOWED_ACTIONS.has(action)) {
      return relayJson({ error: 'Unsupported Workers AI action.', code: 'CLOUDFLARE_WORKERS_AI_BAD_ACTION' }, 400, rateHeaders);
    }

    const access = await callRequireFeature(request, runtime, requireFeatureImpl);
    if (!access.ok) {
      const code = access?.reason || 'FEATURE_NOT_ALLOWED';
      return relayJson({ error: code, code }, access?.status || 403, rateHeaders);
    }

    const upstreamKey = getUpstreamKey(request);
    if (!upstreamKey) {
      return relayJson({
        error: 'Missing Cloudflare Workers AI API token.',
        code: 'CLOUDFLARE_WORKERS_AI_UPSTREAM_KEY_REQUIRED',
      }, 400, rateHeaders);
    }

    const accountId = trimText(body?.accountId);
    if (!isValidAccountId(accountId)) {
      return relayJson({ error: 'Invalid Cloudflare account ID.', code: 'CLOUDFLARE_WORKERS_AI_BAD_ACCOUNT_ID' }, 400, rateHeaders);
    }

    const authHeaders = { Authorization: `Bearer ${upstreamKey}` };
    let endpoint;
    let init;
    if (action === 'models') {
      endpoint = buildModelSearchUrl(accountId, body?.search);
      init = { method: 'GET', redirect: 'manual', headers: authHeaders, signal: request.signal };
    } else {
      const model = trimText(body?.model);
      if (!isValidModelName(model)) {
        return relayJson({ error: 'Invalid Workers AI model.', code: 'CLOUDFLARE_WORKERS_AI_BAD_MODEL' }, 400, rateHeaders);
      }
      endpoint = `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/run/${model}`;
      init = isMultipartModel(model)
        ? {
          method: 'POST',
          redirect: 'manual',
          headers: authHeaders,
          body: buildMultipartBody(body?.payload || {}),
          signal: request.signal,
        }
        : {
          method: 'POST',
          redirect: 'manual',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(body?.payload || {}),
          signal: request.signal,
        };
    }

    try {
      const upstream = await fetch(endpoint, init);
      const headers = new Headers(rateHeaders);
      const contentType = upstream.headers.get('content-type');
      if (contentType) headers.set('Content-Type', contentType);
      return withRelay(new Response(toReadableStream(upstream.body), { status: upstream.status, headers }));
    } catch {
      return relayJson({
        error: 'Cloudflare Workers AI relay failed.',
        code: 'CLOUDFLARE_WORKERS_AI_UPSTREAM_FAILED',
      }, 502, rateHeaders);
    }
  };
}
