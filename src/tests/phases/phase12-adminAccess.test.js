import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  canUpdateUserRole,
  canUpdateUserStatus,
  hasPermission,
  resolveAccessSubject,
} from '../../../packages/access/src/index.js';

describe('phase12 admin access package', () => {
  it('maps role permissions without treating support as a mutating admin', () => {
    expect(hasPermission('support', ADMIN_PERMISSIONS.USERS_READ)).toBe(true);
    expect(hasPermission('support', ADMIN_PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(hasPermission('support', ADMIN_PERMISSIONS.USERS_PLAN_UPDATE)).toBe(false);
    expect(hasPermission('admin', ADMIN_PERMISSIONS.USERS_PLAN_UPDATE)).toBe(true);
    expect(hasPermission('owner', ADMIN_PERMISSIONS.USERS_ROLE_UPDATE)).toBe(true);
  });

  it('resolves the strongest recognized role from Supabase claims and metadata', () => {
    const subject = resolveAccessSubject({
      id: 'actor-1',
      email: 'admin@example.com',
      app_metadata: { storyforge_role: 'support' },
      user_metadata: { role: 'admin' },
    });

    expect(subject).toMatchObject({
      id: 'actor-1',
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(subject.permissions).toContain(ADMIN_PERMISSIONS.USERS_PLAN_UPDATE);
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
      nextStatus: 'suspended',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SELF_STATUS_LOCK_BLOCKED',
      status: 400,
    });
  });
});
