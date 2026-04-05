export const PRIORITY = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
};

export const REVIEW_ITEM_TYPES = {
  INCIDENT: 'incident',
  EVENT: 'event',
  LOCATION: 'location',
  CONSISTENCY_RISK: 'consistency_risk',
};

export const REVIEW_ITEM_STATUS = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  RESOLVED: 'resolved',
  IGNORED: 'ignored',
};

export const reviewQueueSchema = {
  id: 'string',
  corpusId: 'string',
  analysisId: 'string',
  itemType: 'REVIEW_ITEM_TYPES',
  itemId: 'string',
  priority: 'PRIORITY',
  priorityScore: 'number (0-1)',
  scoreBreakdown: 'object',
  reason: 'string[]',
  suggestions: 'string[]',
  status: 'REVIEW_ITEM_STATUS',
  reviewedBy: 'string',
  reviewedAt: 'timestamp',
  resolution: 'string',
  createdAt: 'timestamp',
};

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeReviewItem(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };

  return {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    itemType: Object.values(REVIEW_ITEM_TYPES).includes(merged.itemType)
      ? merged.itemType
      : REVIEW_ITEM_TYPES.EVENT,
    itemId: String(merged.itemId || '').trim(),
    priority: Object.values(PRIORITY).includes(merged.priority)
      ? merged.priority
      : PRIORITY.P2,
    priorityScore: clamp(merged.priorityScore ?? merged.priority_score, 0, 1),
    scoreBreakdown: merged.scoreBreakdown && typeof merged.scoreBreakdown === 'object'
      ? merged.scoreBreakdown
      : {
        impact: 0,
        confidenceDeficit: 0,
        consistencyRisk: 0,
        boundaryAmbiguity: 0,
        missingEvidence: 0,
      },
    reason: toArray(merged.reason).map((item) => String(item).trim()).filter(Boolean),
    suggestions: toArray(merged.suggestions).map((item) => String(item).trim()).filter(Boolean),
    status: Object.values(REVIEW_ITEM_STATUS).includes(merged.status)
      ? merged.status
      : REVIEW_ITEM_STATUS.PENDING,
    reviewedBy: merged.reviewedBy || merged.reviewed_by || null,
    reviewedAt: merged.reviewedAt || merged.reviewed_at || null,
    resolution: String(merged.resolution || '').trim(),
    createdAt: merged.createdAt || merged.created_at || null,
  };
}
