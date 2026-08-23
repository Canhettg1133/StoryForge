import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveUserPlan,
  getCurrentUserPlanKey,
  matchesUserPlanExpiryFilter,
  sortUsersByPlanExpiry,
} from './adminFormatters.js';

function createUserPlan({ userId, expiresAt, status = 'active', planKey = 'vip' } = {}) {
  return {
    user_id: userId,
    user_plans: [{
      status,
      expires_at: expiresAt,
      starts_at: '2026-07-01T00:00:00.000Z',
      plans: { key: planKey },
    }],
  };
}

describe('matchesUserPlanExpiryFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes an active VIP plan expiring within seven days', () => {
    const user = createUserPlan({ expiresAt: '2026-07-27T00:00:00.000Z' });

    expect(matchesUserPlanExpiryFilter(user, 'expiring_7')).toBe(true);
  });

  it('uses the selected expiry window', () => {
    const user = createUserPlan({ expiresAt: '2026-08-09T00:00:00.000Z' });

    expect(matchesUserPlanExpiryFilter(user, 'expiring_7')).toBe(false);
    expect(matchesUserPlanExpiryFilter(user, 'expiring_30')).toBe(true);
  });

  it('excludes expired, lifetime, and canceled plans', () => {
    const expiredUser = createUserPlan({ expiresAt: '2026-07-19T23:59:59.000Z' });
    const lifetimeUser = createUserPlan({ expiresAt: null, planKey: 'lifetime' });
    const canceledUser = createUserPlan({ expiresAt: '2026-07-22T00:00:00.000Z', status: 'canceled' });

    expect(matchesUserPlanExpiryFilter(expiredUser, 'expiring_7')).toBe(false);
    expect(matchesUserPlanExpiryFilter(lifetimeUser, 'expiring_7')).toBe(false);
    expect(matchesUserPlanExpiryFilter(canceledUser, 'expiring_7')).toBe(false);
  });

  it('does not restrict users when the expiry filter is disabled', () => {
    expect(matchesUserPlanExpiryFilter({}, 'all')).toBe(true);
  });

  it('sorts users with the nearest VIP expiry first', () => {
    const users = [
      createUserPlan({ userId: 'expires-20d', expiresAt: '2026-08-09T00:00:00.000Z' }),
      createUserPlan({ userId: 'expires-5d', expiresAt: '2026-07-25T00:00:00.000Z' }),
      createUserPlan({ userId: 'expires-12d', expiresAt: '2026-08-01T00:00:00.000Z' }),
    ];

    expect(sortUsersByPlanExpiry(users).map((user) => user.user_id)).toEqual([
      'expires-5d',
      'expires-12d',
      'expires-20d',
    ]);
  });

  it('prefers lifetime, then the VIP row with the furthest expiry', () => {
    const user = {
      user_plans: [
        {
          id: 'newer-short-vip',
          status: 'active',
          starts_at: '2026-07-19T00:00:00.000Z',
          expires_at: '2026-08-01T00:00:00.000Z',
          plans: { key: 'vip' },
        },
        {
          id: 'older-long-vip',
          status: 'active',
          starts_at: '2026-07-01T00:00:00.000Z',
          expires_at: '2026-09-01T00:00:00.000Z',
          plans: { key: 'vip' },
        },
      ],
    };

    expect(getActiveUserPlan(user)?.id).toBe('older-long-vip');

    user.user_plans.push({
      id: 'lifetime',
      status: 'active',
      starts_at: '2026-06-01T00:00:00.000Z',
      expires_at: null,
      plans: { key: 'lifetime' },
    });
    expect(getActiveUserPlan(user)?.id).toBe('lifetime');
    expect(getCurrentUserPlanKey(user)).toBe('lifetime');
  });
});
