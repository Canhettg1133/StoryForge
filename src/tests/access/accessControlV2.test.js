import { describe, expect, it } from 'vitest';
import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  PLAN_STATUSES,
  resolveFeatureDecision,
  resolveUserAccess,
} from '../../services/access/accessControl.js';

const NOW = '2026-05-26T12:00:00.000Z';

function accessData(overrides = {}) {
  return {
    authenticated: true,
    now: NOW,
    profile: {
      user_id: 'user-1',
      email: 'user@example.com',
      system_role: 'user',
      status: 'active',
      ...overrides.profile,
    },
    features: [
      { key: ACCESS_FEATURES.TRANSLATOR_ACCESS, active: true },
      { key: ACCESS_FEATURES.AI_CHAT_ACCESS, active: true },
      { key: ACCESS_FEATURES.ADULT_MODE, active: true },
      { key: ACCESS_FEATURES.AG_PROXY, active: true },
      ...(overrides.features || []),
    ],
    userPlans: overrides.userPlans || [],
    planFeatures: overrides.planFeatures || [],
    overrides: overrides.overrides || [],
    consentVersions: [
      { key: 'adult_terms', version: '2026-05', active: true },
    ],
    ...overrides,
  };
}

describe('access control resolver v2', () => {
  it('uses the union of all active plans instead of only one active plan', () => {
    const access = accessData({
      userPlans: [
        {
          id: 'user-free',
          plan_id: 'free-plan',
          plan_key: 'free',
          status: PLAN_STATUSES.ACTIVE,
          starts_at: '2026-05-01T00:00:00.000Z',
          expires_at: null,
        },
        {
          id: 'user-vip',
          plan_id: 'vip-plan',
          plan_key: 'vip',
          status: PLAN_STATUSES.ACTIVE,
          starts_at: '2026-05-20T00:00:00.000Z',
          expires_at: '2026-06-20T00:00:00.000Z',
        },
      ],
      planFeatures: [
        { plan_id: 'free-plan', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: false },
        { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS, enabled: true },
      ],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.AI_CHAT_ACCESS)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
      source: 'plan',
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
  });

  it('ignores scheduled, expired, and cancelled plans when resolving rights', () => {
    const access = accessData({
      userPlans: [
        {
          id: 'scheduled',
          plan_id: 'vip-plan',
          plan_key: 'vip',
          status: PLAN_STATUSES.SCHEDULED,
          starts_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'expired',
          plan_id: 'lifetime-plan',
          plan_key: 'lifetime',
          status: PLAN_STATUSES.EXPIRED,
          starts_at: '2026-05-01T00:00:00.000Z',
        },
        {
          id: 'cancelled',
          plan_id: 'vip-plan',
          plan_key: 'vip',
          status: PLAN_STATUSES.CANCELLED,
          starts_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      planFeatures: [
        { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true },
        { plan_id: 'lifetime-plan', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true },
      ],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
  });

  it('returns OVERRIDE_BLOCKED when a block override wins over a plan', () => {
    const access = accessData({
      userPlans: [
        {
          id: 'vip',
          plan_id: 'vip-plan',
          plan_key: 'vip',
          status: PLAN_STATUSES.ACTIVE,
          starts_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      planFeatures: [
        { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS, enabled: true },
      ],
      overrides: [
        {
          id: 'block',
          feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS,
          enabled: false,
          created_at: '2026-05-26T10:00:00.000Z',
        },
      ],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.AI_CHAT_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.OVERRIDE_BLOCKED,
      source: 'override_block',
    });
  });

  it('surfaces disabled catalog features distinctly from missing VIP', () => {
    const access = accessData({
      features: [{ key: ACCESS_FEATURES.TRANSLATOR_ACCESS, active: false }],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_DISABLED,
      source: 'catalog',
    });
  });

  it('distinguishes missing Gemini Direct catalog from missing plan mapping', () => {
    expect(resolveFeatureDecision(accessData(), ACCESS_FEATURES.GEMINI_DIRECT)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_DISABLED,
      source: 'catalog',
    });

    const access = accessData({
      features: [{ key: ACCESS_FEATURES.GEMINI_DIRECT, active: true }],
      userPlans: [
        {
          id: 'vip',
          plan_id: 'vip-plan',
          plan_key: 'vip',
          status: PLAN_STATUSES.ACTIVE,
          starts_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      planFeatures: [],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.GEMINI_DIRECT)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
  });

  it('allows Gemini Direct for VIP and lifetime plan mappings', () => {
    for (const planKey of ['vip', 'lifetime']) {
      const access = accessData({
        features: [{ key: ACCESS_FEATURES.GEMINI_DIRECT, active: true }],
        userPlans: [
          {
            id: `${planKey}-user`,
            plan_id: `${planKey}-plan`,
            plan_key: planKey,
            status: PLAN_STATUSES.ACTIVE,
            starts_at: '2026-05-01T00:00:00.000Z',
          },
        ],
        planFeatures: [
          { plan_id: `${planKey}-plan`, feature_key: ACCESS_FEATURES.GEMINI_DIRECT, enabled: true },
        ],
      });

      expect(resolveFeatureDecision(access, ACCESS_FEATURES.GEMINI_DIRECT)).toMatchObject({
        allowed: true,
        reason: ACCESS_REASONS.ALLOWED,
        source: 'plan',
      });
    }
  });

  it('keeps admin role separate from the primary active plan display', () => {
    const snapshot = resolveUserAccess(accessData({
      profile: { system_role: 'admin' },
      userPlans: [
        { id: 'free', plan_id: 'free-plan', plan_key: 'free', status: PLAN_STATUSES.ACTIVE, starts_at: '2026-05-01T00:00:00.000Z' },
        { id: 'vip', plan_id: 'vip-plan', plan_key: 'vip', status: PLAN_STATUSES.ACTIVE, starts_at: '2026-05-20T00:00:00.000Z' },
      ],
    }));

    expect(snapshot.admin.allowed).toBe(true);
    expect(snapshot.plan.key).toBe('vip');
    expect(snapshot.plans.map((plan) => plan.key)).toEqual(['vip', 'free']);
  });
});
