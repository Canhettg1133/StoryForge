import {
  ACCESS_REASONS,
  FEATURE_LABELS_VI,
} from './accessControl.js';

const PLAN_LABELS_VI = {
  free: 'Miễn phí',
  vip: 'VIP',
  lifetime: 'Trọn đời',
};

export function getPlanDisplayName(planOrKey) {
  const key = typeof planOrKey === 'string'
    ? planOrKey
    : planOrKey?.key || planOrKey?.plan_key || '';
  return PLAN_LABELS_VI[String(key || 'free').toLowerCase()] || String(key || 'Miễn phí');
}

export function getFeatureDisplayName(featureKey) {
  return FEATURE_LABELS_VI[featureKey] || String(featureKey || '');
}

export function getAccessDecisionLabel(decision) {
  if (decision?.allowed) return 'Đang mở';
  switch (decision?.reason) {
    case ACCESS_REASONS.AUTH_REQUIRED:
      return 'Cần đăng nhập';
    case ACCESS_REASONS.USER_BANNED:
      return 'Tài khoản bị khóa';
    case ACCESS_REASONS.FEATURE_DISABLED:
      return 'Tính năng đang tắt';
    case ACCESS_REASONS.OVERRIDE_BLOCKED:
      return 'Bị chặn riêng';
    case ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED:
      return 'Cần xác nhận đủ 18 tuổi';
    case ACCESS_REASONS.ADULT_TERMS_REQUIRED:
      return 'Cần đồng ý điều khoản 18+';
    case ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED:
      return 'Cần đồng ý lại điều khoản 18+';
    default:
      return 'Cần VIP';
  }
}
