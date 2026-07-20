import {
  ACCESS_REASONS,
  FEATURE_LABELS_VI,
  PLAN_LABELS_VI,
  ROLE_LABELS_VI,
  STATUS_LABELS_VI,
  normalizeVipPageContent,
} from '@storyforge/access';

export function formatDate(value) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

export function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function getUserId(user) {
  return user?.user_id || user?.id || '';
}

export function getUserEmail(user) {
  return user?.email || user?.user_email || 'Chưa có email';
}

export function getPlanKey(value) {
  if (!value) return 'free';
  if (typeof value === 'string') return value.toLowerCase();
  return String(value.key || value.plan_key || value.plans?.key || 'free').toLowerCase();
}

export function getPlanLabel(plan) {
  const key = getPlanKey(plan);
  return PLAN_LABELS_VI[key] || key;
}

export function getUserPlans(user) {
  return Array.isArray(user?.user_plans) ? user.user_plans : [];
}

export function getPlanTimestamp(plan) {
  const value = plan?.starts_at || plan?.created_at || plan?.expires_at;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function getVisibleUserPlans(user) {
  return [...getUserPlans(user)]
    .sort((left, right) => getPlanTimestamp(right) - getPlanTimestamp(left))
    .slice(0, 5);
}

export function getUserPlanStatusLabel(plan) {
  if (!plan) return 'Free';
  const status = String(plan.status || 'active').toLowerCase();
  const expiresAt = plan.expires_at ? new Date(plan.expires_at).getTime() : null;
  if (status === 'active' && expiresAt && expiresAt <= Date.now()) return 'Đã hết hạn';
  if (status === 'active') return 'Đang hiệu lực';
  if (status === 'scheduled') return 'Đã đặt lịch';
  if (status === 'canceled' || status === 'cancelled') return 'Đã hủy';
  return getStatusLabel(status);
}

export function getUserPlanStatusTone(plan) {
  if (!plan) return 'neutral';
  const status = String(plan.status || 'active').toLowerCase();
  const expiresAt = plan.expires_at ? new Date(plan.expires_at).getTime() : null;
  if (status === 'active' && expiresAt && expiresAt <= Date.now()) return 'danger';
  if (status === 'active') return 'success';
  if (status === 'scheduled') return 'info';
  if (status === 'canceled' || status === 'cancelled') return 'danger';
  return 'neutral';
}

export function getUserPlanExpiryLabel(plan) {
  if (!plan) return 'Chưa có gói VIP đang hoạt động';
  if (!plan.expires_at) return 'Không hết hạn';
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return String(plan.expires_at);
  const label = formatDate(plan.expires_at);
  return expiresAt <= Date.now() ? `Đã hết hạn ${label}` : label;
}

export function getUserPlanExpiryShortLabel(plan) {
  if (!plan) return 'Chưa có VIP';
  if (!plan.expires_at) return 'Không hết hạn';
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return String(plan.expires_at);
  const label = formatDate(plan.expires_at);
  return expiresAt <= Date.now() ? `Đã hết hạn ${label}` : label;
}

export function isActivePlanExpiringSoon(plan, days = 7) {
  if (!plan?.expires_at) return false;
  const expiresAt = new Date(plan.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return false;
  const now = Date.now();
  return expiresAt > now && expiresAt <= now + (days * 24 * 60 * 60 * 1000);
}

export function matchesUserPlanExpiryFilter(user, filter = 'all') {
  if (filter === 'all') return true;
  const days = filter === 'expiring_7' ? 7 : filter === 'expiring_30' ? 30 : 0;
  return days > 0 && isActivePlanExpiringSoon(getActiveUserPlan(user), days);
}

export function sortUsersByPlanExpiry(users) {
  return [...users].sort((left, right) => (
    new Date(getActiveUserPlan(left)?.expires_at).getTime()
    - new Date(getActiveUserPlan(right)?.expires_at).getTime()
  ));
}

export function getUserManagementStats(users) {
  const source = Array.isArray(users) ? users : [];
  return {
    vip: source.filter((user) => ['vip', 'lifetime'].includes(getCurrentUserPlanKey(user))).length,
    expiringSoon: source.filter((user) => isActivePlanExpiringSoon(getActiveUserPlan(user))).length,
    locked: source.filter((user) => String(user.status || 'active').toLowerCase() !== 'active').length,
  };
}

export function getRoleLabel(role) {
  return ROLE_LABELS_VI[String(role || 'user').toLowerCase()] || 'Người dùng';
}

export function getStatusLabel(status) {
  return STATUS_LABELS_VI[String(status || 'active').toLowerCase()] || String(status || 'active');
}

export function getFeatureKey(item) {
  return item?.feature_key || item?.featureKey || item?.key || '';
}

export function getFeatureName(data, featureKey) {
  const feature = data.features.find((item) => getFeatureKey(item) === featureKey);
  return feature?.name || FEATURE_LABELS_VI[featureKey] || featureKey;
}

export function getPlanFeaturePlanKey(item) {
  return String(item?.plans?.key || item?.plan_key || item?.plan || '').toLowerCase();
}

export function getPlanFeatureRows(data, planKey) {
  return data.planFeatures
    .filter((item) => getPlanFeaturePlanKey(item) === String(planKey || '').toLowerCase())
    .sort((left, right) => String(getFeatureKey(left)).localeCompare(String(getFeatureKey(right)), 'vi'));
}

export function getActiveUserPlan(user) {
  const plans = getUserPlans(user);
  const now = Date.now();
  return plans
    .filter((item) => String(item.status || '').toLowerCase() === 'active')
    .filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now)
    .sort((left, right) => new Date(right.starts_at || right.created_at || 0) - new Date(left.starts_at || left.created_at || 0))[0] || null;
}

export function getCurrentUserPlanKey(user) {
  return user?.plan || getPlanKey(getActiveUserPlan(user));
}

export function summarizeLimits(limits) {
  const source = limits && typeof limits === 'object' ? limits : {};
  const pairs = Object.entries(source).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (pairs.length === 0) return 'Không giới hạn riêng';
  return pairs
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
}

export function getPlanMetadata(plan) {
  return plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
    ? plan.metadata
    : {};
}

export function getPlanVipPageContent(plan) {
  return normalizeVipPageContent(getPlanMetadata(plan).vipPage);
}

export function explainDecision(decision) {
  if (!decision) return 'Chưa tải quyền';
  if (decision.allowed && decision.source === 'plan') {
    return `Mở theo gói ${getPlanLabel(decision.detail)}`;
  }
  if (decision.allowed && decision.source === 'override_grant') {
    return 'Mở bằng cấp riêng';
  }
  if (decision.allowed) return 'Quyền đang mở';

  switch (decision.reason) {
    case ACCESS_REASONS.AUTH_REQUIRED:
      return 'Chưa đăng nhập';
    case ACCESS_REASONS.USER_BANNED:
      return 'Tài khoản đang bị khóa';
    case ACCESS_REASONS.FEATURE_DISABLED:
      return 'Tính năng đang tắt';
    case ACCESS_REASONS.OVERRIDE_BLOCKED:
      return 'Bị chặn riêng';
    case ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED:
    case ACCESS_REASONS.ADULT_TERMS_REQUIRED:
    case ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED:
      return 'Cần xác nhận 18+';
    default:
      return 'Thiếu VIP hoặc gói chưa mở tính năng';
  }
}

export function getIdentityLabel(identity, fallback) {
  if (!identity) return fallback;
  if (identity.email) return identity.email;
  if (identity.displayName) return identity.displayName;
  if (identity.label && identity.label !== identity.id) return identity.label;
  return fallback;
}

export function getIdentityMeta(identity) {
  if (!identity) return '';
  const parts = [identity.roleLabel, identity.statusLabel].filter(Boolean);
  return parts.join(' · ');
}

export function getAuditActorLabel(item) {
  return getIdentityLabel(item.actor, item.actor_email || 'Không rõ người thực hiện');
}

export function getAuditTargetLabel(data, item) {
  if (item.target_user_id) {
    return getIdentityLabel(item.target, item.target_email || 'Không rõ người dùng');
  }
  if (item.target_feature_key) return getFeatureName(data, item.target_feature_key);
  return item.resource_label || 'Hệ thống';
}

export function getAuditSummary(item) {
  return item.summary || item.action_summary || item.action || 'Thao tác quản trị';
}

export function getAuditDetails(item) {
  return item.details || item.change_summary || 'Chưa có mô tả thay đổi.';
}

export function getAuditStatusLabel(item) {
  return item.statusLabel || item.status_label || 'Đã ghi nhận';
}

export function getAuditKey(item) {
  return item.id || `${item.action || 'audit'}-${item.created_at || ''}`;
}

export function getUsageUserLabel(item) {
  return getIdentityLabel(item.user, item.email || 'Không rõ người dùng');
}

export function getUsageTaskLabel(item) {
  return item.taskLabel || item.feature_key || 'Tác vụ AI';
}

export function getUsageProviderLabel(item) {
  return item.providerLabel || item.provider || 'Không rõ provider';
}

export function getUsageStatusLabel(item) {
  return item.statusLabel || item.status || 'Không rõ';
}

export function toPrettyJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}
