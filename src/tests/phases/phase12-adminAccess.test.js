import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  PLAN_LABELS_VI,
  STATUS_LABELS_VI,
  canUpdateUserRole,
  canUpdateUserStatus,
  hasPermission,
  resolveAccessSubject,
} from '../../../packages/access/src/index.js';

describe('phase12 admin access package', () => {
  it('maps role permissions without treating support as a mutating admin', () => {
    expect(hasPermission('support', ADMIN_PERMISSIONS.USERS_READ)).toBe(true);
    expect(hasPermission('support', ADMIN_PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(hasPermission('support', ADMIN_PERMISSIONS.STORY_MIRROR_READ)).toBe(true);
    expect(hasPermission('support', ADMIN_PERMISSIONS.STORY_MIRROR_CONTENT_READ)).toBe(false);
    expect(hasPermission('support', ADMIN_PERMISSIONS.STORY_MIRROR_EXPORT)).toBe(false);
    expect(hasPermission('support', ADMIN_PERMISSIONS.USERS_PLAN_UPDATE)).toBe(false);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.USERS_PLAN_UPDATE)).toBe(true);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.STORY_MIRROR_CONTENT_READ)).toBe(true);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.STORY_MIRROR_EXPORT)).toBe(false);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.STORY_MIRROR_WRITE)).toBe(false);
    expect(hasPermission('support', ADMIN_PERMISSIONS.PROMPTS_READ)).toBe(false);
    expect(hasPermission('support', ADMIN_PERMISSIONS.PROMPTS_WRITE)).toBe(false);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.PROMPTS_READ)).toBe(false);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.PROMPTS_WRITE)).toBe(false);
    expect(hasPermission('owner', ADMIN_PERMISSIONS.PROMPTS_READ)).toBe(true);
    expect(hasPermission('owner', ADMIN_PERMISSIONS.PROMPTS_WRITE)).toBe(true);
    expect(hasPermission('owner', ADMIN_PERMISSIONS.STORY_MIRROR_EXPORT)).toBe(true);
    expect(hasPermission('owner', ADMIN_PERMISSIONS.USERS_ROLE_UPDATE)).toBe(true);
  });

  it('resolves admin roles from app metadata but ignores user metadata role claims', () => {
    const subject = resolveAccessSubject({
      id: 'actor-1',
      email: 'admin@example.com',
      app_metadata: { storyforge_role: 'support' },
      user_metadata: { role: 'admin' },
    });

    expect(subject).toMatchObject({
      id: 'actor-1',
      email: 'admin@example.com',
      role: 'support',
    });
    expect(subject.permissions).toContain(ADMIN_PERMISSIONS.USERS_READ);
    expect(subject.permissions).not.toContain(ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
  });

  it('does not grant admin access from user metadata alone', () => {
    const subject = resolveAccessSubject({
      id: 'actor-2',
      email: 'claimed-owner@example.com',
      user_metadata: {
        role: 'owner',
        system_role: 'admin',
        storyforge_role: 'support',
        roles: ['owner'],
      },
    });

    expect(subject).toMatchObject({
      id: 'actor-2',
      email: 'claimed-owner@example.com',
      role: 'user',
    });
    expect(subject.permissions).toEqual([]);
  });

  it('blocks self-demotion for privileged users', () => {
    const result = canUpdateUserRole({
      actor: resolveAccessSubject({ id: 'owner-1', app_metadata: { role: 'owner' } }),
      targetUserId: 'owner-1',
      currentRole: 'owner',
      nextRole: 'admin',
      ownerCount: 2,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SELF_ROLE_DOWNGRADE_BLOCKED',
      status: 400,
    });
  });

  it('blocks removing the final owner', () => {
    const result = canUpdateUserRole({
      actor: resolveAccessSubject({ id: 'owner-1', app_metadata: { role: 'owner' } }),
      targetUserId: 'owner-2',
      currentRole: 'owner',
      nextRole: 'admin',
      ownerCount: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'LAST_OWNER_BLOCKED',
      status: 409,
    });
  });

  it('blocks self-locking through status updates', () => {
    const result = canUpdateUserStatus({
      actor: resolveAccessSubject({ id: 'admin-1', app_metadata: { role: 'admin' } }),
      targetUserId: 'admin-1',
      nextStatus: 'banned',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SELF_STATUS_LOCK_BLOCKED',
      status: 400,
    });
  });

  it('keeps the canonical VIP catalog labels only', () => {
    expect(Object.keys(PLAN_LABELS_VI)).toEqual(['free', 'vip', 'lifetime']);
    expect(PLAN_LABELS_VI).not.toHaveProperty('pro');
    expect(PLAN_LABELS_VI).not.toHaveProperty('enterprise');
    expect(STATUS_LABELS_VI).toMatchObject({
      active: 'Đang hoạt động',
      banned: 'Đã khóa',
      deleted: 'Đã xóa',
    });
  });
});
