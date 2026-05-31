export const ADMIN_ROLES = {
  USER: 'user',
  SUPPORT: 'support',
  ADMIN: 'admin',
  OWNER: 'owner',
};

export const ADMIN_PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_PLAN_UPDATE: 'users.plan.update',
  USERS_STATUS_UPDATE: 'users.status.update',
  USERS_ROLE_UPDATE: 'users.role.update',
  USERS_OVERRIDE_UPDATE: 'users.override.update',
  FEATURES_READ: 'features.read',
  FEATURES_WRITE: 'features.write',
  PLAN_FEATURES_READ: 'plan_features.read',
  PLAN_FEATURES_WRITE: 'plan_features.write',
  CATALOG_READ: 'catalog.read',
  CATALOG_WRITE: 'catalog.write',
  AUDIT_READ: 'audit.read',
  USAGE_READ: 'usage.read',
  CONSENT_READ: 'consent.read',
  CONSENT_WRITE: 'consent.write',
  ADMIN_SYNC_AUTH: 'admin.sync_auth',
};

export const ROLE_LABELS_VI = {
  [ADMIN_ROLES.USER]: 'Người dùng',
  [ADMIN_ROLES.SUPPORT]: 'Hỗ trợ',
  [ADMIN_ROLES.ADMIN]: 'Quản trị',
  [ADMIN_ROLES.OWNER]: 'Chủ sở hữu',
};

export const STATUS_LABELS_VI = {
  active: 'Đang hoạt động',
  suspended: 'Tạm khóa',
  disabled: 'Vô hiệu hóa',
};

export const PLAN_LABELS_VI = {
  free: 'Miễn phí',
  vip: 'VIP',
  pro: 'Pro',
  enterprise: 'Doanh nghiệp',
};

const ROLE_RANK = {
  [ADMIN_ROLES.USER]: 0,
  [ADMIN_ROLES.SUPPORT]: 1,
  [ADMIN_ROLES.ADMIN]: 2,
  [ADMIN_ROLES.OWNER]: 3,
};

const ROLE_PERMISSIONS = {
  [ADMIN_ROLES.USER]: [],
  [ADMIN_ROLES.SUPPORT]: [
    ADMIN_PERMISSIONS.USERS_READ,
    ADMIN_PERMISSIONS.FEATURES_READ,
    ADMIN_PERMISSIONS.PLAN_FEATURES_READ,
    ADMIN_PERMISSIONS.CATALOG_READ,
    ADMIN_PERMISSIONS.AUDIT_READ,
    ADMIN_PERMISSIONS.USAGE_READ,
    ADMIN_PERMISSIONS.CONSENT_READ,
  ],
  [ADMIN_ROLES.ADMIN]: [
    ADMIN_PERMISSIONS.USERS_READ,
    ADMIN_PERMISSIONS.USERS_PLAN_UPDATE,
    ADMIN_PERMISSIONS.USERS_STATUS_UPDATE,
    ADMIN_PERMISSIONS.FEATURES_READ,
    ADMIN_PERMISSIONS.FEATURES_WRITE,
    ADMIN_PERMISSIONS.PLAN_FEATURES_READ,
    ADMIN_PERMISSIONS.PLAN_FEATURES_WRITE,
    ADMIN_PERMISSIONS.CATALOG_READ,
    ADMIN_PERMISSIONS.CATALOG_WRITE,
    ADMIN_PERMISSIONS.AUDIT_READ,
    ADMIN_PERMISSIONS.USAGE_READ,
    ADMIN_PERMISSIONS.CONSENT_READ,
    ADMIN_PERMISSIONS.CONSENT_WRITE,
    ADMIN_PERMISSIONS.ADMIN_SYNC_AUTH,
  ],
  [ADMIN_ROLES.OWNER]: Object.values(ADMIN_PERMISSIONS),
};

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return Object.values(ADMIN_ROLES).includes(value) ? value : ADMIN_ROLES.USER;
}

export function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS_VI, value) ? value : 'active';
}

export function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();
  return value || 'free';
}

export function roleRank(role) {
  return ROLE_RANK[normalizeRole(role)] || 0;
}

export function getRolePermissions(role) {
  return [...(ROLE_PERMISSIONS[normalizeRole(role)] || [])];
}

export function hasPermission(roleOrSubject, permission) {
  const permissions = typeof roleOrSubject === 'object' && roleOrSubject
    ? roleOrSubject.permissions || getRolePermissions(roleOrSubject.role)
    : getRolePermissions(roleOrSubject);
  return permissions.includes(permission);
}

function roleCandidatesFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeRole);
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/u)
      .map(normalizeRole);
  }
  return [];
}

function pickStrongestRole(roles) {
  return roles
    .map(normalizeRole)
    .sort((left, right) => roleRank(right) - roleRank(left))[0] || ADMIN_ROLES.USER;
}

export function resolveAccessSubject(input = {}) {
  const appMetadata = input.app_metadata || input.appMetadata || {};
  const userMetadata = input.user_metadata || input.userMetadata || {};
  const roles = [
    input.role,
    input.storyforge_role,
    appMetadata.role,
    appMetadata.storyforge_role,
    appMetadata.admin_role,
    userMetadata.role,
    userMetadata.storyforge_role,
    ...roleCandidatesFrom(input.roles),
    ...roleCandidatesFrom(appMetadata.roles),
    ...roleCandidatesFrom(userMetadata.roles),
  ].filter(Boolean);
  const role = pickStrongestRole(roles);

  return {
    id: String(input.id || input.sub || input.user_id || '').trim(),
    email: String(input.email || '').trim(),
    role,
    permissions: getRolePermissions(role),
  };
}

function denial(status, code, message) {
  return { ok: false, status, code, message };
}

export function canUpdateUserRole({
  actor,
  targetUserId,
  currentRole = ADMIN_ROLES.USER,
  nextRole = ADMIN_ROLES.USER,
  ownerCount = 0,
} = {}) {
  const subject = resolveAccessSubject(actor);
  const targetId = String(targetUserId || '').trim();
  const current = normalizeRole(currentRole);
  const next = normalizeRole(nextRole);

  if (!hasPermission(subject, ADMIN_PERMISSIONS.USERS_ROLE_UPDATE)) {
    return denial(403, 'ADMIN_PERMISSION_DENIED', 'Bạn không có quyền thay đổi vai trò người dùng.');
  }

  if (subject.id && targetId && subject.id === targetId && roleRank(next) < roleRank(subject.role)) {
    return denial(400, 'SELF_ROLE_DOWNGRADE_BLOCKED', 'Không thể tự hạ quyền hoặc khóa quyền quản trị của chính mình.');
  }

  if (current === ADMIN_ROLES.OWNER && next !== ADMIN_ROLES.OWNER && Number(ownerCount || 0) <= 1) {
    return denial(409, 'LAST_OWNER_BLOCKED', 'Không thể hạ quyền owner cuối cùng.');
  }

  return { ok: true };
}

export function canUpdateUserStatus({
  actor,
  targetUserId,
  nextStatus = 'active',
} = {}) {
  const subject = resolveAccessSubject(actor);
  const targetId = String(targetUserId || '').trim();
  const status = normalizeStatus(nextStatus);

  if (!hasPermission(subject, ADMIN_PERMISSIONS.USERS_STATUS_UPDATE)) {
    return denial(403, 'ADMIN_PERMISSION_DENIED', 'Bạn không có quyền thay đổi trạng thái người dùng.');
  }

  if (subject.id && targetId && subject.id === targetId && status !== 'active') {
    return denial(400, 'SELF_STATUS_LOCK_BLOCKED', 'Không thể tự khóa hoặc vô hiệu hóa tài khoản của chính mình.');
  }

  return { ok: true };
}

export function accessDenied(permission) {
  return denial(403, 'ADMIN_PERMISSION_DENIED', `Bạn thiếu quyền ${permission}.`);
}
