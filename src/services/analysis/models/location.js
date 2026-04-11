export const LOCATION_REVIEW_STATUS = {
  AUTO_ACCEPTED: 'auto_accepted',
  NEEDS_REVIEW: 'needs_review',
};

export const LOCATION_AUTO_ACCEPT_THRESHOLD = 0.80;

export const locationSchema = {
  id: 'string',
  corpusId: 'string',
  analysisId: 'string',
  name: 'string',
  normalized: 'string',
  aliases: 'string[]',
  mentionCount: 'number',
  chapterSpread: '[startIndex, endIndex]',
  chapterStart: 'number',
  chapterEnd: 'number',
  importance: 'number (0-1)',
  isMajor: 'boolean',
  tokens: 'string[]',
  evidence: 'string[]',
  incidentIds: 'string[]',
  eventIds: 'string[]',
  confidence: 'number (0-1)',
  evidenceStrength: 'number (0-1)',
  reviewStatus: 'LOCATION_REVIEW_STATUS',
  createdAt: 'timestamp',
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function normalizeLocation(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };
  const name = normalizeText(merged.name || merged.locationName);
  const normalized = normalizeText(merged.normalized || name).toLowerCase();

  const chapterStart = Number.isFinite(Number(merged.chapterStart ?? merged.chapter_start))
    ? Number(merged.chapterStart ?? merged.chapter_start)
    : null;
  const chapterEnd = Number.isFinite(Number(merged.chapterEnd ?? merged.chapter_end))
    ? Number(merged.chapterEnd ?? merged.chapter_end)
    : null;

  return {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    name,
    normalized,
    aliases: toArray(merged.aliases).map((item) => normalizeText(item)).filter(Boolean),
    mentionCount: Math.max(0, Number(merged.mentionCount ?? merged.mention_count) || 0),
    chapterSpread: [chapterStart, chapterEnd],
    chapterStart,
    chapterEnd,
    importance: clamp(merged.importance, 0, 1),
    isMajor: Boolean(merged.isMajor ?? merged.is_major),
    tokens: toArray(merged.tokens).map((item) => normalizeText(item)).filter(Boolean),
    evidence: toArray(merged.evidence).map((item) => (
      typeof item === 'string' ? normalizeText(item) : item
    )).filter(Boolean),
    incidentIds: toArray(merged.incidentIds || merged.incident_ids),
    eventIds: toArray(merged.eventIds || merged.event_ids),
    confidence: clamp(merged.confidence, 0, 1),
    evidenceStrength: clamp(merged.evidenceStrength ?? merged.evidence_strength, 0, 1),
    reviewStatus: Object.values(LOCATION_REVIEW_STATUS).includes(merged.reviewStatus)
      ? merged.reviewStatus
      : LOCATION_REVIEW_STATUS.NEEDS_REVIEW,
    createdAt: merged.createdAt || merged.created_at || null,
    reviewedAt: merged.reviewedAt || merged.reviewed_at || null,
  };
}

export function shouldAutoAcceptLocation(location) {
  const normalized = normalizeLocation(location);
  return (
    normalized.confidence >= LOCATION_AUTO_ACCEPT_THRESHOLD
    && normalized.evidence.length > 0
    && normalized.name.length > 0
  );
}
