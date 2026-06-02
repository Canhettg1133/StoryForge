import {
  ACCESS_FEATURES,
  ADMIN_PERMISSIONS,
  PLAN_STATUSES,
  SYSTEM_ROLES,
  USER_STATUSES,
  accessDenied,
  canUpdateUserRole,
  canUpdateUserStatus,
  hasPermission,
  normalizePlan,
  normalizeRole,
  normalizeStatus,
  resolveAccessSubject,
  resolveUserAccess,
} from '../../../packages/access/src/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const PROFILES_TABLE = 'profiles';
const PLANS_TABLE = 'plans';
const USER_PLANS_TABLE = 'user_plans';
const FEATURES_TABLE = 'features';
const PLAN_FEATURES_TABLE = 'plan_features';
const OVERRIDES_TABLE = 'user_entitlement_overrides';
const CONSENT_TABLE = 'consent_versions';
const AUDIT_TABLE = 'admin_audit_logs';
const USAGE_TABLE = 'usage_events';
const ACCESS_VERSIONS_TABLE = 'access_versions';

const ROUTE_PERMISSIONS = {
  users: ADMIN_PERMISSIONS.USERS_READ,
  catalog: ADMIN_PERMISSIONS.CATALOG_READ,
  audit: ADMIN_PERMISSIONS.AUDIT_READ,
  usage: ADMIN_PERMISSIONS.USAGE_READ,
  features: ADMIN_PERMISSIONS.FEATURES_READ,
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
      ...(prefer ? { Prefer: prefer } : {}),
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

function filterEq(column, value) {
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

function filterIsNull(column) {
  return `${column}=is.null`;
}

function queryWithSelect(defaultQuery, url) {
  const query = new URLSearchParams(defaultQuery);
  for (const [key, value] of url.searchParams.entries()) {
    query.set(key, value);
  }
  return query.toString();
}

function cleanPath(url) {
  const pathname = url.pathname.replace(/^\/api\/admin(?=\/|$)/u, '') || '/';
  return pathname.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean);
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isFuture(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
}

function normalizeFeatureKey(value) {
  return String(value || '').trim();
}

function resolvePlanStatus(body = {}) {
  const explicit = String(body.status || '').trim().toLowerCase();
  if (Object.values(PLAN_STATUSES).includes(explicit)) return explicit;
  return isFuture(body.startsAt || body.starts_at) ? PLAN_STATUSES.SCHEDULED : PLAN_STATUSES.ACTIVE;
}

function buildActorFromProfile(authUser, profile) {
  return resolveAccessSubject({
    id: authUser.id,
    email: profile.email || authUser.email,
    role: profile.system_role,
  });
}

async function getProfile(config, userId) {
  const rows = await supabaseRest(config, PROFILES_TABLE, {
    query: `select=*&${filterEq('user_id', userId)}&limit=1`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertProfileFromAuth(config, authUser) {
  const subject = resolveAccessSubject(authUser);
  const rows = await supabaseRest(config, PROFILES_TABLE, {
    method: 'POST',
    query: 'on_conflict=user_id',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: authUser.id,
      email: authUser.email || '',
      display_name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || authUser.email || '',
      system_role: subject.role,
      status: USER_STATUSES.ACTIVE,
      metadata: {
        auth_created_at: authUser.created_at || null,
        auth_updated_at: authUser.updated_at || null,
        last_sign_in_at: authUser.last_sign_in_at || null,
      },
    },
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
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
  const authUser = await readSupabaseJson(response);
  if (!response.ok || !authUser?.id) {
    throw makeError(401, 'ADMIN_AUTH_INVALID', 'Phiên đăng nhập admin không hợp lệ.');
  }

  let profile = await getProfile(config, authUser.id);
  if (!profile) profile = await insertProfileFromAuth(config, authUser);
  if (!profile) {
    throw makeError(403, 'ADMIN_PROFILE_MISSING', 'Không tìm thấy hồ sơ quyền của tài khoản admin.');
  }
  if ([USER_STATUSES.BANNED, USER_STATUSES.DELETED].includes(normalizeStatus(profile.status))) {
    throw makeError(403, 'ADMIN_ACCOUNT_INACTIVE', 'Tài khoản admin đang bị khóa.');
  }

  const decision = resolveUserAccess({
    authenticated: true,
    profile,
    features: [],
    userPlans: [],
    planFeatures: [],
    overrides: [],
  }).admin;
  if (!decision.allowed && normalizeRole(profile.system_role) === SYSTEM_ROLES.USER) {
    throw makeError(403, 'ADMIN_PERMISSION_DENIED', 'Bạn không có quyền truy cập Admin API.');
  }

  return {
    ...buildActorFromProfile(authUser, profile),
    profile,
  };
}

function requirePermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    const denied = accessDenied(permission);
    throw makeError(denied.status, denied.code, denied.message);
  }
}

async function auditMutation(config, request, actor, action, {
  targetUserId = null,
  targetFeatureKey = null,
  before = {},
  after = {},
} = {}) {
  const rows = await supabaseRest(config, AUDIT_TABLE, {
    method: 'POST',
    body: {
      actor_user_id: actor.id,
      action,
      target_user_id: targetUserId,
      target_feature_key: targetFeatureKey,
      before_json: before || {},
      after_json: after || {},
      ip_address: getClientIp(request),
      user_agent: request.headers.get('User-Agent') || '',
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
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

async function findPlanByKey(config, planKeyInput) {
  const planKey = normalizePlan(planKeyInput);
  const rows = await supabaseRest(config, PLANS_TABLE, {
    query: `select=*&${filterEq('key', planKey)}&limit=1`,
    prefer: '',
  });
  const plan = Array.isArray(rows) ? rows[0] || null : null;
  if (!plan) {
    throw makeError(404, 'ADMIN_PLAN_NOT_FOUND', `Không tìm thấy gói ${planKey}.`);
  }
  return plan;
}

async function countOwners(config) {
  const rows = await supabaseRest(config, PROFILES_TABLE, {
    query: `select=user_id&${filterEq('system_role', SYSTEM_ROLES.OWNER)}`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows.length : 0;
}

function getCurrentPlanKey(user) {
  const now = Date.now();
  const plans = Array.isArray(user?.user_plans) ? user.user_plans : [];
  return plans
    .filter((item) => item.status === PLAN_STATUSES.ACTIVE)
    .filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now)
    .sort((left, right) => new Date(right.starts_at || right.created_at || 0) - new Date(left.starts_at || left.created_at || 0))[0]
    ?.plans?.key || 'free';
}

async function listUsers(config, actor, url) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_READ);
  const query = queryWithSelect('select=*,user_plans(*,plans(*))&order=updated_at.desc&limit=200', url);
  const rows = await supabaseRest(config, PROFILES_TABLE, { query, prefer: '' });
  const items = Array.isArray(rows)
    ? rows.map((row) => ({
      ...row,
      id: row.user_id,
      role: row.system_role,
      plan: getCurrentPlanKey(row),
      last_seen_at: row.metadata?.last_sign_in_at || null,
      auth_updated_at: row.metadata?.auth_updated_at || null,
    }))
    : [];
  return { items, users: items };
}

async function buildAccessData(config, userId) {
  const [profile, userPlans, features, planFeatures, overrides, consentVersions, accessVersions] = await Promise.all([
    getProfile(config, userId),
    supabaseRest(config, USER_PLANS_TABLE, {
      query: `select=*,plans(key,name)&${filterEq('user_id', userId)}&order=starts_at.desc`,
      prefer: '',
    }),
    supabaseRest(config, FEATURES_TABLE, {
      query: 'select=*&order=category.asc,key.asc',
      prefer: '',
    }),
    supabaseRest(config, PLAN_FEATURES_TABLE, {
      query: 'select=*,plans(key,name)&order=feature_key.asc',
      prefer: '',
    }),
    supabaseRest(config, OVERRIDES_TABLE, {
      query: `select=*&${filterEq('user_id', userId)}&order=created_at.desc`,
      prefer: '',
    }),
    supabaseRest(config, CONSENT_TABLE, {
      query: 'select=*&order=effective_at.desc',
      prefer: '',
    }),
    supabaseRest(config, ACCESS_VERSIONS_TABLE, {
      query: `select=version&${filterEq('user_id', userId)}&limit=1`,
      prefer: '',
    }),
  ]);

  if (!profile) {
    throw makeError(404, 'ADMIN_USER_NOT_FOUND', 'Không tìm thấy người dùng.');
  }

  return {
    authenticated: true,
    profile,
    userPlans: Array.isArray(userPlans) ? userPlans : [],
    features: Array.isArray(features) ? features : [],
    planFeatures: Array.isArray(planFeatures) ? planFeatures : [],
    overrides: Array.isArray(overrides) ? overrides : [],
    consentVersions: Array.isArray(consentVersions) ? consentVersions : [],
    accessVersion: Array.isArray(accessVersions) ? accessVersions[0]?.version || 1 : 1,
    now: new Date().toISOString(),
  };
}

async function getUserAccess(config, actor, userId) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_READ);
  const accessData = await buildAccessData(config, userId);
  return {
    access: resolveUserAccess(accessData, Object.values(ACCESS_FEATURES)),
    raw: {
      profile: accessData.profile,
      userPlans: accessData.userPlans,
      overrides: accessData.overrides,
    },
  };
}

async function mutateUserPlan(config, request, actor, userId, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  const operation = String(body.operation || 'set').trim().toLowerCase();

  if (operation === 'set') {
    const plan = await findPlanByKey(config, body.planKey || body.plan || 'vip');
    const startsAt = toIsoOrNull(body.startsAt || body.starts_at) || new Date().toISOString();
    const item = {
      user_id: userId,
      plan_id: plan.id,
      status: resolvePlanStatus(body),
      starts_at: startsAt,
      expires_at: toIsoOrNull(body.expiresAt || body.expires_at),
      source: 'manual',
      granted_by: actor.id,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };
    const rows = await supabaseRest(config, USER_PLANS_TABLE, {
      method: 'POST',
      body: item,
    });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    await auditMutation(config, request, actor, 'users.plan.set', {
      targetUserId: userId,
      after: saved || item,
    });
    return { ok: true, item: saved };
  }

  if (operation === 'cancel_current' || operation === 'cancel_scheduled') {
    const status = operation === 'cancel_current' ? PLAN_STATUSES.ACTIVE : PLAN_STATUSES.SCHEDULED;
    const rows = await supabaseRest(config, USER_PLANS_TABLE, {
      method: 'PATCH',
      query: `${filterEq('user_id', userId)}&${filterEq('status', status)}`,
      body: {
        status: PLAN_STATUSES.CANCELLED,
        metadata: {
          cancelled_by: actor.id,
          cancelled_at: new Date().toISOString(),
          cancel_operation: operation,
        },
      },
    });
    await auditMutation(config, request, actor, `users.plan.${operation}`, {
      targetUserId: userId,
      after: { operation, count: Array.isArray(rows) ? rows.length : 0 },
    });
    return { ok: true, items: Array.isArray(rows) ? rows : [] };
  }

  throw makeError(400, 'ADMIN_PLAN_OPERATION_INVALID', 'Thao tác gói không hợp lệ.');
}

async function mutateUserStatus(config, request, actor, userId, body) {
  const status = normalizeStatus(body.status);
  const decision = canUpdateUserStatus({ actor, targetUserId: userId, nextStatus: status });
  if (!decision.ok) throw makeError(decision.status, decision.code, decision.message);

  const rows = await supabaseRest(config, PROFILES_TABLE, {
    method: 'PATCH',
    query: filterEq('user_id', userId),
    body: { status },
  });
  const item = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'users.status.update', {
    targetUserId: userId,
    after: { status },
  });
  return { ok: true, item };
}

async function mutateUserRole(config, request, actor, userId, body) {
  const current = await getProfile(config, userId);
  const nextRole = normalizeRole(body.role || body.systemRole || body.system_role);
  const decision = canUpdateUserRole({
    actor,
    targetUserId: userId,
    currentRole: current?.system_role || SYSTEM_ROLES.USER,
    nextRole,
    ownerCount: await countOwners(config),
  });
  if (!decision.ok) throw makeError(decision.status, decision.code, decision.message);

  const rows = await supabaseRest(config, PROFILES_TABLE, {
    method: 'PATCH',
    query: filterEq('user_id', userId),
    body: { system_role: nextRole },
  });
  const item = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'users.role.update', {
    targetUserId: userId,
    before: current || {},
    after: { system_role: nextRole },
  });
  return { ok: true, item };
}

async function mutateUserFeatureOverride(config, request, actor, userId, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_OVERRIDE_UPDATE);
  const operation = String(body.operation || 'set').trim().toLowerCase();
  const featureKey = normalizeFeatureKey(body.featureKey || body.feature_key);
  if (!featureKey) {
    throw makeError(400, 'ADMIN_FEATURE_KEY_REQUIRED', 'Thiếu mã tính năng.');
  }

  if (operation === 'revoke') {
    const query = body.overrideId || body.id
      ? `id=eq.${encodeURIComponent(body.overrideId || body.id)}`
      : `${filterEq('user_id', userId)}&${filterEq('feature_key', featureKey)}&${filterIsNull('revoked_at')}`;
    const rows = await supabaseRest(config, OVERRIDES_TABLE, {
      method: 'PATCH',
      query,
      body: { revoked_at: new Date().toISOString() },
    });
    await auditMutation(config, request, actor, 'users.feature_override.revoke', {
      targetUserId: userId,
      targetFeatureKey: featureKey,
      after: { count: Array.isArray(rows) ? rows.length : 0 },
    });
    return { ok: true, items: Array.isArray(rows) ? rows : [] };
  }

  const item = {
    user_id: userId,
    feature_key: featureKey,
    enabled: normalizeBoolean(body.enabled, true),
    reason: String(body.reason || '').trim(),
    limit_json: body.limitJson || body.limit_json || {},
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    expires_at: toIsoOrNull(body.expiresAt || body.expires_at),
    granted_by: actor.id,
  };
  const rows = await supabaseRest(config, OVERRIDES_TABLE, {
    method: 'POST',
    body: item,
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'users.feature_override.set', {
    targetUserId: userId,
    targetFeatureKey: featureKey,
    after: saved || item,
  });
  return { ok: true, item: saved };
}

async function getCatalog(config, actor) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_READ);
  const [plans, features, planFeatures, consentVersions] = await Promise.all([
    supabaseRest(config, PLANS_TABLE, { query: 'select=*&order=sort_order.asc,key.asc', prefer: '' }),
    supabaseRest(config, FEATURES_TABLE, { query: 'select=*&order=category.asc,key.asc', prefer: '' }),
    supabaseRest(config, PLAN_FEATURES_TABLE, { query: 'select=*,plans(key,name)&order=feature_key.asc', prefer: '' }),
    supabaseRest(config, CONSENT_TABLE, { query: 'select=*&order=effective_at.desc', prefer: '' }),
  ]);
  return {
    items: Array.isArray(plans) ? plans : [],
    plans: Array.isArray(plans) ? plans : [],
    features: Array.isArray(features) ? features : [],
    planFeatures: Array.isArray(planFeatures) ? planFeatures : [],
    consentVersions: Array.isArray(consentVersions) ? consentVersions : [],
  };
}

async function mutateCatalogPlan(config, request, actor, id, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const patch = {
    ...(body.name !== undefined ? { name: String(body.name) } : {}),
    ...(body.description !== undefined ? { description: String(body.description) } : {}),
    ...(body.active !== undefined || body.enabled !== undefined ? { active: normalizeBoolean(body.active ?? body.enabled, true) } : {}),
    ...(body.sortOrder !== undefined || body.sort_order !== undefined ? { sort_order: Number(body.sortOrder ?? body.sort_order) || 100 } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata || {} } : {}),
  };
  const rows = await supabaseRest(config, PLANS_TABLE, {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(id)}`,
    body: patch,
  });
  const item = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'plans.update', {
    after: item || patch,
  });
  return { ok: true, item };
}

async function mutateFeature(config, request, actor, featureKey, body, method) {
  const isCreate = method === 'POST' && !featureKey;
  requirePermission(actor, ADMIN_PERMISSIONS.FEATURES_WRITE);
  const key = normalizeFeatureKey(featureKey || body.key);
  if (!key) throw makeError(400, 'ADMIN_FEATURE_KEY_REQUIRED', 'Thiếu mã tính năng.');

  const patch = {
    key,
    name: String(body.name || key),
    description: String(body.description || ''),
    category: String(body.category || 'general'),
    active: normalizeBoolean(body.active ?? body.enabled, true),
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };

  const rows = await supabaseRest(config, FEATURES_TABLE, {
    method: isCreate ? 'POST' : 'PATCH',
    query: isCreate ? '' : filterEq('key', key),
    body: isCreate ? patch : {
      name: patch.name,
      description: patch.description,
      category: patch.category,
      active: patch.active,
      metadata: patch.metadata,
    },
  });
  const item = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, isCreate ? 'features.create' : 'features.update', {
    targetFeatureKey: key,
    after: item || patch,
  });
  return { ok: true, item };
}

async function mutatePlanFeature(config, request, actor, featureKeyInput, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.PLAN_FEATURES_WRITE);
  const featureKey = normalizeFeatureKey(featureKeyInput || body.featureKey || body.feature_key);
  const plan = await findPlanByKey(config, body.planKey || body.plan || 'vip');
  const item = {
    plan_id: plan.id,
    feature_key: featureKey,
    enabled: normalizeBoolean(body.enabled, true),
    limit_json: body.limitJson || body.limit_json || {},
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
  const rows = await supabaseRest(config, PLAN_FEATURES_TABLE, {
    method: 'POST',
    query: 'on_conflict=plan_id,feature_key',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: item,
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'plan_features.upsert', {
    targetFeatureKey: featureKey,
    after: saved || item,
  });
  return { ok: true, item: saved };
}

async function mutateConsent(config, request, actor, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.CONSENT_WRITE);
  const item = {
    key: String(body.key || 'adult_terms').trim(),
    version: String(body.version || '').trim(),
    title: String(body.title || 'Điều khoản 18+').trim(),
    body: String(body.body || ''),
    active: normalizeBoolean(body.active, true),
    effective_at: toIsoOrNull(body.effectiveAt || body.effective_at) || new Date().toISOString(),
    created_by: actor.id,
  };
  if (!item.version) throw makeError(400, 'ADMIN_CONSENT_VERSION_REQUIRED', 'Thiếu phiên bản điều khoản.');
  const rows = await supabaseRest(config, CONSENT_TABLE, {
    method: 'POST',
    body: item,
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'consent.create', {
    after: saved || item,
  });
  return { ok: true, item: saved };
}

async function syncAuth(config, request, actor) {
  requirePermission(actor, ADMIN_PERMISSIONS.ADMIN_SYNC_AUTH);
  const payload = await authAdminFetch(config, '/admin/users?page=1&per_page=1000', { method: 'GET' });
  const users = Array.isArray(payload?.users) ? payload.users : [];
  const rows = users.map((user) => {
    const subject = resolveAccessSubject(user);
    return {
      user_id: user.id,
      email: user.email || '',
      display_name: user.user_metadata?.name || user.user_metadata?.full_name || user.email || '',
      system_role: subject.role,
      status: user.banned_until ? USER_STATUSES.BANNED : USER_STATUSES.ACTIVE,
      metadata: {
        auth_created_at: user.created_at || null,
        auth_updated_at: user.updated_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
      },
    };
  });

  const items = rows.length > 0
    ? await supabaseRest(config, PROFILES_TABLE, {
      method: 'POST',
      query: 'on_conflict=user_id',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    : [];
  await auditMutation(config, request, actor, 'users.sync_auth', {
    after: { count: rows.length },
  });
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

  if (resource === 'users' && id === 'sync-auth' && request.method === 'POST') {
    return syncAuth(config, request, actor);
  }

  if (resource === 'users' && request.method === 'GET' && !id) {
    return listUsers(config, actor, url);
  }

  if (resource === 'users' && id && action === 'access') {
    if (request.method === 'GET') return getUserAccess(config, actor, id);
    if (request.method === 'PATCH' || request.method === 'POST') {
      return mutateUserRole(config, request, actor, id, await readJson(request));
    }
  }

  if (resource === 'users' && id && action === 'plan' && request.method === 'POST') {
    return mutateUserPlan(config, request, actor, id, await readJson(request));
  }

  if (resource === 'users' && id && action === 'feature-override' && request.method === 'POST') {
    return mutateUserFeatureOverride(config, request, actor, id, await readJson(request));
  }

  if (resource === 'users' && id && action === 'status' && request.method === 'POST') {
    return mutateUserStatus(config, request, actor, id, await readJson(request));
  }

  if (resource === 'catalog') {
    if (request.method === 'GET' && !id) return getCatalog(config, actor);
    if ((request.method === 'PATCH' || request.method === 'POST') && id) {
      return mutateCatalogPlan(config, request, actor, id, await readJson(request));
    }
  }

  if (resource === 'features') {
    if (request.method === 'GET' && !id) {
      return listTable(config, actor, resource, FEATURES_TABLE, url, 'select=*&order=category.asc,key.asc&limit=500');
    }
    if (id && action === 'plan' && request.method === 'POST') {
      return mutatePlanFeature(config, request, actor, id, await readJson(request));
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      return mutateFeature(config, request, actor, id, await readJson(request), request.method);
    }
  }

  if (resource === 'consent') {
    if (request.method === 'GET') {
      return listTable(config, actor, resource, CONSENT_TABLE, url, 'select=*&order=effective_at.desc&limit=200');
    }
    if (request.method === 'POST') return mutateConsent(config, request, actor, await readJson(request));
  }

  if (resource === 'audit' && request.method === 'GET') {
    return listTable(config, actor, resource, AUDIT_TABLE, url, 'select=*&order=created_at.desc&limit=200');
  }

  if (resource === 'usage' && request.method === 'GET') {
    return listTable(config, actor, resource, USAGE_TABLE, url, 'select=*&order=created_at.desc&limit=200');
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
