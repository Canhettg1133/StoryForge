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
import { getBearerToken, getClientIp, getUserAgent, sendJson } from './http.js';
import { getSupabaseAdminClient, getSupabaseAdminConfig } from './supabaseAdmin.js';

export { ACCESS_FEATURES, ACCESS_REASONS, SYSTEM_ROLES };

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

async function throwOnError(result, fallbackCode = 'SUPABASE_QUERY_FAILED') {
  if (result?.error) {
    const error = new Error(result.error.message || fallbackCode);
    error.code = result.error.code || fallbackCode;
    throw error;
  }
  return result?.data;
}

async function ensureProfile(supabase, user) {
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

export async function authenticateRequest(req, { ensureUserProfile = true } = {}) {
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

  const config = getSupabaseAdminConfig();
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

  const supabase = getSupabaseAdminClient();
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

  const profile = ensureUserProfile
    ? await ensureProfile(supabase, data.user)
    : null;

  return {
    ok: true,
    token,
    supabase,
    user: data.user,
    profile,
  };
}

export async function buildAccessData(supabase, user, profileInput = null) {
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
    throwOnError(await supabase.from('features').select('*')),
    throwOnError(
      await supabase
        .from('user_plans')
        .select('*, plans(key, name)')
        .eq('user_id', userId),
    ),
    throwOnError(await supabase.from('plan_features').select('*')),
    throwOnError(
      await supabase
        .from('user_entitlement_overrides')
        .select('*')
        .eq('user_id', userId),
    ),
    throwOnError(await supabase.from('consent_versions').select('*').eq('active', true)),
    throwOnError(
      await supabase
        .from('access_versions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
    ),
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
    accessVersion: accessVersion?.version || 1,
  };
}

export async function resolveAccessForRequest(req) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile);
  return {
    ...auth,
    accessData,
    access: resolveUserAccess(accessData),
  };
}

export async function requireFeature(req, featureKey, context = {}) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile);
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

export async function requireFeatures(req, featureKeys = []) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile);
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

export async function requireAdmin(req, role = SYSTEM_ROLES.ADMIN) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) return auth;

  const accessData = await buildAccessData(auth.supabase, auth.user, auth.profile);
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
  sendJson(res, result?.status || 403, {
    error: result?.reason || ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    code: result?.reason || ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    feature: result?.decision?.feature || '',
    decision: result?.decision || null,
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
