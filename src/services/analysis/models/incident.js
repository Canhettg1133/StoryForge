export const INCIDENT_TYPES = {
  MAJOR_PLOT_POINT: 'major_plot_point',
  SUBPLOT: 'subplot',
  POV_THREAD: 'pov_thread',
};

export const INCIDENT_STATUS = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  MERGED: 'merged',
  SPLIT: 'split',
  NEEDS_REVIEW: 'needs_review',
};

export const INCIDENT_CONFIDENCE = {
  AUTO_ACCEPT: 0.85,
  NEEDS_REVIEW: 0.70,
  LOW: 0.50,
};

export const INCIDENT_REVIEW_STATUS = {
  AUTO_ACCEPTED: 'auto_accepted',
  NEEDS_REVIEW: 'needs_review',
};

export const INCIDENT_PRIORITY = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
};

export const incidentSchema = {
  id: 'string',
  corpusId: 'string',
  analysisId: 'string',
  title: 'string',
  type: 'INCIDENT_TYPES',
  description: 'string',
  startChapterId: 'string',
  startChunkId: 'string',
  endChapterId: 'string',
  endChunkId: 'string',
  chapterRange: '[startIndex, endIndex]',
  chunkRange: '[startIndex, endIndex]',
  startAnchor: 'object',
  activeSpan: 'number',
  climaxAnchor: 'object',
  endAnchor: 'object',
  boundaryNote: 'string',
  uncertainStart: 'boolean',
  uncertainEnd: 'boolean',
  confidence: 'number (0-1)',
  evidence: 'string[]',
  containedEvents: 'string[]',
  subIncidentIds: 'string[]',
  relatedIncidents: 'string[]',
  relatedLocations: 'string[]',
  causalPredecessors: 'string[]',
  causalSuccessors: 'string[]',
  majorScore: 'number (0-10)',
  impactScore: 'number (0-10)',
  status: 'INCIDENT_STATUS',
  reviewStatus: 'INCIDENT_REVIEW_STATUS',
  priority: 'INCIDENT_PRIORITY | null',
  createdAt: 'timestamp',
  analyzedAt: 'timestamp',
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

export function normalizeIncident(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };

  const chapterStart = Number.isFinite(Number(merged.chapterStartIndex))
    ? Number(merged.chapterStartIndex)
    : Number.isFinite(Number(merged.startChapter))
      ? Number(merged.startChapter)
      : null;
  const chapterEnd = Number.isFinite(Number(merged.chapterEndIndex))
    ? Number(merged.chapterEndIndex)
    : Number.isFinite(Number(merged.endChapter))
      ? Number(merged.endChapter)
      : null;

  const chunkStart = Number.isFinite(Number(merged.chunkStartIndex))
    ? Number(merged.chunkStartIndex)
    : Number.isFinite(Number(merged.startChunkIndex))
      ? Number(merged.startChunkIndex)
      : null;
  const chunkEnd = Number.isFinite(Number(merged.chunkEndIndex))
    ? Number(merged.chunkEndIndex)
    : Number.isFinite(Number(merged.endChunkIndex))
      ? Number(merged.endChunkIndex)
      : null;

  const span = (
    chapterStart != null
    && chapterEnd != null
    && chapterEnd >= chapterStart
  )
    ? (chapterEnd - chapterStart + 1)
    : Number(merged.activeSpan) || 0;

  const normalized = {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    title: String(merged.title || '').trim(),
    type: Object.values(INCIDENT_TYPES).includes(merged.type)
      ? merged.type
      : INCIDENT_TYPES.SUBPLOT,
    description: String(merged.description || '').trim(),
    startChapterId: merged.startChapterId || merged.start_chapter_id || null,
    startChunkId: merged.startChunkId || merged.start_chunk_id || null,
    endChapterId: merged.endChapterId || merged.end_chapter_id || null,
    endChunkId: merged.endChunkId || merged.end_chunk_id || null,
    chapterRange: [chapterStart, chapterEnd],
    chunkRange: [chunkStart, chunkEnd],
    startAnchor: merged.startAnchor && typeof merged.startAnchor === 'object' ? merged.startAnchor : null,
    activeSpan: span,
    climaxAnchor: merged.climaxAnchor && typeof merged.climaxAnchor === 'object' ? merged.climaxAnchor : null,
    endAnchor: merged.endAnchor && typeof merged.endAnchor === 'object' ? merged.endAnchor : null,
    boundaryNote: String(merged.boundaryNote || '').trim(),
    uncertainStart: Boolean(merged.uncertainStart),
    uncertainEnd: Boolean(merged.uncertainEnd),
    confidence: clamp(merged.confidence, 0, 1),
    evidence: toArray(merged.evidence).map((item) => String(item).trim()).filter(Boolean),
    containedEvents: toArray(merged.containedEvents),
    subIncidentIds: toArray(merged.subIncidentIds),
    relatedIncidents: toArray(merged.relatedIncidents),
    relatedLocations: toArray(merged.relatedLocations),
    causalPredecessors: toArray(merged.causalPredecessors),
    causalSuccessors: toArray(merged.causalSuccessors),
    majorScore: clamp(merged.majorScore, 0, 10),
    impactScore: clamp(merged.impactScore, 0, 10),
    status: Object.values(INCIDENT_STATUS).includes(merged.status)
      ? merged.status
      : INCIDENT_STATUS.PENDING,
    reviewStatus: Object.values(INCIDENT_REVIEW_STATUS).includes(merged.reviewStatus)
      ? merged.reviewStatus
      : INCIDENT_REVIEW_STATUS.NEEDS_REVIEW,
    priority: Object.values(INCIDENT_PRIORITY).includes(merged.priority)
      ? merged.priority
      : null,
    createdAt: merged.createdAt || merged.created_at || null,
    analyzedAt: merged.analyzedAt || merged.analyzed_at || null,
    reviewedAt: merged.reviewedAt || merged.reviewed_at || null,
  };

  return normalized;
}

export function shouldAutoAcceptIncident(incident) {
  const normalized = normalizeIncident(incident);
  return (
    normalized.confidence >= INCIDENT_CONFIDENCE.AUTO_ACCEPT
    && normalized.evidence.length > 0
    && !normalized.uncertainStart
    && !normalized.uncertainEnd
    && normalized.chapterRange[0] != null
    && normalized.chapterRange[1] != null
  );
}
