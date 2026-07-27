import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  PLAN_STATUSES,
  SYSTEM_ROLES,
  USER_STATUSES,
  resolveAdminDecision,
  resolveFeatureDecision,
  resolveUserAccess,
} from '../../src/services/access/accessControl.js';
import { getBearerToken, getClientIp, getUserAgent, sendJson, sendPublicError } from './http.js';
import { getSupabaseAdminClient, getSupabaseAdminConfig } from './supabaseAdmin.js';
import { isPreviewRuntime, normalizeRuntime } from './web.js';

export {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  SYSTEM_ROLES,
  resolveFeatureDecision,
};

const ACCESS_GLOBAL_CATALOG_TTL_MS = 5 * 60 * 1000;
const ACCESS_USER_SNAPSHOT_TTL_MS = 120 * 1000;

let globalAccessCatalogCache = null;
const userAccessDataCache = new Map();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAccessCacheEnabled(env = {}) {
  return String(env.ACCESS_CACHE_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cloneAccessData(value) {
  return cloneJson(value);
}

async function readSupabaseData(query, fallbackCode) {
  return throwOnError(await query, fallbackCode);
}

export function clearAccessRuntimeCaches() {
  globalAccessCatalogCache = null;
  userAccessDataCache.clear();
}

function normalizeEmail(user) {
  return String(user?.email || user?.user_metadata?.email || '').trim();
}

function normalizeDisplayName(user) {
  return String(
    user?.user_metadata?.name
      || user?.user_metadata?.full_name
      || user?.email
      || '',
  ).trim();
}

export function mapAuthUserToProfileRow(user) {
  return {
    user_id: user?.id,
    email: normalizeEmail(user),
    display_name: normalizeDisplayName(user),
    metadata: {
      auth_created_at: user?.created_at || null,
      auth_updated_at: user?.updated_at || null,
      last_sign_in_at: user?.last_sign_in_at || null,
      provider: user?.app_metadata?.provider || '',
    },
  };
}

function mapUserPlan(row) {
  return {
    ...row,
    plan_key: row?.plans?.key || row?.plan_key || '',
    plan_name: row?.plans?.name || '',
  };
}

async function getAccessVersion(supabase, userId) {
  const accessVersion = await readSupabaseData(
    supabase
      .from('access_versions')
      .select('version,updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  );
  return accessVersion?.version || 1;
}

function getCachedUserAccessData(userId, accessVersion, profileInput = null) {
  const entry = userAccessDataCache.get(`${userId}:${accessVersion}`);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userAccessDataCache.delete(`${userId}:${accessVersion}`);
    return null;
  }
  const accessData = cloneAccessData(entry.accessData);
  if (profileInput) {
    accessData.profile = profileInput;
  }
  return accessData;
}

function setCachedUserAccessData(userId, accessVersion, accessData) {
  userAccessDataCache.set(`${userId}:${accessVersion}`, {
    expiresAt: Date.now() + ACCESS_USER_SNAPSHOT_TTL_MS,
    accessData: cloneAccessData(accessData),
  });
}

async function getGlobalAccessCatalog(supabase) {
  if (globalAccessCatalogCache?.expiresAt > Date.now()) {
    return cloneAccessData(globalAccessCatalogCache.catalog);
  }

  const [features, planFeatures, consentVersions] = await Promise.all([
    readSupabaseData(supabase.from('features').select('*')),
    readSupabaseData(supabase.from('plan_features').select('*')),
    readSupabaseData(supabase.from('consent_versions').select('*').eq('active', true)),
  ]);

  const catalog = {
    features: asArray(features),
    planFeatures: asArray(planFeatures),
    consentVersions: asArray(consentVersions),
  };
  globalAccessCatalogCache = {
    expiresAt: Date.now() + ACCESS_GLOBAL_CATALOG_TTL_MS,
    catalog: cloneAccessData(catalog),
  };
  return catalog;
}

async function throwOnError(result, fallbackCode = 'SUPABASE_QUERY_FAILED') {
  if (result?.error) {
    const error = new Error(result.error.message || fallbackCode);
    error.code = result.error.code || fallbackCode;
    throw error;
  }
  return result?.data;
}

async function ensureProfile(supabase, user, { allowCreate = true } = {}) {
  const userId = user?.id;
  if (!userId) throw new Error('AUTH_USER_MISSING');

  const existing = await throwOnError(
    await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  );

  if (existing) return existing;

  if (!allowCreate) {
    const error = new Error('PREVIEW_PROFILE_REQUIRED');
    error.code = 'PREVIEW_PROFILE_REQUIRED';
    error.status = 409;
    throw error;
  }

  const profile = await throwOnError(
    await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        email: normalizeEmail(user),
        display_name: normalizeDisplayName(user),
        system_role: SYSTEM_ROLES.USER,
        status: USER_STATUSES.ACTIVE,
      })
      .select('*')
      .single(),
  );

  const freePlan = await throwOnError(
    await supabase
      .from('plans')
      .select('id')
      .eq('key', 'free')
      .maybeSingle(),
  );

  if (freePlan?.id) {
    await supabase
      .from('user_plans')
      .insert({
        user_id: userId,
        plan_id: freePlan.id,
        status: PLAN_STATUSES.ACTIVE,
        source: 'auto',
      });
  }

  return profile;
}

export async function authenticateRequest(req, options = {}) {
  const runtime = normalizeRuntime(options.runtime || { env: options.env });
  const ensureUserProfile = options.ensureUserProfile ?? !isPreviewRuntime(runtime);
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      decision: {
        allowed: false,
        status: 401,
        reason: ACCESS_REASONS.AUTH_REQUIRED,
      },
    };
  }

  const config = getSupabaseAdminConfig(runtime.env);
  if (!config.configured) {
    return {
      ok: false,
      status: 500,
      reason: 'SUPABASE_ADMIN_NOT_CONFIGURED',
      decision: {
        allowed: false,
        status: 500,
        reason: 'SUPABASE_ADMIN_NOT_CONFIGURED',
      },
    };
  }

  const supabase = getSupabaseAdminClient(runtime.env);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      ok: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      decision: {
        allowed: false,
        status: 401,
        reason: ACCESS_REASONS.AUTH_REQUIRED,
      },
    };
  }

  let profile = null;
  if (ensureUserProfile) {
    profile = await ensureProfile(supabase, data.user);
  } else {
    try {
      profile = await ensureProfile(supabase, data.user, { allowCreate: false });
    } catch (error) {
      if (error?.code !== 'PREVIEW_PROFILE_REQUIRED') throw error;
      return {
        ok: false,
        status: 409,
        reason: 'PREVIEW_PROFILE_REQUIRED',
        decision: {
          allowed: false,
          status: 409,
          reason: 'PREVIEW_PROFILE_REQUIRED',
        },
      };
    }
  }

  return {
    ok: true,
    token,
    supabase,
    user: data.user,
    profile,
  };
}

async function buildAccessDataUncached(supabase, user, profileInput = null) {
  const profile = profileInput || await ensureProfile(supabase, user);
  const userId = user.id;

  const [
    features,
    userPlans,
    planFeatures,
    overrides,
    consentVersions,
    accessVersion,
  ] = await Promise.all([
    readSupabaseData(supabase.from('features').select('*')),
    readSupabaseData(
      supabase
        .from('user_plans')
        .select('*, plans(key, name)')
        .eq('user_id', userId),
    ),
    readSupabaseData(supabase.from('plan_features').select('*')),
    readSupabaseData(
      supabase
        .from('user_entitlement_overrides')
        .select('*')
        .eq('user_id', userId),
    ),
    readSupabaseData(supabase.from('consent_versions').select('*').eq('active', true)),
    getAccessVersion(supabase, userId),
  ]);

  return {
    authenticated: true,
    userId,
    profile,
    features: asArray(features),
    userPlans: asArray(userPlans).map(mapUserPlan),
    planFeatures: asArray(planFeatures),
    overrides: asArray(overrides),
    consentVersions: asArray(consentVersions),
    accessVersion,
  };
}

export async function buildAccessData(supabase, user, profileInput = null, runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  if (!isAccessCacheEnabled(runtime.env)) {
    return buildAccessDataUncached(supabase, user, profileInput);
  }

  const profile = profileInput || await ensureProfile(supabase, user);
  const userId = user.id;
  const accessVersion = await getAccessVersion(supabase, userId);
  const cached = getCachedUserAccessData(userId, accessVersion, profile);
  if (cached) return cached;

  const [
    catalog,
    userPlans,
    overrides,
  ] = await Promise.all([
    getGlobalAccessCatalog(supabase),
    readSupabaseData(
      supabase
        .from('user_plans')
        .select('*, plans(key, name)')
        .eq('user_id', userId),
    ),
    readSupabaseData(
      supabase
        .from('user_entitlement_overrides')
        .select('*')
        .eq('user_id', userId),
    ),
  ]);

  const accessData = {
    authenticated: true,
    userId,
    profile,
    features: asArray(catalog.features),
    userPlans: asArray(userPlans).map(mapUserPlan),
    planFeatures: asArray(catalog.planFeatures),
    overrides: asArray(overrides),
    consentVersions: asArray(catalog.consentVersions),
    accessVersion,
  };
  setCachedUserAccessData(userId, accessVersion, accessData);
  return cloneAccessData(accessData);
}

export async function resolveAccessForRequest(req, runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  const auth = await authenticateRequest(req, { runtime });
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile, runtime);
  return {
    ...auth,
    accessData,
    access: resolveUserAccess(accessData),
  };
}

export async function requireFeature(req, featureKey, context = {}, runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  const auth = await authenticateRequest(req, { runtime });
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile, runtime);
  const decision = resolveFeatureDecision(accessData, featureKey);
  if (!decision.allowed) {
    return {
      ...auth,
      ok: false,
      status: decision.status,
      reason: decision.reason,
      decision,
      accessData,
    };
  }

  if (context.adultMode) {
    const adultDecision = resolveFeatureDecision(accessData, ACCESS_FEATURES.ADULT_MODE);
    if (!adultDecision.allowed) {
      return {
        ...auth,
        ok: false,
        status: adultDecision.status,
        reason: adultDecision.reason,
        decision: adultDecision,
        accessData,
      };
    }
  }

  return {
    ...auth,
    ok: true,
    decision,
    accessData,
  };
}

export async function requireFeatures(req, featureKeys = [], runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  const auth = await authenticateRequest(req, { runtime });
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile, runtime);
  let lastDecision = null;
  for (const featureKey of featureKeys) {
    const decision = resolveFeatureDecision(accessData, featureKey);
    lastDecision = decision;
    if (!decision.allowed) {
      return {
        ...auth,
        ok: false,
        status: decision.status,
        reason: decision.reason,
        decision,
        accessData,
      };
    }
  }

  return {
    ...auth,
    ok: true,
    decision: lastDecision,
    accessData,
  };
}

export async function requireAdmin(req, role = SYSTEM_ROLES.ADMIN, runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  const auth = await authenticateRequest(req, { runtime });
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile, runtime);
  const decision = resolveAdminDecision(accessData, role);
  if (!decision.allowed) {
    return {
      ...auth,
      ok: false,
      status: decision.status,
      reason: decision.reason,
      decision,
      accessData,
    };
  }

  return {
    ...auth,
    ok: true,
    decision,
    accessData,
  };
}

export function sendAccessDenied(res, result) {
  const code = result?.reason || ACCESS_REASONS.FEATURE_NOT_ALLOWED;
  sendPublicError(null, res, result?.status || 403, {
    error: code,
    code,
  });
}

export async function logAdminAudit(supabase, req, {
  actorUserId,
  action,
  targetUserId = null,
  targetFeatureKey = null,
  before = {},
  after = {},
} = {}) {
  const { error } = await supabase.from('admin_audit_logs').insert({
    actor_user_id: actorUserId,
    action,
    target_user_id: targetUserId,
    target_feature_key: targetFeatureKey,
    before_json: before || {},
    after_json: after || {},
    ip_address: getClientIp(req),
    user_agent: getUserAgent(req),
  });
  if (error) {
    const auditError = new Error(error.message || 'ADMIN_AUDIT_INSERT_FAILED');
    auditError.code = error.code || 'ADMIN_AUDIT_INSERT_FAILED';
    throw auditError;
  }
}
