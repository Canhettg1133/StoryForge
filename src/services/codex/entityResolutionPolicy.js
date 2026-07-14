export const REVIEW_SAFETY = Object.freeze({
  QUICK_APPROVE: 'quick_approve',
  MANUAL_REVIEW: 'manual_review',
});

const QUICK_APPROVE_MATCH_TIERS = new Set([
  'exact_normalized_name',
  'exact_alias',
]);

export function classifyEntityResolutionReview(input = {}) {
  const reasons = [];
  const riskFlags = Array.isArray(input.risk_flags) ? input.risk_flags.filter(Boolean) : [];
  const protectedChanges = Array.isArray(input.protected_field_changes)
    ? input.protected_field_changes.filter(Boolean)
    : [];

  if (input.evidence_valid !== true) reasons.push('invalid_evidence');
  if (input.catalog_complete !== true) reasons.push('catalog_incomplete');
  if (input.context_complete !== true) reasons.push('context_incomplete');
  if (input.source_fresh !== true) reasons.push('source_stale');
  if (input.catalog_fresh !== true) reasons.push('catalog_stale');
  if (input.resolver_decision !== 'match_existing') reasons.push('not_existing_match');
  if (input.critic_decision !== 'agree') reasons.push('critic_not_agree');
  if (!QUICK_APPROVE_MATCH_TIERS.has(input.match_tier)) reasons.push('non_exact_match');
  if (Number(input.target_count) !== 1) reasons.push('target_not_unique');
  if (protectedChanges.length > 0) reasons.push('protected_field_change');
  if (riskFlags.length > 0) reasons.push('risk_flagged');

  const quickApprove = reasons.length === 0;
  return {
    safety: quickApprove ? REVIEW_SAFETY.QUICK_APPROVE : REVIEW_SAFETY.MANUAL_REVIEW,
    quickApprove,
    reasons,
  };
}
