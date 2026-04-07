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
  detailedSummary: 'string',
  location: 'object | null',
  startChapterId: 'string',
  startChunkId: 'string',
  endChapterId: 'string',
  endChunkId: 'string',
  chapterStartIndex: 'number | null',
  chapterEndIndex: 'number | null',
  chapterStartNumber: 'number | null',
  chapterEndNumber: 'number | null',
  chapterStart: 'number | null',
  chapterEnd: 'number | null',
  chapterRange: '[startIndex, endIndex]',
  chunkStartIndex: 'number | null',
  chunkEndIndex: 'number | null',
  chunkRange: '[startIndex, endIndex]',
  startAnchor: 'object',
  activeSpan: 'number',
  climaxAnchor: 'object',
  endAnchor: 'object',
  boundaryNote: 'string',
  uncertainStart: 'boolean',
  uncertainEnd: 'boolean',
  confidence: 'number (0-1)',
  anchorEventId: 'string | null',
  anchorEventDescription: 'string',
  evidence: 'string[]',
  evidenceSnippet: 'string',
  evidenceRefs: 'string[]',
  containedEvents: 'string[]',
  eventIds: 'string[]',
  eventCount: 'number',
  subeventCount: 'number',
  tags: 'string[]',
  preconditions: 'string[]',
  progression: 'string[]',
  turningPoints: 'string[]',
  climax: 'string',
  outcome: 'string',
  consequences: 'string[]',
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
  provenance: 'object | null',
  schemaVersion: 'string',
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

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChapter(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const match = value.match(/(\d{1,4})/u);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function normalizeIncidentLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || value.label || '').trim();
  const id = String(value.id || '').trim() || null;
  if (!name && !id) return null;

  const confidence = toNullableNumber(value.confidence ?? value.conf);
  return {
    id,
    name: name || null,
    confidence: confidence == null ? null : clamp(confidence, 0, 1),
    isMajor: Boolean(value.isMajor),
  };
}

function normalizeIncidentType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['major_plot_point', 'major', 'main'].includes(normalized)) {
    return INCIDENT_TYPES.MAJOR_PLOT_POINT;
  }
  if (['pov_thread', 'pov'].includes(normalized)) {
    return INCIDENT_TYPES.POV_THREAD;
  }
  return INCIDENT_TYPES.SUBPLOT;
}

function choosePrimaryText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function normalizeIncident(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };

  const chapterStart = normalizeChapter(
    merged.chapterStart
    ?? merged.chapterStartNumber
    ?? merged.chapterStartIndex
    ?? merged.startChapter
    ?? merged.chapterRange?.[0],
  );
  const chapterEnd = normalizeChapter(
    merged.chapterEnd
    ?? merged.chapterEndNumber
    ?? merged.chapterEndIndex
    ?? merged.endChapter
    ?? merged.chapterRange?.[1]
    ?? chapterStart,
  );

  const chapterStartIndex = normalizeChapter(merged.chapterStartIndex ?? chapterStart);
  const chapterEndIndex = normalizeChapter(merged.chapterEndIndex ?? chapterEnd);
  const chapterStartNumber = normalizeChapter(merged.chapterStartNumber ?? chapterStart);
  const chapterEndNumber = normalizeChapter(merged.chapterEndNumber ?? chapterEnd);

  const chunkStart = toNullableNumber(
    merged.chunkStartIndex
    ?? merged.startChunkIndex
    ?? merged.chunkRange?.[0],
  );
  const chunkEnd = toNullableNumber(
    merged.chunkEndIndex
    ?? merged.endChunkIndex
    ?? merged.chunkRange?.[1]
    ?? chunkStart,
  );

  const confidenceValue = toNullableNumber(merged.confidence ?? merged.score);
  const evidence = toStringArray(
    toArray(merged.evidence).length
      ? merged.evidence
      : (merged.evidenceSnippet ? [merged.evidenceSnippet] : []),
  );
  const containedEvents = toStringArray(
    toArray(merged.containedEvents).length
      ? merged.containedEvents
      : (
        toArray(merged.eventIds).length
          ? merged.eventIds
          : merged.filteredEventIds
      ),
  );
  const location = normalizeIncidentLocation(merged.location);
  const relatedLocations = toStringArray(
    toArray(merged.relatedLocations).length
      ? merged.relatedLocations
      : (location?.id ? [location.id] : []),
  );

  const span = (
    chapterStart != null
    && chapterEnd != null
    && chapterEnd >= chapterStart
  )
    ? (chapterEnd - chapterStart + 1)
    : (toNullableNumber(merged.activeSpan) || 0);

  const normalized = {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    title: choosePrimaryText(merged.title, merged.name, merged.anchorEventDescription, merged.description),
    type: normalizeIncidentType(merged.type),
    description: choosePrimaryText(
      merged.description,
      merged.detailedSummary,
      merged.detailed_summary,
      merged.summary,
    ),
    detailedSummary: choosePrimaryText(
      merged.detailedSummary,
      merged.detailed_summary,
      merged.description,
      merged.summary,
    ),
    location,
    startChapterId: merged.startChapterId || merged.start_chapter_id || null,
    startChunkId: merged.startChunkId || merged.start_chunk_id || null,
    endChapterId: merged.endChapterId || merged.end_chapter_id || null,
    endChunkId: merged.endChunkId || merged.end_chunk_id || null,
    chapterStartIndex,
    chapterEndIndex,
    chunkStartIndex: chunkStart,
    chunkEndIndex: chunkEnd,
    chapterStartNumber,
    chapterEndNumber,
    chapterStart,
    chapterEnd,
    startChapter: chapterStart,
    endChapter: chapterEnd,
    chapterRange: [chapterStart, chapterEnd],
    chunkRange: [chunkStart, chunkEnd ?? chunkStart],
    startAnchor: normalizeObject(merged.startAnchor),
    activeSpan: span,
    climaxAnchor: normalizeObject(merged.climaxAnchor),
    endAnchor: normalizeObject(merged.endAnchor),
    boundaryNote: String(merged.boundaryNote || '').trim(),
    uncertainStart: Boolean(merged.uncertainStart),
    uncertainEnd: Boolean(merged.uncertainEnd),
    confidence: confidenceValue == null ? null : clamp(confidenceValue, 0, 1),
    anchorEventId: String(merged.anchorEventId || '').trim() || null,
    anchorEventDescription: String(merged.anchorEventDescription || '').trim(),
    evidence,
    evidenceSnippet: String(merged.evidenceSnippet || evidence[0] || '').trim(),
    evidenceRefs: toStringArray(
      toArray(merged.evidenceRefs).length
        ? merged.evidenceRefs
        : (
          toArray(merged.primaryEvidenceRefs).length
            ? merged.primaryEvidenceRefs
            : (toArray(merged.primary_evidence_refs).length ? merged.primary_evidence_refs : merged.evidence_refs)
        ),
    ),
    containedEvents,
    eventIds: containedEvents,
    eventCount: toNullableNumber(merged.eventCount) ?? containedEvents.length,
    subeventCount: toNullableNumber(merged.subeventCount) ?? 0,
    tags: toStringArray(merged.tags),
    preconditions: toStringArray(merged.preconditions),
    progression: toStringArray(merged.progression),
    turningPoints: toStringArray(merged.turningPoints || merged.turning_points),
    climax: String(merged.climax || '').trim(),
    outcome: String(merged.outcome || '').trim(),
    consequences: toStringArray(merged.consequences),
    subIncidentIds: toStringArray(merged.subIncidentIds),
    relatedIncidents: toStringArray(merged.relatedIncidents),
    relatedLocations,
    causalPredecessors: toStringArray(merged.causalPredecessors),
    causalSuccessors: toStringArray(merged.causalSuccessors),
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
    provenance: normalizeObject(merged.provenance),
    schemaVersion: String(merged.schemaVersion || merged.schema_version || 'incident.v1'),
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
