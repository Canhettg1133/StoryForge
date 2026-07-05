import { getHeader, readJsonBody, sendJson } from './_lib/http.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const ALLOWED_ACTIONS = new Set(['run', 'models']);

export const config = {
  maxDuration: 300,
};

function trimText(value) {
  return String(value || '').trim();
}

function getUpstreamKey(req) {
  return getHeader(req, 'x-storyforge-upstream-key').trim();
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

function copyResponseHeaders(upstream, res) {
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
}

async function pipeUpstreamResponse(upstream, res) {
  res.statusCode = upstream.status;
  copyResponseHeaders(upstream, res);
  const contentType = trimText(upstream.headers.get('content-type')).toLowerCase();
  if (contentType.startsWith('image/')) {
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  res.end(await upstream.text().catch(() => ''));
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
    sendJson(res, 400, { error: 'Nội dung JSON gửi lên không hợp lệ.', code: 'CLOUDFLARE_WORKERS_AI_BAD_JSON' });
    return;
  }

  const action = trimText(body?.action);
  if (!ALLOWED_ACTIONS.has(action)) {
    sendJson(res, 400, { error: 'Hành động Cloudflare Workers AI không được hỗ trợ.', code: 'CLOUDFLARE_WORKERS_AI_BAD_ACTION' });
    return;
  }

  const upstreamKey = getUpstreamKey(req);
  if (!upstreamKey) {
    sendJson(res, 400, {
      error: 'Thiếu API token Cloudflare Workers AI.',
      code: 'CLOUDFLARE_WORKERS_AI_UPSTREAM_KEY_REQUIRED',
    });
    return;
  }

  const accountId = trimText(body?.accountId);
  if (!isValidAccountId(accountId)) {
    sendJson(res, 400, {
      error: 'Account ID Cloudflare không hợp lệ.',
      code: 'CLOUDFLARE_WORKERS_AI_BAD_ACCOUNT_ID',
    });
    return;
  }

  const headers = {
    Authorization: `Bearer ${upstreamKey}`,
  };

  let endpoint = '';
  let init = {};
  if (action === 'models') {
    endpoint = buildModelSearchUrl(accountId, body?.search);
    init = {
      method: 'GET',
      redirect: 'manual',
      headers,
    };
  } else {
    const model = trimText(body?.model);
    if (!isValidModelName(model)) {
      sendJson(res, 400, {
        error: 'Model Cloudflare Workers AI không hợp lệ.',
        code: 'CLOUDFLARE_WORKERS_AI_BAD_MODEL',
      });
      return;
    }
    endpoint = `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/run/${model}`;
    if (isMultipartModel(model)) {
      init = {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: buildMultipartBody(body?.payload || {}),
      };
    } else {
      init = {
        method: 'POST',
        redirect: 'manual',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body?.payload || {}),
      };
    }
  }

  try {
    const upstream = await fetch(endpoint, init);
    await pipeUpstreamResponse(upstream, res);
  } catch (error) {
    sendJson(res, 502, {
      error: error?.message || 'Relay Cloudflare Workers AI thất bại.',
      code: 'CLOUDFLARE_WORKERS_AI_UPSTREAM_FAILED',
    });
  }
}
