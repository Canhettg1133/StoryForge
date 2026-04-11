export const EVENT_INCIDENT_LINK_ROLE = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
};

export const EVENT_STATUS = {
  PENDING: 'pending',
  GROUNDED: 'grounded',
  REVIEWED: 'reviewed',
  REJECTED: 'rejected',
};

export const EVENT_REVIEW_STATUS = {
  AUTO_ACCEPTED: 'auto_accepted',
  NEEDS_REVIEW: 'needs_review',
};

export const EVENT_AUTO_ACCEPT_THRESHOLD = 0.75;

export const eventSchema = {
  id: 'string',
  corpusId: 'string',
  analysisId: 'string',
  title: 'string',
  description: 'string',
  severity: 'number (0-1)',
  tags: 'string[]',
  chapterId: 'string',
  chapterIndex: 'number',
  chunkId: 'string',
  chunkIndex: 'number',
  incidentId: 'string',
  linkRole: 'EVENT_INCIDENT_LINK_ROLE',
  secondaryIncidentIds: 'string[]',
  locationLink: 'object',
  causalLinks: 'object',
  confidence: 'number (0-1)',
  evidence: 'string[]',
  qualityProxy: 'number (0-100)',
  reviewStatus: 'EVENT_REVIEW_STATUS',
  needsReview: 'boolean',
  annotation: 'string',
  createdAt: 'timestamp',
  groundedAt: 'timestamp',
  reviewedAt: 'timestamp',
};

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeEvent(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };

  const incidentId = merged.incidentId || merged.incident_id || null;
  const linkRole = Object.values(EVENT_INCIDENT_LINK_ROLE).includes(merged.linkRole)
    ? merged.linkRole
    : EVENT_INCIDENT_LINK_ROLE.PRIMARY;

  return {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    title: String(merged.title || '').trim(),
    description: String(merged.description || merged.summary || '').trim(),
    severity: clamp(merged.severity, 0, 1),
    tags: toArray(merged.tags).map((item) => String(item).trim()).filter(Boolean),
    chapterId: merged.chapterId || merged.chapter_id || null,
    chapterIndex: Number.isFinite(Number(merged.chapterIndex ?? merged.chapter_index))
      ? Number(merged.chapterIndex ?? merged.chapter_index)
      : null,
    chunkId: merged.chunkId || merged.chunk_id || null,
    chunkIndex: Number.isFinite(Number(merged.chunkIndex ?? merged.chunk_index))
      ? Number(merged.chunkIndex ?? merged.chunk_index)
      : null,
    incidentId,
    linkRole,
    secondaryIncidentIds: toArray(merged.secondaryIncidentIds || merged.secondary_incident_ids),
    locationLink: merged.locationLink && typeof merged.locationLink === 'object' ? merged.locationLink : null,
    causalLinks: merged.causalLinks && typeof merged.causalLinks === 'object'
      ? merged.causalLinks
      : { causes: [], causedBy: [] },
    confidence: clamp(merged.confidence, 0, 1),
    evidence: toArray(merged.evidence).map((item) => String(item).trim()).filter(Boolean),
    qualityProxy: clamp(merged.qualityProxy ?? merged.quality_proxy, 0, 100),
    reviewStatus: Object.values(EVENT_REVIEW_STATUS).includes(merged.reviewStatus)
      ? merged.reviewStatus
      : EVENT_REVIEW_STATUS.NEEDS_REVIEW,
    needsReview: Boolean(merged.needsReview ?? merged.needs_review),
    annotation: String(merged.annotation || '').trim(),
    status: Object.values(EVENT_STATUS).includes(merged.status)
      ? merged.status
      : EVENT_STATUS.PENDING,
    createdAt: merged.createdAt || merged.created_at || null,
    groundedAt: merged.groundedAt || merged.grounded_at || null,
    reviewedAt: merged.reviewedAt || merged.reviewed_at || null,
  };
}

export function shouldAutoAcceptEvent(event) {
  const normalized = normalizeEvent(event);
  return (
    normalized.confidence >= EVENT_AUTO_ACCEPT_THRESHOLD
    && Number.isFinite(Number(normalized.chapterIndex))
    && normalized.chapterIndex >= 0
  );
}
