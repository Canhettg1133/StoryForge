import { describe, expect, it } from 'vitest';
import {
  REVIEW_SAFETY,
  classifyEntityResolutionReview,
} from '../../services/codex/entityResolutionPolicy.js';

function safeSuggestion(overrides = {}) {
  return {
    evidence_valid: true,
    catalog_complete: true,
    source_fresh: true,
    catalog_fresh: true,
    context_complete: true,
    resolver_decision: 'match_existing',
    critic_decision: 'agree',
    match_tier: 'exact_normalized_name',
    target_count: 1,
    protected_field_changes: [],
    risk_flags: [],
    ...overrides,
  };
}

describe('entity resolution review policy', () => {
  it('allows quick approval only for a fresh, grounded, unanimous exact match', () => {
    expect(classifyEntityResolutionReview(safeSuggestion())).toEqual(expect.objectContaining({
      safety: REVIEW_SAFETY.QUICK_APPROVE,
      quickApprove: true,
    }));
  });

  it.each([
    ['near match', { match_tier: 'safe_subset' }],
    ['new protagonist', { protected_field_changes: ['role:protagonist'] }],
    ['critic disagreement', { critic_decision: 'disagree' }],
    ['incomplete catalog', { catalog_complete: false }],
    ['incomplete chapter context', { context_complete: false }],
    ['invalid evidence', { evidence_valid: false }],
    ['multiple targets', { target_count: 2 }],
  ])('holds %s for manual review', (_label, patch) => {
    expect(classifyEntityResolutionReview(safeSuggestion(patch))).toEqual(expect.objectContaining({
      safety: REVIEW_SAFETY.MANUAL_REVIEW,
      quickApprove: false,
    }));
  });
});
