import {
  ADMIN_PERMISSIONS,
  accessDenied,
  canUpdateUserRole,
  canUpdateUserStatus,
  hasPermission,
  normalizePlan,
  normalizeRole,
  normalizeStatus,
  resolveAccessSubject,
} from '../../../packages/access/src/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const ACCESS_TABLE = 'storyforge_user_access';
const AUDIT_TABLE = 'storyforge_audit_logs';
const FEATURE_TABLE = 'storyforge_features';
const PLAN_FEATURE_TABLE = 'storyforge_plan_features';
const CATALOG_TABLE = 'storyforge_plan_catalog';
const USAGE_TABLE = 'storyforge_usage';
const CONSENT_TABLE = 'storyforge_consent_records';

const ROUTE_PERMISSIONS = {
  users: ADMIN_PERMISSIONS.USERS_READ,
  catalog: ADMIN_PERMISSIONS.CATALOG_READ,
  audit: ADMIN_PERMISSIONS.AUDIT_READ,
  usage: ADMIN_PERMISSIONS.USAGE_READ,
  features: ADMIN_PERMISSIONS.FEATURES_READ,
  'plan-features': ADMIN_PERMISSIONS.PLAN_FEATURES_READ,
  consent: ADMIN_PERMISSIONS.CONSENT_READ,
};

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function validateEnv(env = {}) {
  const supabaseUrl = trimTrailingSlash(env.SUPABASE_URL);
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const allowedOrigins = String(env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!supabaseUrl || !serviceRoleKey) {
    throw makeError(500, 'ADMIN_ENV_MISSING', 'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY cho Admin API.');
  }
  if (allowedOrigins.some((origin) => origin === '*')) {
    throw makeError(500, 'ADMIN_CORS_WILDCARD_BLOCKED', 'Admin API không cho phép CORS wildcard.');
  }
  if (allowedOrigins.length === 0) {
    throw makeError(500, 'ADMIN_CORS_ORIGINS_MISSING', 'Thiếu ADMIN_ALLOWED_ORIGINS cho Admin API.');
  }

  return { supabaseUrl, serviceRoleKey, allowedOrigins };
}

function isOriginAllowed(request, config) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

function corsHeaders(request, config) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    Vary: 'Origin',
  };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(payload, status = 200, cors = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, ...JSON_HEADERS },
  });
}

async function readJson(request) {
  if (request.method === 'GET') return {};
  try {
    return await request.json();
  } catch {
    throw makeError(400, 'ADMIN_BAD_JSON', 'Nội dung JSON gửi lên không hợp lệ.');
  }
}

function getBearerToken(request) {
  const header = String(request.headers.get('Authorization') || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

async function readSupabaseJson(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
}

function restUrl(config, table, query = '') {
  const suffix = query ? `?${query}` : '';
  return `${config.supabaseUrl}/rest/v1/${table}${suffix}`;
}

async function supabaseRest(config, table, {
  method = 'GET',
  query = 'select=*',
  body,
  prefer = 'return=representation',
} = {}) {
  const response = await fetch(restUrl(config, table, query), {
    method,
    headers: supabaseHeaders(config, {
      ...JSON_HEADERS,
      Prefer: prefer,
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readSupabaseJson(response);
  if (!response.ok) {
    throw makeError(response.status || 500, 'ADMIN_SUPABASE_REST_FAILED', payload?.message || payload?.error || 'Supabase REST trả về lỗi.');
  }
  return payload;
}

async function authAdminFetch(config, path, init = {}) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: supabaseHeaders(config, {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    }),
  });
  const payload = await readSupabaseJson(response);
  if (!response.ok) {
    throw makeError(response.status || 500, 'ADMIN_SUPABASE_AUTH_FAILED', payload?.msg || payload?.message || 'Supabase Auth trả về lỗi.');
  }
  return payload;
}

async function authenticate(request, config) {
  const token = getBearerToken(request);
  if (!token) {
    throw makeError(401, 'ADMIN_AUTH_REQUIRED', 'Bạn cần đăng nhập trước khi dùng Admin API.');
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: supabaseHeaders(config, {
      Authorization: `Bearer ${token}`,
    }),
  });
  const payload = await readSupabaseJson(response);
  if (!response.ok || !payload?.id) {
    throw makeError(401, 'ADMIN_AUTH_INVALID', 'Phiên đăng nhập admin không hợp lệ.');
  }

  const subject = resolveAccessSubject(payload);
  const rows = await supabaseRest(config, ACCESS_TABLE, {
    query: `select=role,status,email,plan&${filterEq('user_id', subject.id)}&limit=1`,
    prefer: '',
  });
  const access = Array.isArray(rows) ? rows[0] : null;
  if (!access) return subject;
  if (String(access.status || 'active') !== 'active') {
    throw makeError(403, 'ADMIN_ACCOUNT_INACTIVE', 'Tài khoản admin đang bị khóa hoặc vô hiệu hóa.');
  }

  return resolveAccessSubject({
    ...payload,
    email: access.email || payload.email,
    app_metadata: {
      ...(payload.app_metadata || {}),
      role: access.role,
    },
  });
}

function requirePermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    throw makeError(403, accessDenied(permission).code, accessDenied(permission).message);
  }
}

function cleanPath(url) {
  const pathname = url.pathname.replace(/^\/api\/admin(?=\/|$)/u, '') || '/';
  return pathname.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean);
}

function queryWithSelect(defaultQuery, url) {
  const query = new URLSearchParams(defaultQuery);
  for (const [key, value] of url.searchParams.entries()) {
    query.set(key, value);
  }
  return query.toString();
}

function filterEq(column, value) {
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

async function listTable(config, actor, resource, table, url, defaultQuery) {
  requirePermission(actor, ROUTE_PERMISSIONS[resource]);
  return {
    items: await supabaseRest(config, table, {
      query: queryWithSelect(defaultQuery, url),
      prefer: '',
    }),
  };
}

async function getAccessRecord(config, userId) {
  const rows = await supabaseRest(config, ACCESS_TABLE, {
    query: `select=*&${filterEq('user_id', userId)}&limit=1`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function countOwners(config) {
  const rows = await supabaseRest(config, ACCESS_TABLE, {
    query: `select=user_id&${filterEq('role', 'owner')}`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows.length : 0;
}

async function updateAccessRecord(config, userId, patch) {
  const rows = await supabaseRest(config, ACCESS_TABLE, {
    method: 'PATCH',
    query: filterEq('user_id', userId),
    body: patch,
  });
  if (Array.isArray(rows) && rows.length > 0) return rows[0];

  const inserted = await supabaseRest(config, ACCESS_TABLE, {
    method: 'POST',
    query: 'on_conflict=user_id',
    body: { user_id: userId, ...patch },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return Array.isArray(inserted) ? inserted[0] : inserted;
}

async function auditMutation(config, actor, action, targetType, targetId, metadata = {}) {
  const rows = await supabaseRest(config, AUDIT_TABLE, {
    method: 'POST',
    body: {
      actor_user_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action,
      target_type: targetType,
      target_id: String(targetId || ''),
      metadata,
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function mutateUserPlan(config, actor, userId, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  const plan = normalizePlan(body.plan);
  const item = await updateAccessRecord(config, userId, {
    plan,
    plan_updated_at: new Date().toISOString(),
  });
  await auditMutation(config, actor, 'users.plan.update', 'user', userId, { plan });
  return { ok: true, item };
}

async function mutateUserStatus(config, actor, userId, body) {
  const status = normalizeStatus(body.status);
  const decision = canUpdateUserStatus({ actor, targetUserId: userId, nextStatus: status });
  if (!decision.ok) throw makeError(decision.status, decision.code, decision.message);

  const item = await updateAccessRecord(config, userId, {
    status,
    status_updated_at: new Date().toISOString(),
  });
  await auditMutation(config, actor, 'users.status.update', 'user', userId, { status });
  return { ok: true, item };
}

async function mutateUserOverride(config, actor, userId, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_OVERRIDE_UPDATE);
  const override = {
    override_reason: String(body.overrideReason || body.reason || '').trim(),
    override_until: body.overrideUntil || body.override_until || null,
    override_payload: body.overridePayload || body.override_payload || {},
  };
  const item = await updateAccessRecord(config, userId, override);
  await auditMutation(config, actor, 'users.override.update', 'user', userId, override);
  return { ok: true, item };
}

async function mutateUserAccess(config, actor, userId, body) {
  const current = await getAccessRecord(config, userId);
  const nextRole = normalizeRole(body.role);
  const decision = canUpdateUserRole({
    actor,
    targetUserId: userId,
    currentRole: current?.role || 'user',
    nextRole,
    ownerCount: await countOwners(config),
  });
  if (!decision.ok) throw makeError(decision.status, decision.code, decision.message);

  const item = await updateAccessRecord(config, userId, {
    role: nextRole,
    access_updated_at: new Date().toISOString(),
  });
  await auditMutation(config, actor, 'users.access.update', 'user', userId, { role: nextRole });
  return { ok: true, item };
}

async function mutateFeature(config, actor, resource, id, body) {
  const table = resource === 'features' ? FEATURE_TABLE : PLAN_FEATURE_TABLE;
  const permission = resource === 'features'
    ? ADMIN_PERMISSIONS.FEATURES_WRITE
    : ADMIN_PERMISSIONS.PLAN_FEATURES_WRITE;
  requirePermission(actor, permission);

  const item = id
    ? await supabaseRest(config, table, {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}`,
      body,
    })
    : await supabaseRest(config, table, {
      method: 'POST',
      body,
    });
  await auditMutation(config, actor, `${resource}.write`, resource, id || body.key || body.feature_key || '', body);
  return { ok: true, item: Array.isArray(item) ? item[0] : item };
}

async function mutateCatalog(config, actor, id, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);

  const patch = {
    ...body,
    updated_at: new Date().toISOString(),
  };
  const item = id
    ? await supabaseRest(config, CATALOG_TABLE, {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}`,
      body: patch,
    })
    : await supabaseRest(config, CATALOG_TABLE, {
      method: 'POST',
      body: patch,
    });

  await auditMutation(config, actor, 'catalog.write', 'catalog', id || body.key || '', patch);
  return { ok: true, item: Array.isArray(item) ? item[0] : item };
}

async function syncAuth(config, actor) {
  requirePermission(actor, ADMIN_PERMISSIONS.ADMIN_SYNC_AUTH);
  const payload = await authAdminFetch(config, '/admin/users?page=1&per_page=1000', { method: 'GET' });
  const users = Array.isArray(payload?.users) ? payload.users : [];
  const rows = users.map((user) => ({
    user_id: user.id,
    email: user.email || '',
    role: normalizeRole(user.app_metadata?.role || user.app_metadata?.storyforge_role || 'user'),
    status: user.banned_until ? 'suspended' : 'active',
    plan: normalizePlan(user.app_metadata?.plan || 'free'),
    last_seen_at: user.last_sign_in_at || null,
    auth_updated_at: user.updated_at || null,
  }));

  const items = rows.length > 0
    ? await supabaseRest(config, ACCESS_TABLE, {
      method: 'POST',
      query: 'on_conflict=user_id',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    : [];
  await auditMutation(config, actor, 'admin.sync_auth', 'auth', 'supabase', { count: rows.length });
  return { ok: true, count: rows.length, items };
}

async function routeRequest(request, config, actor) {
  const url = new URL(request.url);
  const [resource, id, action] = cleanPath(url);

  if (!resource) {
    return { ok: true, service: 'storyforge-admin-api', actor };
  }

  if (resource === 'me') {
    return { ok: true, actor };
  }

  if (resource === 'users' && request.method === 'GET') {
    return listTable(config, actor, resource, ACCESS_TABLE, url, 'select=*&order=updated_at.desc&limit=200');
  }

  if (resource === 'users' && id && request.method === 'PATCH') {
    const body = await readJson(request);
    if (action === 'plan') return mutateUserPlan(config, actor, id, body);
    if (action === 'status') return mutateUserStatus(config, actor, id, body);
    if (action === 'override') return mutateUserOverride(config, actor, id, body);
    if (action === 'access') return mutateUserAccess(config, actor, id, body);
  }

  if (resource === 'features') {
    if (request.method === 'GET') {
      return listTable(config, actor, resource, FEATURE_TABLE, url, 'select=*&order=category.asc,key.asc&limit=500');
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      return mutateFeature(config, actor, resource, id, await readJson(request));
    }
  }

  if (resource === 'plan-features') {
    if (request.method === 'GET') {
      return listTable(config, actor, resource, PLAN_FEATURE_TABLE, url, 'select=*&order=plan.asc,feature_key.asc&limit=500');
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      return mutateFeature(config, actor, resource, id, await readJson(request));
    }
  }

  if (resource === 'catalog') {
    if (request.method === 'GET') {
      return listTable(config, actor, resource, CATALOG_TABLE, url, 'select=*&order=sort_order.asc,key.asc&limit=100');
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      return mutateCatalog(config, actor, id, await readJson(request));
    }
  }

  if (resource === 'audit' && request.method === 'GET') {
    return listTable(config, actor, resource, AUDIT_TABLE, url, 'select=*&order=created_at.desc&limit=200');
  }

  if (resource === 'usage' && request.method === 'GET') {
    return listTable(config, actor, resource, USAGE_TABLE, url, 'select=*&order=updated_at.desc&limit=200');
  }

  if (resource === 'consent' && request.method === 'GET') {
    return listTable(config, actor, resource, CONSENT_TABLE, url, 'select=*&order=created_at.desc&limit=200');
  }

  if (resource === 'sync-auth' && request.method === 'POST') {
    return syncAuth(config, actor);
  }

  throw makeError(404, 'ADMIN_ROUTE_NOT_FOUND', 'Không tìm thấy route Admin API.');
}

async function handle(request, env = {}) {
  let config;
  try {
    config = validateEnv(env);
  } catch (error) {
    return json({ error: error.message, code: error.code || 'ADMIN_CONFIG_ERROR' }, error.status || 500);
  }

  const cors = corsHeaders(request, config);

  if (!isOriginAllowed(request, config)) {
    return json({ error: 'Origin không được phép truy cập Admin API.', code: 'ADMIN_ORIGIN_NOT_ALLOWED' }, 403, cors);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (new URL(request.url).pathname.replace(/^\/api\/admin/u, '') === '/health') {
    return json({ ok: true, service: 'storyforge-admin-api' }, 200, cors);
  }

  try {
    const actor = await authenticate(request, config);
    const payload = await routeRequest(request, config, actor);
    return json(payload, 200, cors);
  } catch (error) {
    return json({
      error: error.message || 'Admin API gặp lỗi ngoài dự kiến.',
      code: error.code || 'ADMIN_UNEXPECTED_ERROR',
    }, error.status || 500, cors);
  }
}

export default {
  fetch: handle,
};
