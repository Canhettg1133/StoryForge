import {
  ACCESS_REASONS,
  FEATURE_LABELS_VI,
  PLAN_STATUSES,
  SYSTEM_ROLES,
  USER_STATUSES,
} from '../../services/access/accessControl.js';

export const PLAN_LABELS_VI = {
  free: 'Miễn phí',
  vip: 'VIP',
  lifetime: 'Trọn đời',
};

export const PLAN_STATUS_LABELS_VI = {
  [PLAN_STATUSES.ACTIVE]: 'Đang hiệu lực',
  [PLAN_STATUSES.SCHEDULED]: 'Đã đặt lịch',
  [PLAN_STATUSES.EXPIRED]: 'Đã hết hạn',
  [PLAN_STATUSES.CANCELLED]: 'Đã hủy',
};

export const USER_STATUS_LABELS_VI = {
  [USER_STATUSES.ACTIVE]: 'Đang hoạt động',
  [USER_STATUSES.BANNED]: 'Đã khóa',
  [USER_STATUSES.DELETED]: 'Đã xóa',
};

export const SYSTEM_ROLE_LABELS_VI = {
  [SYSTEM_ROLES.USER]: 'Người dùng',
  [SYSTEM_ROLES.SUPPORT]: 'Hỗ trợ',
  [SYSTEM_ROLES.ADMIN]: 'Quản trị viên',
  [SYSTEM_ROLES.OWNER]: 'Chủ sở hữu',
};

export const ACCESS_REASON_LABELS_VI = {
  [ACCESS_REASONS.ALLOWED]: 'Cho phép',
  [ACCESS_REASONS.AUTH_REQUIRED]: 'Cần đăng nhập',
  [ACCESS_REASONS.USER_BANNED]: 'Tài khoản bị khóa',
  [ACCESS_REASONS.FEATURE_DISABLED]: 'Tính năng đang tắt',
  [ACCESS_REASONS.FEATURE_NOT_ALLOWED]: 'Chưa có quyền',
  [ACCESS_REASONS.OVERRIDE_BLOCKED]: 'Bị chặn riêng',
  [ACCESS_REASONS.PLAN_REQUIRED]: 'Cần gói phù hợp',
  [ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED]: 'Cần xác nhận đủ 18 tuổi',
  [ACCESS_REASONS.ADULT_TERMS_REQUIRED]: 'Cần đồng ý điều khoản 18+',
  [ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED]: 'Cần đồng ý lại điều khoản 18+',
  [ACCESS_REASONS.ADMIN_REQUIRED]: 'Cần quyền quản trị',
  [ACCESS_REASONS.RATE_LIMITED]: 'Đang bị giới hạn tốc độ',
};

const FEATURE_CATEGORY_LABELS_VI = {
  translator: 'Dịch truyện',
  ai: 'AI',
  content: 'Nội dung',
  provider: 'Nhà cung cấp',
  general: 'Chung',
};

const AUDIT_ACTION_LABELS_VI = {
  'profiles.sync_auth': 'Đồng bộ user Supabase Auth',
  'feature.create': 'Tạo tính năng',
  'feature.update': 'Cập nhật tính năng',
  'consent_version.upsert': 'Cập nhật điều khoản 18+',
  'plan_feature.upsert': 'Cập nhật tính năng trong gói',
  'feature_override.create': 'Tạo ngoại lệ quyền',
  'profile.status.update': 'Cập nhật trạng thái người dùng',
  'user_plan.set': 'Cập nhật gói',
  'user_plan.cancel_current': 'Hủy gói hiện tại',
  'user_plan.cancel_scheduled': 'Hủy gói đã đặt lịch',
};

export const ACCESS_SOURCE_LABELS_VI = {
  plan: 'Theo gói',
  override_grant: 'Ngoại lệ cấp quyền',
  override_block: 'Ngoại lệ chặn quyền',
  catalog: 'Catalog tạm tắt',
  role: 'Theo vai trò',
};

export function getPlanDisplayName(planOrKey) {
  if (typeof planOrKey === 'string') return PLAN_LABELS_VI[planOrKey] || planOrKey;
  const key = planOrKey?.key || planOrKey?.plan_key || planOrKey?.plans?.key || '';
  return PLAN_LABELS_VI[key] || planOrKey?.name || planOrKey?.plan_name || planOrKey?.plans?.name || key || 'Không rõ';
}

export function getPlanStatusLabel(status) {
  return PLAN_STATUS_LABELS_VI[status] || status || 'Không rõ';
}

export function getUserStatusLabel(status) {
  return USER_STATUS_LABELS_VI[status] || status || 'Không rõ';
}

export function getSystemRoleLabel(role) {
  return SYSTEM_ROLE_LABELS_VI[role] || role || 'Không rõ';
}

export function getFeatureDisplayName(featureOrKey) {
  const key = typeof featureOrKey === 'string' ? featureOrKey : featureOrKey?.key || featureOrKey?.feature_key || '';
  return FEATURE_LABELS_VI[key]
    || (typeof featureOrKey === 'object' ? featureOrKey?.name : '')
    || key
    || 'Không rõ';
}

export function getFeatureCategoryLabel(category) {
  return FEATURE_CATEGORY_LABELS_VI[category] || category || 'Chung';
}

export function getAccessDecisionLabel(decision = {}) {
  if (decision.allowed) return ACCESS_REASON_LABELS_VI[ACCESS_REASONS.ALLOWED];
  return ACCESS_REASON_LABELS_VI[decision.reason] || decision.reason || 'Không cho phép';
}

export function getAuditActionLabel(action) {
  return AUDIT_ACTION_LABELS_VI[action] || action || 'Không rõ';
}

export function getAccessSourceLabel(source) {
  return ACCESS_SOURCE_LABELS_VI[source] || source || 'Mặc định';
}

export function toDateTimeLocalInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function createDefaultPlanForm(now = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);
  return {
    planKey: 'vip',
    status: PLAN_STATUSES.ACTIVE,
    startsAt: '',
    expiresAt: toDateTimeLocalInput(expiresAt),
  };
}
