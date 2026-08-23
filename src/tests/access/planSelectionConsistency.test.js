import { describe, expect, it } from 'vitest';
import { ACCESS_FEATURES, resolveFeatureDecision as resolveSharedDecision } from '../../../packages/access/src/index.js';
import { resolveFeatureDecision as resolveBrowserDecision } from '../../services/access/accessControl.js';

const BASE_ACCESS = {
  authenticated: true,
  now: '2026-07-20T00:00:00.000Z',
  profile: { user_id: 'user-1', status: 'active' },
  features: [{ key: ACCESS_FEATURES.TRANSLATOR_ACCESS, active: true }],
  userPlans: [
    {
      id: 'newer-short-vip',
      plan_id: 'vip-short',
      status: 'active',
      starts_at: '2026-07-19T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      plans: { key: 'vip' },
    },
    {
      id: 'older-long-vip',
      plan_id: 'vip-long',
      status: 'active',
      starts_at: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-09-01T00:00:00.000Z',
      plans: { key: 'vip' },
    },
  ],
  planFeatures: [
    { plan_id: 'vip-short', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true, limit_json: { marker: 'short' } },
    { plan_id: 'vip-long', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true, limit_json: { marker: 'long' } },
  ],
  overrides: [],
};

describe.each([
  ['shared access package', resolveSharedDecision],
  ['browser access resolver', resolveBrowserDecision],
])('%s plan selection', (_label, resolveDecision) => {
  it('uses the furthest expiry for duplicate VIP rows', () => {
    expect(resolveDecision(BASE_ACCESS, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: true,
      limits: { marker: 'long' },
    });
  });

  it('always prioritizes lifetime over VIP', () => {
    const access = {
      ...BASE_ACCESS,
      userPlans: [
        ...BASE_ACCESS.userPlans,
        {
          id: 'lifetime',
          plan_id: 'lifetime-plan',
          status: 'active',
          starts_at: '2026-06-01T00:00:00.000Z',
          expires_at: null,
          plans: { key: 'lifetime' },
        },
      ],
      planFeatures: [
        ...BASE_ACCESS.planFeatures,
        { plan_id: 'lifetime-plan', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true, limit_json: { marker: 'lifetime' } },
      ],
    };

    expect(resolveDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: true,
      limits: { marker: 'lifetime' },
    });
  });

  it('normalizes explicit activePlans instead of trusting response order', () => {
    const access = {
      ...BASE_ACCESS,
      activePlans: [
        BASE_ACCESS.userPlans[0],
        BASE_ACCESS.userPlans[1],
      ],
    };

    expect(resolveDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: true,
      limits: { marker: 'long' },
    });
  });
});


