export const ACCESS_FEATURES = {
  TRANSLATOR_ACCESS: 'translator.access',
  AI_CHAT_ACCESS: 'ai_chat.access',
  ADULT_MODE: 'content.adult_mode',
  AG_PROXY: 'provider.ag_proxy',
  AI_STUDIO_RELAY: 'provider.ai_studio_relay',
  GEMINI_DIRECT: 'provider.gemini_direct',
  CUSTOM_PROXY: 'provider.custom_proxy',
  TRANSLATOR_PARALLEL_HIGH: 'translator.parallel_high',
  TRANSLATOR_BULK_KEYS: 'translator.bulk_keys',
  STORY_MIRROR_ACCESS: 'story_mirror.access',
  PROJECT_COVER_GENERATION: 'project.cover_generation',
};

export const ACCESS_REASONS = {
  ALLOWED: 'ALLOWED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  USER_BANNED: 'USER_BANNED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  FEATURE_NOT_ALLOWED: 'FEATURE_NOT_ALLOWED',
  OVERRIDE_BLOCKED: 'OVERRIDE_BLOCKED',
  PLAN_REQUIRED: 'PLAN_REQUIRED',
  AGE_CONFIRMATION_REQUIRED: 'AGE_CONFIRMATION_REQUIRED',
  ADULT_TERMS_REQUIRED: 'ADULT_TERMS_REQUIRED',
  ADULT_TERMS_VERSION_OUTDATED: 'ADULT_TERMS_VERSION_OUTDATED',
  ADMIN_REQUIRED: 'ADMIN_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
};

export const SYSTEM_ROLES = {
  USER: 'user',
  SUPPORT: 'support',
  ADMIN: 'admin',
  OWNER: 'owner',
};

export const USER_STATUSES = {
  ACTIVE: 'active',
  BANNED: 'banned',
  DELETED: 'deleted',
};

export const PLAN_STATUSES = {
  ACTIVE: 'active',
  SCHEDULED: 'scheduled',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

export const DEFAULT_FEATURE_LIMITS = Object.freeze({});

export const DEFAULT_ACCESS_DECISION = Object.freeze({
  allowed: false,
  status: 401,
  reason: ACCESS_REASONS.AUTH_REQUIRED,
  feature: '',
  limits: DEFAULT_FEATURE_LIMITS,
});

export const ADMIN_ROLE_RANK = {
  [SYSTEM_ROLES.USER]: 0,
  [SYSTEM_ROLES.SUPPORT]: 1,
  [SYSTEM_ROLES.ADMIN]: 2,
  [SYSTEM_ROLES.OWNER]: 3,
};

export const FEATURE_LABELS_VI = {
  [ACCESS_FEATURES.TRANSLATOR_ACCESS]: 'Dịch truyện',
  [ACCESS_FEATURES.AI_CHAT_ACCESS]: 'Chat AI',
  [ACCESS_FEATURES.ADULT_MODE]: 'Chế độ 18+',
  [ACCESS_FEATURES.AG_PROXY]: 'Gemini Proxy AG',
  [ACCESS_FEATURES.AI_STUDIO_RELAY]: 'AI Studio Relay',
  [ACCESS_FEATURES.GEMINI_DIRECT]: 'Gemini Direct',
  [ACCESS_FEATURES.CUSTOM_PROXY]: 'Proxy tùy chỉnh',
  [ACCESS_FEATURES.TRANSLATOR_PARALLEL_HIGH]: 'Dịch song song tốc độ cao',
  [ACCESS_FEATURES.TRANSLATOR_BULK_KEYS]: 'Nhập nhiều API key',
  [ACCESS_FEATURES.STORY_MIRROR_ACCESS]: 'Đồng bộ Story Mirror',
  [ACCESS_FEATURES.PROJECT_COVER_GENERATION]: 'Tạo bìa AI',
};

const PLAN_PRIORITY = {
  lifetime: 300,
  vip: 200,
  free: 100,
};

export function createAccessDecision({
  allowed = false,
  status = allowed ? 200 : 403,
  reason = allowed ? ACCESS_REASONS.ALLOWED : ACCESS_REASONS.FEATURE_NOT_ALLOWED,
  feature = '',
  limits = DEFAULT_FEATURE_LIMITS,
  source = '',
  detail = '',
} = {}) {
  return {
    allowed: Boolean(allowed),
    status,
    reason,
    feature,
    limits: limits && typeof limits === 'object' ? limits : DEFAULT_FEATURE_LIMITS,
    ...(source ? { source } : {}),
    ...(detail ? { detail } : {}),
  };
}

function toTime(value, fallback = 0) {
  if (!value) return fallback;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function isFutureOrOpen(value, nowMs) {
  if (!value) return true;
  return toTime(value, 0) > nowMs;
}

function isPastOrNow(value, nowMs) {
  if (!value) return true;
  return toTime(value, 0) <= nowMs;
}

function normalizeKey(value) {
  return String(value || '').trim();
}

function getFeatureKey(row) {
  return normalizeKey(row?.feature_key || row?.key);
}

function getPlanKey(row) {
  return normalizeKey(row?.plan_key || row?.key || row?.plans?.key || row?.plan_id);
}

function compareOverridesDesc(a, b) {
  const createdDiff = toTime(b?.created_at, 0) - toTime(a?.created_at, 0);
  if (createdDiff !== 0) return createdDiff;
  return normalizeKey(b?.id).localeCompare(normalizeKey(a?.id));
}

function getFeatureCatalogEntry(accessData, featureKey) {
  const features = Array.isArray(accessData?.features) ? accessData.features : [];
  return features.find((feature) => getFeatureKey(feature) === featureKey) || null;
}

function getLatestActiveOverride(accessData, featureKey, nowMs) {
  return (Array.isArray(accessData?.overrides) ? accessData.overrides : [])
    .filter((override) => getFeatureKey(override) === featureKey)
    .filter((override) => !override.revoked_at)
    .filter((override) => isFutureOrOpen(override.expires_at, nowMs))
    .sort(compareOverridesDesc)[0] || null;
}

function getActivePlans(accessData, nowMs) {
  const explicit = accessData?.activePlans || accessData?.active_plans;
  if (Array.isArray(explicit)) return explicit;

  const singleExplicit = accessData?.activePlan || accessData?.active_plan;
  if (singleExplicit) return [singleExplicit];

  return (Array.isArray(accessData?.userPlans) ? accessData.userPlans : [])
    .filter((plan) => normalizeKey(plan.status) === PLAN_STATUSES.ACTIVE)
    .filter((plan) => isPastOrNow(plan.starts_at, nowMs))
    .filter((plan) => isFutureOrOpen(plan.expires_at, nowMs))
    .sort((a, b) => {
      const priorityDiff = (PLAN_PRIORITY[getPlanKey(b)] || 0) - (PLAN_PRIORITY[getPlanKey(a)] || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return toTime(b?.starts_at || b?.created_at, 0) - toTime(a?.starts_at || a?.created_at, 0);
    });
}

function getPrimaryActivePlan(accessData, nowMs) {
  return getActivePlans(accessData, nowMs)[0] || null;
}

function getPlanFeature(accessData, plan, featureKey) {
  if (!plan) return null;
  const planId = normalizeKey(plan.plan_id || plan.id);
  const planKey = getPlanKey(plan);

  return (Array.isArray(accessData?.planFeatures) ? accessData.planFeatures : [])
    .find((item) => {
      const itemPlanId = normalizeKey(item.plan_id);
      const itemPlanKey = getPlanKey(item);
      return getFeatureKey(item) === featureKey
        && (
          (planId && itemPlanId === planId)
          || (planKey && itemPlanKey === planKey)
        );
    }) || null;
}

function getCurrentConsentVersion(accessData, consentKey) {
  const versions = accessData?.currentConsentVersions || accessData?.current_consent_versions;
  if (versions && typeof versions === 'object' && !Array.isArray(versions)) {
    return normalizeKey(versions[consentKey]);
  }

  return (Array.isArray(accessData?.consentVersions) ? accessData.consentVersions : [])
    .filter((item) => normalizeKey(item.key) === consentKey)
    .find((item) => item.active)?.version || '';
}

function applyAdultConsentDecision(decision, accessData, featureKey) {
  if (!decision.allowed || featureKey !== ACCESS_FEATURES.ADULT_MODE) return decision;

  const profile = accessData?.profile || accessData?.user || {};
  if (!profile.age_confirmed_at) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED,
      feature: featureKey,
      source: decision.source,
    });
  }

  if (!profile.adult_terms_accepted_at) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.ADULT_TERMS_REQUIRED,
      feature: featureKey,
      source: decision.source,
    });
  }

  const currentVersion = getCurrentConsentVersion(accessData, 'adult_terms');
  if (currentVersion && normalizeKey(profile.adult_terms_version) !== currentVersion) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED,
      feature: featureKey,
      source: decision.source,
    });
  }

  return decision;
}

export function resolveFeatureDecision(accessData = {}, featureKeyInput) {
  const featureKey = normalizeKey(featureKeyInput);
  if (!accessData?.authenticated) {
    return createAccessDecision({
      allowed: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      feature: featureKey,
    });
  }

  const profile = accessData.profile || accessData.user || {};
  if ([USER_STATUSES.BANNED, USER_STATUSES.DELETED].includes(normalizeKey(profile.status))) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.USER_BANNED,
      feature: featureKey,
    });
  }

  const feature = getFeatureCatalogEntry(accessData, featureKey);
  if (!feature || feature.active === false) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.FEATURE_DISABLED,
      feature: featureKey,
      source: 'catalog',
    });
  }

  const nowMs = toTime(accessData.now, Date.now());
  const override = getLatestActiveOverride(accessData, featureKey, nowMs);
  if (override) {
    const decision = createAccessDecision({
      allowed: Boolean(override.enabled),
      status: override.enabled ? 200 : 403,
      reason: override.enabled ? ACCESS_REASONS.ALLOWED : ACCESS_REASONS.OVERRIDE_BLOCKED,
      feature: featureKey,
      limits: override.limit_json || override.limits_json || DEFAULT_FEATURE_LIMITS,
      source: override.enabled ? 'override_grant' : 'override_block',
      detail: override.reason || '',
    });
    return applyAdultConsentDecision(decision, accessData, featureKey);
  }

  const activePlans = getActivePlans(accessData, nowMs);
  const matchingPlan = activePlans.find((plan) => getPlanFeature(accessData, plan, featureKey)?.enabled);
  const planFeature = getPlanFeature(accessData, matchingPlan, featureKey);
  if (matchingPlan && planFeature?.enabled) {
    const decision = createAccessDecision({
      allowed: true,
      status: 200,
      reason: ACCESS_REASONS.ALLOWED,
      feature: featureKey,
      limits: planFeature.limit_json || planFeature.limits_json || DEFAULT_FEATURE_LIMITS,
      source: 'plan',
      detail: getPlanKey(matchingPlan),
    });
    return applyAdultConsentDecision(decision, accessData, featureKey);
  }

  return createAccessDecision({
    allowed: false,
    status: 403,
    reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    feature: featureKey,
  });
}

export function resolveAdminDecision(accessData = {}, requiredRole = SYSTEM_ROLES.ADMIN) {
  if (!accessData?.authenticated) {
    return createAccessDecision({
      allowed: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      feature: 'admin',
    });
  }

  const profile = accessData.profile || accessData.user || {};
  if ([USER_STATUSES.BANNED, USER_STATUSES.DELETED].includes(normalizeKey(profile.status))) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.USER_BANNED,
      feature: 'admin',
    });
  }

  const currentRank = ADMIN_ROLE_RANK[normalizeKey(profile.system_role)] || 0;
  const requiredRank = ADMIN_ROLE_RANK[normalizeKey(requiredRole)] || ADMIN_ROLE_RANK[SYSTEM_ROLES.ADMIN];
  if (currentRank < requiredRank) {
    return createAccessDecision({
      allowed: false,
      status: 403,
      reason: ACCESS_REASONS.ADMIN_REQUIRED,
      feature: 'admin',
    });
  }

  return createAccessDecision({
    allowed: true,
    status: 200,
    reason: ACCESS_REASONS.ALLOWED,
    feature: 'admin',
    source: 'role',
  });
}

export function resolveUserAccess(accessData = {}, featureKeys = Object.values(ACCESS_FEATURES)) {
  const features = {};
  for (const featureKey of featureKeys) {
    features[featureKey] = resolveFeatureDecision(accessData, featureKey);
  }

  const profile = accessData.profile || accessData.user || {};
  const nowMs = toTime(accessData.now, Date.now());
  const activePlans = getActivePlans(accessData, nowMs);
  const activePlan = activePlans[0] || null;
  const mapPlan = (plan) => ({
    id: plan.plan_id || plan.id || null,
    key: getPlanKey(plan),
    name: plan.plan_name || plan.plans?.name || '',
    status: normalizeKey(plan.status) || PLAN_STATUSES.ACTIVE,
    startsAt: plan.starts_at || null,
    expiresAt: plan.expires_at || null,
  });

  return {
    authenticated: Boolean(accessData.authenticated),
    user: accessData.authenticated
      ? {
        id: profile.user_id || profile.id || accessData.userId || null,
        email: profile.email || '',
        displayName: profile.display_name || profile.displayName || '',
        systemRole: normalizeKey(profile.system_role) || SYSTEM_ROLES.USER,
        status: normalizeKey(profile.status) || USER_STATUSES.ACTIVE,
      }
      : null,
    plan: activePlan ? mapPlan(activePlan) : null,
    plans: activePlans.map(mapPlan),
    features,
    admin: resolveAdminDecision(accessData, SYSTEM_ROLES.ADMIN),
    accessVersion: accessData.accessVersion || accessData.access_version || 1,
  };
}

export function hasResolvedFeature(accessSnapshot, featureKey) {
  return Boolean(accessSnapshot?.features?.[featureKey]?.allowed);
}

export function getAccessDeniedMessage(decision) {
  const reason = decision?.reason || ACCESS_REASONS.FEATURE_NOT_ALLOWED;
  switch (reason) {
    case ACCESS_REASONS.AUTH_REQUIRED:
      return 'Bạn cần đăng nhập để dùng tính năng này.';
    case ACCESS_REASONS.USER_BANNED:
      return 'Tài khoản này đang bị khóa quyền truy cập.';
    case ACCESS_REASONS.FEATURE_DISABLED:
      return 'Tính năng này đang tạm tắt trong hệ thống.';
    case ACCESS_REASONS.OVERRIDE_BLOCKED:
      return 'Bị chặn riêng cho tài khoản này. Hãy liên hệ admin nếu cần mở lại.';
    case ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED:
      return 'Bạn cần xác nhận đủ tuổi trước khi bật nội dung 18+.';
    case ACCESS_REASONS.ADULT_TERMS_REQUIRED:
      return 'Bạn cần đồng ý điều khoản 18+ trước khi dùng tính năng này.';
    case ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED:
      return 'Điều khoản 18+ đã được cập nhật. Bạn cần đồng ý lại để tiếp tục.';
    case ACCESS_REASONS.ADMIN_REQUIRED:
      return 'Bạn cần quyền admin để mở khu vực này.';
    case ACCESS_REASONS.RATE_LIMITED:
      return 'Bạn đang dùng quá nhanh. Hãy chờ một chút rồi thử lại.';
    default:
      return 'Tính năng này yêu cầu tài khoản VIP. Bạn có thể nhắn admin để mua và kích hoạt VIP.';
  }
}
