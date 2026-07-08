import {
  ACCESS_FEATURES,
  ADMIN_PERMISSIONS,
  FEATURE_LABELS_VI,
  PLAN_LABELS_VI,
  PLAN_STATUSES,
  ROLE_LABELS_VI,
  SYSTEM_ROLES,
  STATUS_LABELS_VI,
  USER_STATUSES,
  accessDenied,
  canUpdateUserRole,
  canUpdateUserStatus,
  hasPermission,
  normalizePlan,
  normalizeRole,
  normalizeSiteAnnouncement,
  normalizeStatus,
  normalizeVipPageContent,
  roleRank,
  resolveAccessSubject,
  resolveUserAccess,
  hasSiteAnnouncementContentChanged,
  SITE_ANNOUNCEMENT_KEY,
  toPublicSiteAnnouncement,
} from '../../../packages/access/src/index.js';
import { routeStoryMirrorAdmin } from './storyMirror/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
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
const SITE_SETTINGS_TABLE = 'site_settings';
const DEFAULT_USAGE_PAGE_SIZE = 100;
const MAX_USAGE_PAGE_SIZE = 200;
const MAX_USAGE_OFFSET_WITHOUT_CURSOR = 10000;
const DEFAULT_USAGE_RANKING_LIMIT = 20;
const MAX_USAGE_RANKING_LIMIT = 50;
const DEFAULT_USAGE_RANKING_RANGE = '30d';
const USAGE_RANKING_CACHE_TTL_MS = 60_000;
const USAGE_RANKING_CACHE_MAX_ENTRIES = 100;
const ACTOR_CACHE_TTL_MS = 60_000;
const RESPONSE_HEADERS = Symbol('responseHeaders');
const usageRankingCache = new Map();
const usageRankingInflight = new Map();
const actorCache = new Map();
let actorCacheFetchRef = null;
const PROFILE_SELECT = 'user_id,email,display_name,system_role,status,metadata,created_at,updated_at';
const PLAN_SELECT = 'id,key,name,description,active,sort_order,metadata,created_at,updated_at';
const FEATURE_SELECT = 'key,name,description,category,active,metadata,created_at,updated_at';
const PLAN_FEATURE_SELECT = 'id,plan_id,feature_key,enabled,limit_json,created_at,updated_at,plans(key,name)';
const USER_PLAN_SELECT = 'id,user_id,plan_id,status,starts_at,expires_at,created_at,updated_at,plans(key,name)';
const OVERRIDE_SELECT = 'id,user_id,feature_key,enabled,reason,limit_json,metadata,expires_at,revoked_at,granted_by,created_at,updated_at';
const CONSENT_SELECT = 'id,key,version,title,body,active,effective_at,created_at';
const USAGE_SELECT = 'id,request_id,user_id,feature_key,provider,model,event_type,count,status,metadata,created_at';
const OVERVIEW_PROFILE_SELECT = 'user_id,email,display_name,system_role,status,updated_at,created_at';

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

function envFlagEnabled(env, name, fallback = true) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).trim().toLowerCase() !== 'false';
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
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    Vary: 'Origin',
  };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(payload, status = 200, cors = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, ...SECURITY_HEADERS, ...extraHeaders, ...JSON_HEADERS },
  });
}

function withResponseHeaders(payload, headers = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  return Object.assign(payload, { [RESPONSE_HEADERS]: headers });
}

function getResponseHeaders(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload[RESPONSE_HEADERS] || {};
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

function resetActorCacheIfFetchChanged() {
  if (actorCacheFetchRef === globalThis.fetch) return;
  actorCache.clear();
  actorCacheFetchRef = globalThis.fetch;
}

function getActorCacheKey(token) {
  const value = String(token || '');
  return `${value.length}:${value.slice(0, 12)}:${value.slice(-12)}`;
}

function getCachedActor(token) {
  resetActorCacheIfFetchChanged();
  const entry = actorCache.get(getActorCacheKey(token));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    actorCache.delete(getActorCacheKey(token));
    return null;
  }
  return {
    ...entry.actor,
    profile: { ...(entry.actor.profile || {}) },
  };
}

function setCachedActor(token, actor) {
  resetActorCacheIfFetchChanged();
  const cacheKey = getActorCacheKey(token);
  actorCache.set(cacheKey, {
    expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
    actor: {
      ...actor,
      profile: { ...(actor.profile || {}) },
    },
  });
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

function toVietnameseAdminErrorMessage(payload, fallback = 'Supabase trả về lỗi.') {
  const rawMessage = String(
    (typeof payload === 'string' ? payload : '')
    || payload?.message
    || payload?.error
    || payload?.msg
    || fallback
    || '',
  ).trim();
  if (!rawMessage) return fallback;

  if (/column\s+.+\s+does not exist/iu.test(rawMessage)) {
    return 'Cấu trúc dữ liệu Admin chưa khớp với API hiện tại. Hãy kiểm tra migration Supabase rồi tải lại.';
  }
  if (/relation\s+.+\s+does not exist/iu.test(rawMessage)) {
    return 'Cấu trúc dữ liệu Admin còn thiếu bảng cần thiết. Hãy kiểm tra migration Supabase rồi tải lại.';
  }
  if (/duplicate key value violates unique constraint/iu.test(rawMessage)) {
    return 'Dữ liệu bị trùng với ràng buộc hiện có. Hãy kiểm tra bản ghi rồi thử lại.';
  }
  if (/permission denied/iu.test(rawMessage)) {
    return 'Admin API không có quyền thực hiện truy vấn này.';
  }
  return rawMessage;
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
  query = '',
  body,
  prefer = 'return=representation',
} = {}) {
  const { payload } = await supabaseRestResult(config, table, {
    method,
    query,
    body,
    prefer,
  });
  return payload;
}

async function supabaseRestResult(config, table, {
  method = 'GET',
  query = '',
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
    throw makeError(
      response.status || 500,
      'ADMIN_SUPABASE_REST_FAILED',
      toVietnameseAdminErrorMessage(payload, 'Supabase REST trả về lỗi.'),
    );
  }
  return { payload, headers: response.headers };
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
    throw makeError(
      response.status || 500,
      'ADMIN_SUPABASE_AUTH_FAILED',
      toVietnameseAdminErrorMessage(payload, 'Supabase Auth trả về lỗi.'),
    );
  }
  return payload;
}

function filterEq(column, value) {
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

function filterIn(column, values) {
  return `${column}=in.(${values.map((value) => encodeURIComponent(String(value))).join(',')})`;
}

function filterIsNull(column) {
  return `${column}=is.null`;
}

function toBoundedInteger(value, fallback, { min = 1, max = 200 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getPaginationFromUrl(url, { defaultPageSize = DEFAULT_USAGE_PAGE_SIZE, maxPageSize = MAX_USAGE_PAGE_SIZE } = {}) {
  const pageSize = toBoundedInteger(url.searchParams.get('pageSize'), defaultPageSize, {
    min: 1,
    max: maxPageSize,
  });
  const page = toBoundedInteger(url.searchParams.get('page'), 1, {
    min: 1,
    max: 1000000,
  });
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

function normalizeUsageSearch(value) {
  const raw = String(value || '').trim();
  if (raw.length < 3 && !looksLikeUuid(raw)) return '';
  return raw
    .replace(/[*,(){}]/gu, ' ')
    .replace(/\s+/gu, '*')
    .slice(0, 80);
}

function normalizeUsageFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return '';
  return normalized.replace(/[^a-z0-9_.-]/gu, '').slice(0, 80);
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(String(value || '').trim());
}

function encodeUsageCursor(row) {
  if (!row?.created_at || !row?.id) return '';
  const payload = JSON.stringify({ createdAt: row.created_at, id: row.id });
  return btoa(payload).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeUsageCursor(value) {
  if (!value) return null;
  try {
    const padded = String(value).replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    if (!payload?.createdAt || !payload?.id) return null;
    return {
      createdAt: String(payload.createdAt),
      id: String(payload.id),
    };
  } catch {
    throw makeError(400, 'ADMIN_USAGE_CURSOR_INVALID', 'Cursor hoạt động người dùng không hợp lệ.');
  }
}

function parseContentRangeTotal(headers, fallback) {
  const contentRange = headers?.get?.('content-range') || headers?.get?.('Content-Range') || '';
  const match = String(contentRange).match(/\/(\d+|\*)$/u);
  if (!match || match[1] === '*') return fallback;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : fallback;
}

const USAGE_RANKING_RANGES = new Set(['24h', '7d', '30d', '90d', 'this_month', 'last_month', 'all', 'custom']);
const USAGE_RANKING_TASKS = new Set(['all', 'writing', 'translation', 'story_chat', 'free_chat', 'planning', 'analysis', 'image_generation']);
const USAGE_RANKING_PLANS = new Set(['vip_lifetime', 'vip', 'lifetime']);
const USAGE_RANKING_LIMITS = new Set([10, 20, 50]);

function normalizeUsageRankingChoice(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeUsageRankingSearch(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, 120);
}

function normalizeUsageRankingLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_USAGE_RANKING_LIMIT;
  if (parsed > MAX_USAGE_RANKING_LIMIT) return MAX_USAGE_RANKING_LIMIT;
  return USAGE_RANKING_LIMITS.has(parsed) ? parsed : DEFAULT_USAGE_RANKING_LIMIT;
}

function parseRankingDateBound(value, { exclusiveEnd = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (exclusiveEnd && /^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

function getUsageRankingWindow(range, url, now = new Date()) {
  const normalizedRange = normalizeUsageRankingChoice(range, USAGE_RANKING_RANGES, DEFAULT_USAGE_RANKING_RANGE);
  if (normalizedRange === 'all') return { range: normalizedRange, from: null, to: null };
  if (normalizedRange === 'custom') {
    return {
      range: normalizedRange,
      from: parseRankingDateBound(url.searchParams.get('from')),
      to: parseRankingDateBound(url.searchParams.get('to'), { exclusiveEnd: true }),
    };
  }

  const fromDate = new Date(now);
  let toDate = null;
  if (normalizedRange === '24h') fromDate.setUTCHours(fromDate.getUTCHours() - 24);
  if (normalizedRange === '7d') fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  if (normalizedRange === '30d') fromDate.setUTCDate(fromDate.getUTCDate() - 30);
  if (normalizedRange === '90d') fromDate.setUTCDate(fromDate.getUTCDate() - 90);
  if (normalizedRange === 'this_month') {
    fromDate.setUTCDate(1);
    fromDate.setUTCHours(0, 0, 0, 0);
  }
  if (normalizedRange === 'last_month') {
    fromDate.setUTCDate(1);
    fromDate.setUTCHours(0, 0, 0, 0);
    toDate = new Date(fromDate);
    fromDate.setUTCMonth(fromDate.getUTCMonth() - 1);
  }

  return {
    range: normalizedRange,
    from: fromDate.toISOString(),
    to: toDate ? toDate.toISOString() : null,
  };
}

function normalizeUsageRankingParams(url) {
  const window = getUsageRankingWindow(url.searchParams.get('range'), url);
  return {
    ...window,
    task: normalizeUsageRankingChoice(url.searchParams.get('task'), USAGE_RANKING_TASKS, 'all'),
    plan: normalizeUsageRankingChoice(url.searchParams.get('plan'), USAGE_RANKING_PLANS, 'vip_lifetime'),
    provider: normalizeUsageFilter(url.searchParams.get('provider')),
    status: normalizeUsageFilter(url.searchParams.get('status')),
    q: normalizeUsageRankingSearch(url.searchParams.get('q')),
    limit: normalizeUsageRankingLimit(url.searchParams.get('limit')),
  };
}

function toSafeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanPath(url) {
  const pathname = url.pathname.replace(/^\/api\/admin(?=\/|$)/u, '') || '/';
  return pathname.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean);
}

function shouldCacheActorForRequest(request) {
  return request.method === 'GET';
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

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getRoleLabel(role) {
  return ROLE_LABELS_VI[normalizeRole(role)] || ROLE_LABELS_VI[SYSTEM_ROLES.USER];
}

function getStatusLabel(status) {
  return STATUS_LABELS_VI[normalizeStatus(status)] || String(status || USER_STATUSES.ACTIVE);
}

function getPlanLabel(planKey) {
  const key = normalizePlan(planKey);
  return PLAN_LABELS_VI[key] || key;
}

function getPlanKeyFromChange(value) {
  const source = asObject(value);
  return source.planKey || source.plan_key || source.plan || source.plans?.key || '';
}

function getPlanLabelFromChange(value) {
  const source = asObject(value);
  const key = getPlanKeyFromChange(source);
  if (key) return getPlanLabel(key);
  return String(source.planName || source.plan_name || source.plans?.name || '').trim();
}

function getFeatureLabel(featureKey) {
  const key = normalizeFeatureKey(featureKey);
  return FEATURE_LABELS_VI[key] || key || 'Hệ thống';
}

function formatAuditDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function normalizeIdentitySnapshot(value = {}, fallbackId = '') {
  const source = asObject(value);
  const id = String(source.id || source.user_id || fallbackId || '').trim();
  const email = String(source.email || '').trim();
  const displayName = String(source.displayName || source.display_name || source.name || '').trim();
  const role = source.role || source.system_role ? normalizeRole(source.role || source.system_role) : '';
  const status = source.status ? normalizeStatus(source.status) : '';

  return {
    id,
    email,
    displayName,
    role,
    status,
    label: email || displayName || id || 'Hệ thống',
    roleLabel: role ? getRoleLabel(role) : '',
    statusLabel: status ? getStatusLabel(status) : '',
  };
}

function profileToSnapshot(profile, fallbackId = '') {
  const snapshot = normalizeIdentitySnapshot(profile || {}, fallbackId);
  if (!snapshot.id && !snapshot.email && !snapshot.displayName) return {};
  return snapshot;
}

function actorToSnapshot(actor) {
  return profileToSnapshot({
    ...(actor?.profile || {}),
    id: actor?.id || actor?.profile?.user_id,
    email: actor?.email || actor?.profile?.email,
    role: actor?.role || actor?.profile?.system_role,
    status: actor?.profile?.status || USER_STATUSES.ACTIVE,
  }, actor?.id);
}

async function getProfileForSnapshot(config, userId) {
  if (!userId) return null;
  try {
    return await getProfile(config, userId);
  } catch {
    return null;
  }
}

function getAuditActionSummary(action, before = {}, after = {}, targetFeatureKey = '') {
  const afterObject = asObject(after);
  const beforeObject = asObject(before);
  switch (action) {
    case 'users.plan.set':
      return `Cấp gói${getPlanLabelFromChange(afterObject) ? ` ${getPlanLabelFromChange(afterObject)}` : ''}`;
    case 'users.plan.cancel_current':
      return 'Hủy gói hiện tại';
    case 'users.plan.cancel_scheduled':
      return 'Hủy gói đã đặt lịch';
    case 'users.status.update':
      if (normalizeStatus(afterObject.status) === USER_STATUSES.BANNED) return 'Khóa tài khoản';
      if (normalizeStatus(afterObject.status) === USER_STATUSES.ACTIVE) return 'Mở tài khoản';
      return 'Đổi trạng thái tài khoản';
    case 'users.role.update':
      return 'Đổi vai trò';
    case 'users.feature_override.set':
      return afterObject.enabled === false ? `Chặn riêng ${getFeatureLabel(targetFeatureKey)}` : `Cấp riêng ${getFeatureLabel(targetFeatureKey)}`;
    case 'users.feature_override.revoke':
      return `Gỡ quyền riêng ${getFeatureLabel(targetFeatureKey)}`;
    case 'site_announcement.update':
      return 'Cập nhật thông báo hệ thống';
    case 'plans.update':
      return 'Cập nhật gói';
    case 'features.create':
      return 'Tạo tính năng';
    case 'features.update':
      return `Cập nhật tính năng ${getFeatureLabel(targetFeatureKey)}`;
    case 'plan_features.upsert':
      return `Cập nhật tính năng trong gói`;
    case 'consent.create':
      return 'Tạo điều khoản 18+';
    case 'users.sync_auth':
      return 'Đồng bộ Supabase Auth';
    default:
      return String(action || beforeObject.action || 'Thao tác quản trị');
  }
}

function getAuditChangeSummary(action, before = {}, after = {}, targetFeatureKey = '') {
  const beforeObject = asObject(before);
  const afterObject = asObject(after);
  switch (action) {
    case 'users.role.update':
      return `Vai trò: ${getRoleLabel(beforeObject.system_role || beforeObject.role)} → ${getRoleLabel(afterObject.system_role || afterObject.role)}`;
    case 'users.status.update':
      return `Trạng thái: ${getStatusLabel(beforeObject.status)} → ${getStatusLabel(afterObject.status)}`;
    case 'users.plan.set': {
      const expiresAt = afterObject.expires_at || afterObject.expiresAt;
      return `Gói: ${getPlanLabelFromChange(afterObject) || 'chưa rõ'}. Hết hạn: ${expiresAt ? formatAuditDate(expiresAt) : 'không giới hạn'}`;
    }
    case 'users.plan.cancel_current':
    case 'users.plan.cancel_scheduled':
      return `Số dòng bị ảnh hưởng: ${Number(afterObject.count || 0)}`;
    case 'users.feature_override.set':
      return `${afterObject.enabled === false ? 'Chặn' : 'Cấp'} ${getFeatureLabel(targetFeatureKey)}${afterObject.reason ? `, lý do: ${afterObject.reason}` : ''}`;
    case 'users.feature_override.revoke':
      return `Gỡ quyền riêng ${getFeatureLabel(targetFeatureKey)}`;
    case 'plan_features.upsert':
      return `${afterObject.enabled === false ? 'Tắt' : 'Bật'} ${getFeatureLabel(targetFeatureKey)} trong gói ${getPlanLabel(afterObject.planKey || afterObject.plan_key)}`;
    case 'site_announcement.update':
      return `Phiên bản: ${beforeObject.revision || 1} → ${afterObject.revision || 1}`;
    case 'users.sync_auth':
      return `Đồng bộ ${Number(afterObject.count || 0)} người dùng`;
    default:
      if (targetFeatureKey) return `Tính năng: ${getFeatureLabel(targetFeatureKey)}`;
      return '';
  }
}

function getResourceLabel({ targetSnapshot = {}, targetFeatureKey = '', action = '' } = {}) {
  const target = normalizeIdentitySnapshot(targetSnapshot);
  if (target.label && target.label !== 'Hệ thống') return target.label;
  if (targetFeatureKey) return getFeatureLabel(targetFeatureKey);
  if (String(action || '').startsWith('site_announcement')) return 'Thông báo hệ thống';
  if (String(action || '').startsWith('plans')) return 'Danh mục gói';
  if (String(action || '').startsWith('consent')) return 'Điều khoản 18+';
  return 'Hệ thống';
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
    query: `select=${PROFILE_SELECT}&${filterEq('user_id', userId)}&limit=1`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getProfilesByUserIds(config, userIds) {
  const ids = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const profiles = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const rows = await supabaseRest(config, PROFILES_TABLE, {
      query: `select=user_id,email,display_name,system_role,status,metadata&${filterIn('user_id', chunk)}`,
      prefer: '',
    });
    if (Array.isArray(rows)) profiles.push(...rows);
  }
  return new Map(profiles.map((profile) => [String(profile.user_id), profile]));
}

function strongestRole(...roles) {
  return roles
    .map(normalizeRole)
    .sort((left, right) => roleRank(right) - roleRank(left))[0] || SYSTEM_ROLES.USER;
}

function resolveSyncedUserStatus(authUser, existingProfile) {
  const authStatus = authUser.banned_until ? USER_STATUSES.BANNED : USER_STATUSES.ACTIVE;
  const existingStatus = existingProfile ? normalizeStatus(existingProfile.status) : '';
  if ([USER_STATUSES.BANNED, USER_STATUSES.DELETED].includes(existingStatus)) {
    return existingStatus;
  }
  return authStatus;
}

function mergeAuthMetadata(existingProfile, authUser) {
  const current = existingProfile?.metadata && typeof existingProfile.metadata === 'object'
    ? existingProfile.metadata
    : {};
  return {
    ...current,
    auth_created_at: authUser.created_at || null,
    auth_updated_at: authUser.updated_at || null,
    last_sign_in_at: authUser.last_sign_in_at || null,
  };
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

async function authenticate(request, config, { allowCache = false } = {}) {
  const token = getBearerToken(request);
  if (!token) {
    throw makeError(401, 'ADMIN_AUTH_REQUIRED', 'Bạn cần đăng nhập trước khi dùng Admin API.');
  }

  if (allowCache) {
    const cachedActor = getCachedActor(token);
    if (cachedActor) return cachedActor;
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

  const actor = {
    ...buildActorFromProfile(authUser, profile),
    profile,
  };
  if (allowCache) setCachedActor(token, actor);
  return actor;
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
  const targetProfile = targetUserId ? await getProfileForSnapshot(config, targetUserId) : null;
  const actorSnapshot = actorToSnapshot(actor);
  const targetSnapshot = targetUserId ? profileToSnapshot(targetProfile, targetUserId) : {};
  const actionSummary = getAuditActionSummary(action, before, after, targetFeatureKey);
  const changeSummary = getAuditChangeSummary(action, before, after, targetFeatureKey);
  const resourceLabel = getResourceLabel({ targetSnapshot, targetFeatureKey, action });

  const rows = await supabaseRest(config, AUDIT_TABLE, {
    method: 'POST',
    body: {
      actor_user_id: actor.id,
      action,
      target_user_id: targetUserId,
      target_feature_key: targetFeatureKey,
      before_json: before || {},
      after_json: after || {},
      actor_snapshot: actorSnapshot,
      target_snapshot: targetSnapshot,
      action_summary: actionSummary,
      change_summary: changeSummary,
      resource_label: resourceLabel,
      ip_address: getClientIp(request),
      user_agent: request.headers.get('User-Agent') || '',
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

function getProfileIdsFromRows(rows, fields) {
  return [...new Set(rows
    .flatMap((row) => fields.map((field) => row?.[field]))
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
}

async function getProfilesMapForRows(config, rows, fields) {
  const ids = getProfileIdsFromRows(rows, fields);
  if (ids.length === 0) return new Map();
  try {
    return await getProfilesByUserIds(config, ids);
  } catch {
    return new Map();
  }
}

async function getUsageSearchProfileIds(config, rawSearch) {
  const search = normalizeUsageSearch(rawSearch);
  if (!search) return [];
  const filters = [
    `email.ilike.*${search}*`,
    `display_name.ilike.*${search}*`,
  ];
  if (looksLikeUuid(rawSearch)) {
    filters.push(`user_id.eq.${String(rawSearch).trim()}`);
  }
  try {
    const rows = await supabaseRest(config, PROFILES_TABLE, {
      query: `select=user_id&or=(${filters.join(',')})&limit=100`,
      prefer: '',
    });
    return [...new Set((Array.isArray(rows) ? rows : [])
      .map((row) => String(row.user_id || '').trim())
      .filter(Boolean))];
  } catch {
    return looksLikeUuid(rawSearch) ? [String(rawSearch).trim()] : [];
  }
}

function identityFromSnapshotOrProfile(snapshotValue, profileMap, fallbackId) {
  const snapshot = profileToSnapshot(snapshotValue, fallbackId);
  if (snapshot.email || snapshot.displayName || snapshot.role || snapshot.status) return snapshot;
  const profile = profileMap.get(String(fallbackId || ''));
  return profileToSnapshot(profile, fallbackId);
}

function enrichAuditLog(row, profileMap) {
  const before = row.before_json || {};
  const after = row.after_json || {};
  const actor = identityFromSnapshotOrProfile(row.actor_snapshot, profileMap, row.actor_user_id);
  const target = row.target_user_id
    ? identityFromSnapshotOrProfile(row.target_snapshot, profileMap, row.target_user_id)
    : {
      id: row.target_feature_key || '',
      email: '',
      displayName: '',
      role: '',
      status: '',
      label: row.target_feature_key ? getFeatureLabel(row.target_feature_key) : 'Hệ thống',
      roleLabel: '',
      statusLabel: '',
    };
  const summary = row.action_summary || getAuditActionSummary(row.action, before, after, row.target_feature_key);
  const details = row.change_summary || getAuditChangeSummary(row.action, before, after, row.target_feature_key);
  const resourceLabel = row.resource_label || getResourceLabel({
    targetSnapshot: target,
    targetFeatureKey: row.target_feature_key,
    action: row.action,
  });

  return {
    ...row,
    actor,
    target,
    actor_email: row.actor_email || actor.email || '',
    target_email: row.target_email || target.email || '',
    summary,
    details,
    resource_label: resourceLabel,
    change: { before, after },
    security: {
      ip: row.ip_address || '',
      userAgent: row.user_agent || '',
    },
  };
}

async function listAuditLogs(config, actor, url) {
  requirePermission(actor, ROUTE_PERMISSIONS.audit);
  const rows = await supabaseRest(config, AUDIT_TABLE, {
    query: 'select=id,actor_user_id,action,target_user_id,target_feature_key,before_json,after_json,actor_snapshot,target_snapshot,action_summary,change_summary,resource_label,ip_address,user_agent,created_at&order=created_at.desc&limit=200',
    prefer: '',
  });
  const items = Array.isArray(rows) ? rows : [];
  const profileMap = await getProfilesMapForRows(config, items, ['actor_user_id', 'target_user_id']);
  return {
    items: items.map((row) => enrichAuditLog(row, profileMap)),
  };
}

async function getOverview(config, actor) {
  requirePermission(actor, ADMIN_PERMISSIONS.USERS_READ);
  const startedAt = Date.now();
  const [profiles, auditRows] = await Promise.all([
    supabaseRest(config, PROFILES_TABLE, {
      query: `select=${OVERVIEW_PROFILE_SELECT}&order=updated_at.desc&limit=25`,
      prefer: '',
    }),
    supabaseRest(config, AUDIT_TABLE, {
      query: 'select=id,actor_user_id,action,target_user_id,target_feature_key,before_json,after_json,actor_snapshot,target_snapshot,action_summary,change_summary,resource_label,ip_address,user_agent,created_at&order=created_at.desc&limit=5',
      prefer: '',
    }),
  ]);
  const userItems = Array.isArray(profiles) ? profiles : [];
  const auditItems = Array.isArray(auditRows) ? auditRows : [];
  const profileMap = await getProfilesMapForRows(config, auditItems, ['actor_user_id', 'target_user_id']);
  const byRole = {};
  const byStatus = {};
  for (const user of userItems) {
    const role = normalizeRole(user.system_role);
    const status = normalizeStatus(user.status);
    byRole[role] = (byRole[role] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const payload = {
    ok: true,
    actor: actorToSnapshot(actor),
    users: {
      items: userItems,
      summary: {
        total: userItems.length,
        byRole,
        byStatus,
      },
    },
    audit: {
      items: auditItems.map((row) => enrichAuditLog(row, profileMap)),
    },
    service: {
      ok: true,
      name: 'storyforge-admin-api',
    },
  };
  return withResponseHeaders(payload, {
    'Server-Timing': `overview-db;dur=${Math.max(0, Date.now() - startedAt)};desc="miss"`,
  });
}

function getProviderLabel(provider) {
  const value = String(provider || '').trim().toLowerCase();
  const labels = {
    ag_proxy: 'Gemini Proxy AG',
    ai_studio_relay: 'AI Studio Relay',
    custom_proxy: 'Proxy tùy chỉnh',
    gemini_direct: 'Gemini Direct',
    openai: 'OpenAI',
  };
  if (labels[value]) return labels[value];
  if (!value) return 'Không rõ provider';
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getUsageStatusLabel(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'ok' || value === 'success') return 'Thành công';
  if (value === 'error' || value === 'failed') return 'Lỗi';
  if (value === 'blocked' || value === 'denied') return 'Bị chặn';
  return value || 'Không rõ';
}

const USAGE_TASK_LABELS_VI = {
  story_writing: 'Viết truyện',
  story_chat: 'Chat của truyện',
  free_chat: 'Chat tự do',
  story_planning: 'Lên kế hoạch truyện',
  story_analysis: 'Phân tích truyện',
  story_data: 'Dữ liệu truyện',
  story_setup: 'Thiết lập truyện',
};

const USAGE_TASK_TYPE_LABELS_VI = {
  continue: 'Viết truyện',
  scene_draft: 'Viết truyện',
  arc_chapter_draft: 'Viết truyện',
  rewrite: 'Chỉnh sửa truyện',
  expand: 'Mở rộng truyện',
  style_write: 'Viết theo văn phong',
  free_prompt: 'Yêu cầu AI tự do',
  brainstorm: 'Lên ý tưởng truyện',
  outline: 'Lập dàn ý truyện',
  plot_suggest: 'Gợi ý cốt truyện',
  arc_outline: 'Lập dàn ý arc',
  chapter_summary: 'Tóm tắt chương',
  check_conflict: 'Kiểm tra mâu thuẫn',
  extract_terms: 'Rút trích thuật ngữ',
  relationship_analyze_batch: 'Phân tích quan hệ nhân vật',
  canon_extract_ops: 'Rút trích canon',
  canon_repair: 'Sửa canon',
  canon_review: 'Rà soát canon',
  project_wizard: 'Tạo truyện mới',
};

function usageMetadataText(metadata, key) {
  return String(metadata?.[key] || '').trim();
}

function getUsageMetadataTaskLabel(metadata) {
  const explicitLabel = usageMetadataText(metadata, 'taskLabel');
  if (explicitLabel) return explicitLabel;
  const taskType = usageMetadataText(metadata, 'taskType');
  if (taskType && USAGE_TASK_TYPE_LABELS_VI[taskType]) return USAGE_TASK_TYPE_LABELS_VI[taskType];
  const taskGroup = usageMetadataText(metadata, 'taskGroup');
  if (taskGroup && USAGE_TASK_LABELS_VI[taskGroup]) return USAGE_TASK_LABELS_VI[taskGroup];
  return '';
}

function getUsageTaskLabel(row) {
  const metadata = asObject(row.metadata);
  const featureKey = row.feature_key || metadata.workflowFeature || metadata.providerFeature;
  if (featureKey && featureKey !== ACCESS_FEATURES.AI_CHAT_ACCESS) return getFeatureLabel(featureKey);
  const metadataLabel = getUsageMetadataTaskLabel(metadata);
  if (metadataLabel) return metadataLabel;
  if (featureKey) return getFeatureLabel(featureKey);
  const action = String(metadata.action || '').trim();
  if (action === 'models') return 'Xem danh sách model';
  if (action === 'chat_stream_batch') return 'Chat AI theo batch';
  if (action === 'chat') return 'Chat AI';
  return 'Tác vụ AI';
}

function enrichUsageEvent(row, profileMap) {
  const user = row.user_id
    ? identityFromSnapshotOrProfile(null, profileMap, row.user_id)
    : {
      id: '',
      email: '',
      displayName: '',
      role: '',
      status: '',
      label: 'Ẩn danh',
      roleLabel: '',
      statusLabel: '',
    };
  return {
    ...row,
    user,
    email: row.email || user.email || '',
    taskLabel: getUsageTaskLabel(row),
    providerLabel: getProviderLabel(row.provider),
    statusLabel: getUsageStatusLabel(row.status),
  };
}

function appendUsageLogicalFilters(query, groups) {
  const activeGroups = groups.filter((group) => Array.isArray(group) && group.length > 0);
  if (activeGroups.length === 0) return;
  if (activeGroups.length === 1) {
    query.set('or', `(${activeGroups[0].join(',')})`);
    return;
  }
  query.set('and', `(${activeGroups.map((group) => `or(${group.join(',')})`).join(',')})`);
}

async function buildUsageQuery(config, url, pagination) {
  const query = new URLSearchParams({
    select: USAGE_SELECT,
    order: 'created_at.desc,id.desc',
  });
  const rawCursor = String(url.searchParams.get('cursor') || '').trim();
  const cursor = decodeUsageCursor(rawCursor);
  const provider = normalizeUsageFilter(url.searchParams.get('provider'));
  const status = normalizeUsageFilter(url.searchParams.get('status'));
  const search = normalizeUsageSearch(url.searchParams.get('q'));
  const logicalGroups = [];

  if (provider) query.set('provider', `eq.${provider}`);
  if (status) query.set('status', `eq.${status}`);

  if (search) {
    const profileIds = await getUsageSearchProfileIds(config, url.searchParams.get('q'));
    const searchGroup = [
      `request_id.ilike.*${search}*`,
      `feature_key.ilike.*${search}*`,
      `provider.ilike.*${search}*`,
      `model.ilike.*${search}*`,
      `event_type.ilike.*${search}*`,
      `status.ilike.*${search}*`,
      `metadata->>action.ilike.*${search}*`,
      `metadata->>workflowFeature.ilike.*${search}*`,
      `metadata->>providerFeature.ilike.*${search}*`,
      `metadata->>taskType.ilike.*${search}*`,
      `metadata->>taskGroup.ilike.*${search}*`,
      `metadata->>taskLabel.ilike.*${search}*`,
      `metadata->>surface.ilike.*${search}*`,
      `metadata->>chatMode.ilike.*${search}*`,
    ];
    if (profileIds.length > 0) {
      searchGroup.push(`user_id.in.(${profileIds.join(',')})`);
    } else if (looksLikeUuid(url.searchParams.get('q'))) {
      searchGroup.push(`user_id.eq.${String(url.searchParams.get('q')).trim()}`);
    }
    logicalGroups.push(searchGroup);
  }

  if (cursor) {
    logicalGroups.push([
      `created_at.lt.${cursor.createdAt}`,
      `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    ]);
  } else if (pagination.offset > 0) {
    if (pagination.offset > MAX_USAGE_OFFSET_WITHOUT_CURSOR) {
      throw makeError(
        400,
        'ADMIN_USAGE_DEEP_PAGE_REQUIRES_CURSOR',
        'Trang quá sâu. Hãy đi tiếp bằng nút Trang sau hoặc lọc/tìm kiếm để tránh truy vấn offset lớn.',
      );
    }
    query.set('offset', String(pagination.offset));
  }

  appendUsageLogicalFilters(query, logicalGroups);
  query.set('limit', String(pagination.pageSize + 1));
  return {
    query,
    cursorMode: Boolean(cursor),
  };
}

async function listUsageEvents(config, actor, url) {
  requirePermission(actor, ROUTE_PERMISSIONS.usage);
  const pagination = getPaginationFromUrl(url);
  const { query, cursorMode } = await buildUsageQuery(config, url, pagination);
  const knownTotal = toBoundedInteger(url.searchParams.get('knownTotal'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const { payload: rows, headers } = await supabaseRestResult(config, USAGE_TABLE, {
    query: query.toString(),
    prefer: '',
  });
  const fetchedItems = Array.isArray(rows) ? rows : [];
  const items = fetchedItems.slice(0, pagination.pageSize);
  const profileMap = await getProfilesMapForRows(config, items, ['user_id']);
  const total = knownTotal > 0
    ? knownTotal
    : pagination.offset + items.length + (fetchedItems.length > items.length ? 1 : 0);
  const totalPages = total > 0 ? Math.ceil(total / pagination.pageSize) : 0;
  const hasExtraRow = fetchedItems.length > items.length;
  const nextCursor = hasExtraRow && items.length > 0 ? encodeUsageCursor(items[items.length - 1]) : '';
  return {
    items: items.map((row) => enrichUsageEvent(row, profileMap)),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
      mode: cursorMode ? 'cursor' : 'offset',
      nextCursor,
      hasNextPage: hasExtraRow || (totalPages > 0 && pagination.page < totalPages),
      hasPreviousPage: pagination.page > 1,
    },
  };
}

function enrichUsageRankingRow(row) {
  const okCount = toSafeNumber(row.ok_count);
  const errorCount = toSafeNumber(row.error_count);
  const blockedCount = toSafeNumber(row.blocked_count);
  return {
    rank: toSafeNumber(row.rank_order),
    userId: row.user_id || '',
    email: row.email || '',
    displayName: row.display_name || '',
    label: row.display_name || row.email || row.user_id || 'Không rõ người dùng',
    planKey: row.plan_key || '',
    planName: row.plan_name || getPlanLabel(row.plan_key),
    totalCount: toSafeNumber(row.total_count),
    eventCount: toSafeNumber(row.event_count),
    okCount,
    errorCount,
    blockedCount,
    issueCount: errorCount + blockedCount,
    lastUsedAt: row.last_used_at || null,
    taskSummary: row.task_summary || 'Tác vụ AI',
  };
}

function summarizeUsageRanking(items, rows = []) {
  const firstRow = Array.isArray(rows) ? rows[0] || null : null;
  if (firstRow && firstRow.matching_user_count !== undefined) {
    return {
      totalUsers: toSafeNumber(firstRow.matching_user_count),
      totalCount: toSafeNumber(firstRow.matching_total_count),
      eventCount: toSafeNumber(firstRow.matching_event_count),
      okCount: toSafeNumber(firstRow.matching_ok_count),
      issueCount: toSafeNumber(firstRow.matching_issue_count),
      lastUsedAt: firstRow.matching_last_used_at || null,
    };
  }
  return items.reduce((summary, item) => ({
    totalUsers: summary.totalUsers + 1,
    totalCount: summary.totalCount + item.totalCount,
    eventCount: summary.eventCount + item.eventCount,
    okCount: summary.okCount + item.okCount,
    issueCount: summary.issueCount + item.issueCount,
    lastUsedAt: !summary.lastUsedAt || (item.lastUsedAt && item.lastUsedAt > summary.lastUsedAt)
      ? item.lastUsedAt
      : summary.lastUsedAt,
  }), {
    totalUsers: 0,
    totalCount: 0,
    eventCount: 0,
    okCount: 0,
    issueCount: 0,
    lastUsedAt: null,
  });
}

function cloneUsageRankingPayload(payload) {
  return {
    ok: true,
    items: Array.isArray(payload?.items) ? payload.items.map((item) => ({ ...item })) : [],
    summary: { ...(payload?.summary || {}) },
    filters: { ...(payload?.filters || {}) },
  };
}

function getUsageRankingCacheKey(filters) {
  return JSON.stringify({
    range: filters.range,
    from: filters.from || '',
    to: filters.to || '',
    task: filters.task,
    plan: filters.plan,
    provider: filters.provider || '',
    status: filters.status || '',
    q: filters.q || '',
    limit: filters.limit,
  });
}

function getCachedUsageRankingPayload(cacheKey) {
  const entry = usageRankingCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    usageRankingCache.delete(cacheKey);
    return null;
  }
  usageRankingCache.delete(cacheKey);
  usageRankingCache.set(cacheKey, entry);
  return cloneUsageRankingPayload(entry.payload);
}

function setCachedUsageRankingPayload(cacheKey, payload) {
  if (usageRankingCache.size >= USAGE_RANKING_CACHE_MAX_ENTRIES) {
    const oldestKey = usageRankingCache.keys().next().value;
    if (oldestKey) usageRankingCache.delete(oldestKey);
  }
  usageRankingCache.set(cacheKey, {
    expiresAt: Date.now() + USAGE_RANKING_CACHE_TTL_MS,
    payload: cloneUsageRankingPayload(payload),
  });
}

function usageRankingServerTiming(cacheStatus, startedAt) {
  const duration = Math.max(0, Date.now() - startedAt);
  return `vip-ranking;dur=${duration};desc="${cacheStatus}"`;
}

async function fetchUsageRankingPayload(config, filters) {
  const rows = await supabaseRest(config, 'rpc/admin_usage_user_rankings', {
    method: 'POST',
    prefer: '',
    body: {
      p_from: filters.from,
      p_to: filters.to,
      p_task: filters.task,
      p_plan: filters.plan,
      p_provider: filters.provider,
      p_status: filters.status,
      p_search: filters.q,
      p_limit: filters.limit,
    },
  });
  const items = (Array.isArray(rows) ? rows : []).map(enrichUsageRankingRow);
  return {
    ok: true,
    items,
    summary: summarizeUsageRanking(items, rows),
    filters,
  };
}

async function getUsageRankingPayload(config, filters, { force = false } = {}) {
  const cacheKey = getUsageRankingCacheKey(filters);
  if (!force) {
    const cachedPayload = getCachedUsageRankingPayload(cacheKey);
    if (cachedPayload) return { payload: cachedPayload, cacheStatus: 'hit' };

    const pendingPayload = usageRankingInflight.get(cacheKey);
    if (pendingPayload) {
      const payload = await pendingPayload;
      return { payload: cloneUsageRankingPayload(payload), cacheStatus: 'shared' };
    }
  }

  const pendingPayload = fetchUsageRankingPayload(config, filters).then((payload) => {
    setCachedUsageRankingPayload(cacheKey, payload);
    return payload;
  });
  if (!force) usageRankingInflight.set(cacheKey, pendingPayload);
  try {
    const payload = await pendingPayload;
    return { payload: cloneUsageRankingPayload(payload), cacheStatus: 'miss' };
  } finally {
    if (!force) usageRankingInflight.delete(cacheKey);
  }
}

async function listUsageRanking(config, actor, url) {
  requirePermission(actor, ROUTE_PERMISSIONS.usage);
  const startedAt = Date.now();
  const filters = normalizeUsageRankingParams(url);
  const force = url.searchParams.get('force') === '1';
  const { payload, cacheStatus } = await getUsageRankingPayload(config, filters, { force });
  return withResponseHeaders(payload, {
    'Server-Timing': usageRankingServerTiming(cacheStatus, startedAt),
  });
}

async function listTable(config, actor, resource, table, url, defaultQuery) {
  requirePermission(actor, ROUTE_PERMISSIONS[resource]);
  return {
    items: await supabaseRest(config, table, {
      query: defaultQuery,
      prefer: '',
    }),
  };
}

async function findPlanByKey(config, planKeyInput) {
  const planKey = normalizePlan(planKeyInput);
  const rows = await supabaseRest(config, PLANS_TABLE, {
    query: `select=${PLAN_SELECT}&${filterEq('key', planKey)}&limit=1`,
    prefer: '',
  });
  const plan = Array.isArray(rows) ? rows[0] || null : null;
  if (!plan) {
    throw makeError(404, 'ADMIN_PLAN_NOT_FOUND', `Không tìm thấy gói ${planKey}.`);
  }
  return plan;
}

async function findPlanById(config, id) {
  const rows = await supabaseRest(config, PLANS_TABLE, {
    query: `select=${PLAN_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
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
  const query = 'select=user_id,email,display_name,system_role,status,metadata,updated_at,created_at,user_plans(id,user_id,plan_id,status,starts_at,expires_at,created_at,plans(key,name))&order=updated_at.desc&limit=200';
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
      query: `select=${USER_PLAN_SELECT}&${filterEq('user_id', userId)}&order=starts_at.desc`,
      prefer: '',
    }),
    supabaseRest(config, FEATURES_TABLE, {
      query: `select=${FEATURE_SELECT}&order=category.asc,key.asc`,
      prefer: '',
    }),
    supabaseRest(config, PLAN_FEATURES_TABLE, {
      query: `select=${PLAN_FEATURE_SELECT}&order=feature_key.asc`,
      prefer: '',
    }),
    supabaseRest(config, OVERRIDES_TABLE, {
      query: `select=${OVERRIDE_SELECT}&${filterEq('user_id', userId)}&order=created_at.desc`,
      prefer: '',
    }),
    supabaseRest(config, CONSENT_TABLE, {
      query: `select=${CONSENT_SELECT}&order=effective_at.desc`,
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
      after: { ...(saved || item), planKey: plan.key, planName: plan.name },
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
    supabaseRest(config, PLANS_TABLE, { query: `select=${PLAN_SELECT}&order=sort_order.asc,key.asc`, prefer: '' }),
    supabaseRest(config, FEATURES_TABLE, { query: `select=${FEATURE_SELECT}&order=category.asc,key.asc`, prefer: '' }),
    supabaseRest(config, PLAN_FEATURES_TABLE, { query: `select=${PLAN_FEATURE_SELECT}&order=feature_key.asc`, prefer: '' }),
    supabaseRest(config, CONSENT_TABLE, { query: `select=${CONSENT_SELECT}&order=effective_at.desc`, prefer: '' }),
  ]);
  return {
    items: Array.isArray(plans) ? plans : [],
    plans: Array.isArray(plans) ? plans : [],
    features: Array.isArray(features) ? features : [],
    planFeatures: Array.isArray(planFeatures) ? planFeatures : [],
    consentVersions: Array.isArray(consentVersions) ? consentVersions : [],
  };
}

async function getSiteAnnouncementSetting(config) {
  const rows = await supabaseRest(config, SITE_SETTINGS_TABLE, {
    query: `select=key,value_json,revision&${filterEq('key', SITE_ANNOUNCEMENT_KEY)}&limit=1`,
    prefer: '',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getSiteAnnouncement(config, actor) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_READ);
  const row = await getSiteAnnouncementSetting(config);
  return {
    ok: true,
    announcement: toPublicSiteAnnouncement(row),
  };
}

function createSiteAnnouncementPatch(current, body = {}) {
  return normalizeSiteAnnouncement({
    enabled: body.enabled ?? current.enabled,
    revision: current.revision,
    title: body.title ?? current.title,
    body: body.body ?? current.body,
    primaryActionLabel: body.primaryActionLabel ?? current.primaryActionLabel,
    primaryActionUrl: body.primaryActionUrl ?? current.primaryActionUrl,
  });
}

async function upsertSiteAnnouncement(config, valueJson, contentChanged, actor) {
  const rows = await supabaseRest(config, 'rpc/upsert_site_announcement', {
    method: 'POST',
    query: '',
    body: {
      p_value_json: {
        enabled: valueJson.enabled,
        title: valueJson.title,
        body: valueJson.body,
        primaryActionLabel: valueJson.primaryActionLabel,
        primaryActionUrl: valueJson.primaryActionUrl,
      },
      p_content_changed: contentChanged,
      p_updated_by: actor.id || null,
    },
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function mutateSiteAnnouncement(config, request, actor, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const currentRow = await getSiteAnnouncementSetting(config);
  const current = toPublicSiteAnnouncement(currentRow);
  const next = createSiteAnnouncementPatch(current, body);
  const contentChanged = hasSiteAnnouncementContentChanged(current, next);
  const savedRow = await upsertSiteAnnouncement(config, next, contentChanged, actor);
  const announcement = toPublicSiteAnnouncement(savedRow || {
    key: SITE_ANNOUNCEMENT_KEY,
    revision: next.revision,
    value_json: next,
  });

  await auditMutation(config, request, actor, 'site_announcement.update', {
    before: current,
    after: announcement,
  });

  return { ok: true, announcement };
}

async function mutateCatalogPlan(config, request, actor, id, body) {
  requirePermission(actor, ADMIN_PERMISSIONS.CATALOG_WRITE);
  const currentPlan = body.vipPage !== undefined ? await findPlanById(config, id) : null;
  if (body.vipPage !== undefined && !currentPlan) {
    throw makeError(404, 'ADMIN_PLAN_NOT_FOUND', 'Không tìm thấy gói cần cập nhật.');
  }
  const currentMetadata = currentPlan?.metadata && typeof currentPlan.metadata === 'object'
    ? currentPlan.metadata
    : {};
  const patch = {
    ...(body.name !== undefined ? { name: String(body.name) } : {}),
    ...(body.description !== undefined ? { description: String(body.description) } : {}),
    ...(body.active !== undefined || body.enabled !== undefined ? { active: normalizeBoolean(body.active ?? body.enabled, true) } : {}),
    ...(body.sortOrder !== undefined || body.sort_order !== undefined ? { sort_order: Number(body.sortOrder ?? body.sort_order) || 100 } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata || {} } : {}),
    ...(body.vipPage !== undefined ? {
      metadata: {
        ...currentMetadata,
        vipPage: normalizeVipPageContent(body.vipPage),
      },
    } : {}),
  };
  const rows = await supabaseRest(config, PLANS_TABLE, {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(id)}`,
    body: patch,
  });
  const item = Array.isArray(rows) ? rows[0] : rows;
  await auditMutation(config, request, actor, 'plans.update', {
    ...(currentPlan ? { before: currentPlan } : {}),
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
    after: { ...(saved || item), planKey: plan.key },
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
  const existingProfiles = await getProfilesByUserIds(config, users.map((user) => user.id));
  const rows = users.map((user) => {
    const subject = resolveAccessSubject(user);
    const existingProfile = existingProfiles.get(String(user.id));
    return {
      user_id: user.id,
      email: user.email || '',
      display_name: user.user_metadata?.name || user.user_metadata?.full_name || user.email || '',
      system_role: strongestRole(existingProfile?.system_role, subject.role),
      status: resolveSyncedUserStatus(user, existingProfile),
      metadata: mergeAuthMetadata(existingProfile, user),
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

async function routeRequest(request, config, actor, env = {}) {
  const url = new URL(request.url);
  const segments = cleanPath(url);
  const [resource, id, action] = segments;

  if (!resource) {
    return { ok: true, service: 'storyforge-admin-api', actor };
  }

  if (resource === 'me') {
    return { ok: true, actor };
  }

  if (resource === 'overview' && request.method === 'GET') {
    return getOverview(config, actor);
  }

  if (resource === 'story-mirror') {
    return routeStoryMirrorAdmin({
      request,
      env,
      config,
      actor,
      segments: segments.slice(1),
      url,
      helpers: {
        supabaseRest,
        requirePermission,
        readJson,
        getClientIp,
      },
    });
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

  if (resource === 'announcement') {
    if (request.method === 'GET' && !id) return getSiteAnnouncement(config, actor);
    if ((request.method === 'PATCH' || request.method === 'POST') && !id) {
      return mutateSiteAnnouncement(config, request, actor, await readJson(request));
    }
  }

  if (resource === 'features') {
    if (request.method === 'GET' && !id) {
      return listTable(config, actor, resource, FEATURES_TABLE, url, `select=${FEATURE_SELECT}&order=category.asc,key.asc&limit=500`);
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
      return listTable(config, actor, resource, CONSENT_TABLE, url, `select=${CONSENT_SELECT}&order=effective_at.desc&limit=200`);
    }
    if (request.method === 'POST') return mutateConsent(config, request, actor, await readJson(request));
  }

  if (resource === 'audit' && request.method === 'GET') {
    return listAuditLogs(config, actor, url);
  }

  if (resource === 'usage' && id === 'ranking' && request.method === 'GET') {
    if (!envFlagEnabled(env, 'ADMIN_RANKING_ENABLED')) {
      throw makeError(503, 'ADMIN_RANKING_DISABLED', 'Bảng xếp hạng VIP tạm tắt để bảo trì.');
    }
    return listUsageRanking(config, actor, url);
  }

  if (resource === 'usage' && request.method === 'GET') {
    if (!envFlagEnabled(env, 'ADMIN_USAGE_ENABLED')) {
      throw makeError(503, 'ADMIN_USAGE_DISABLED', 'Trang usage tạm tắt để bảo trì.');
    }
    if (!envFlagEnabled(env, 'ADMIN_USAGE_SEARCH_ENABLED') && String(url.searchParams.get('q') || '').trim()) {
      throw makeError(503, 'ADMIN_USAGE_SEARCH_DISABLED', 'Tìm kiếm usage tạm tắt để bảo trì.');
    }
    return listUsageEvents(config, actor, url);
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
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }

  if (new URL(request.url).pathname.replace(/^\/api\/admin/u, '') === '/health') {
    return json({ ok: true, service: 'storyforge-admin-api' }, 200, cors);
  }

  try {
    const actor = await authenticate(request, config, {
      allowCache: shouldCacheActorForRequest(request),
    });
    const payload = await routeRequest(request, config, actor, env);
    return json(payload, 200, cors, getResponseHeaders(payload));
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
