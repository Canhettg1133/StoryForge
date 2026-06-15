import { describe, expect, it } from 'vitest';
import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  resolveAdminDecision,
  resolveFeatureDecision,
  resolveUserAccess,
} from '../../services/access/accessControl.js';

const NOW = '2026-05-25T15:00:00.000Z';

function baseAccess(overrides = {}) {
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
      { key: ACCESS_FEATURES.GEMINI_DIRECT, active: true },
    ],
    userPlans: [
      {
        id: 'plan-user-1',
        plan_id: 'vip-plan',
        plan_key: 'vip',
        status: 'active',
        starts_at: '2026-05-01T00:00:00.000Z',
        expires_at: '2026-06-01T00:00:00.000Z',
      },
    ],
    planFeatures: [
      { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS, enabled: true },
      { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS, enabled: true },
      { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.ADULT_MODE, enabled: true },
      { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.AG_PROXY, enabled: true },
      { plan_id: 'vip-plan', feature_key: ACCESS_FEATURES.GEMINI_DIRECT, enabled: true },
    ],
    overrides: [],
    consentVersions: [
      { key: 'adult_terms', version: '2026-05', active: true },
    ],
    ...overrides,
  };
}

describe('access control resolver', () => {
  it('denies by default when the user is not authenticated', () => {
    const decision = resolveFeatureDecision({ authenticated: false }, ACCESS_FEATURES.TRANSLATOR_ACCESS);

    expect(decision).toMatchObject({
      allowed: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
    });
  });

  it('does not grant product features just because the user is admin', () => {
    const access = baseAccess({
      profile: { system_role: 'admin' },
      userPlans: [],
      planFeatures: [],
    });

    expect(resolveAdminDecision(access).allowed).toBe(true);
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
  });

  it('blocks free users from translator, chat, 18+, and VIP provider features', () => {
    const access = baseAccess({
      userPlans: [],
      planFeatures: [],
      profile: {
        age_confirmed_at: '2026-05-25T00:00:00.000Z',
        adult_terms_accepted_at: '2026-05-25T00:00:00.000Z',
        adult_terms_version: '2026-05',
      },
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.AI_CHAT_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.GEMINI_DIRECT)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.FEATURE_NOT_ALLOWED,
    });
  });

  it('allows VIP plan features when the active plan includes them', () => {
    const access = baseAccess({
      profile: {
        age_confirmed_at: '2026-05-25T00:00:00.000Z',
        adult_terms_accepted_at: '2026-05-25T00:00:00.000Z',
        adult_terms_version: '2026-05',
      },
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
      source: 'plan',
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.AI_CHAT_ACCESS)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
      source: 'plan',
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
      source: 'plan',
    });
    expect(resolveFeatureDecision(access, ACCESS_FEATURES.GEMINI_DIRECT)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
      source: 'plan',
    });
  });

  it('lets the latest active override deny a VIP feature', () => {
    const access = baseAccess({
      overrides: [
        {
          id: 'a',
          feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS,
          enabled: true,
          created_at: '2026-05-24T00:00:00.000Z',
        },
        {
          id: 'b',
          feature_key: ACCESS_FEATURES.TRANSLATOR_ACCESS,
          enabled: false,
          created_at: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.TRANSLATOR_ACCESS)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.OVERRIDE_BLOCKED,
      source: 'override_block',
    });
  });

  it('uses id as a deterministic tiebreaker when override timestamps match', () => {
    const access = baseAccess({
      overrides: [
        {
          id: '001',
          feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS,
          enabled: true,
          created_at: '2026-05-25T00:00:00.000Z',
        },
        {
          id: '002',
          feature_key: ACCESS_FEATURES.AI_CHAT_ACCESS,
          enabled: false,
          created_at: '2026-05-25T00:00:00.000Z',
        },
      ],
    });

    expect(resolveFeatureDecision(access, ACCESS_FEATURES.AI_CHAT_ACCESS)).toMatchObject({
      allowed: false,
      source: 'override_block',
    });
  });

  it('requires age confirmation and current adult terms for 18+', () => {
    expect(resolveFeatureDecision(baseAccess(), ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED,
    });

    expect(resolveFeatureDecision(baseAccess({
      profile: { age_confirmed_at: '2026-05-25T00:00:00.000Z' },
    }), ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.ADULT_TERMS_REQUIRED,
    });

    expect(resolveFeatureDecision(baseAccess({
      profile: {
        age_confirmed_at: '2026-05-25T00:00:00.000Z',
        adult_terms_accepted_at: '2026-05-25T00:00:00.000Z',
        adult_terms_version: '2026-04',
      },
    }), ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED,
    });

    expect(resolveFeatureDecision(baseAccess({
      profile: {
        age_confirmed_at: '2026-05-25T00:00:00.000Z',
        adult_terms_accepted_at: '2026-05-25T00:00:00.000Z',
        adult_terms_version: '2026-05',
      },
    }), ACCESS_FEATURES.ADULT_MODE)).toMatchObject({
      allowed: true,
      reason: ACCESS_REASONS.ALLOWED,
    });
  });

  it('builds a snapshot with feature decisions and admin decision', () => {
    const snapshot = resolveUserAccess(baseAccess({
      profile: {
        system_role: 'admin',
        age_confirmed_at: '2026-05-25T00:00:00.000Z',
        adult_terms_accepted_at: '2026-05-25T00:00:00.000Z',
        adult_terms_version: '2026-05',
      },
    }));

    expect(snapshot.user.systemRole).toBe('admin');
    expect(snapshot.admin.allowed).toBe(true);
    expect(snapshot.features[ACCESS_FEATURES.TRANSLATOR_ACCESS].allowed).toBe(true);
    expect(snapshot.features[ACCESS_FEATURES.ADULT_MODE].allowed).toBe(true);
  });
});
