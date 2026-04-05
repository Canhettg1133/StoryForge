export const CONFLICT_TYPES = {
  TIMELINE_INVERSION: 'timeline_inversion',
  STATE_CONTRADICTION: 'state_contradiction',
  IMPOSSIBLE_CO_LOCATION: 'impossible_co_location',
  MISSING_PREREQUISITE: 'missing_prerequisite',
  DUPLICATE_ANCHORS_CONFLICT: 'duplicate_anchors_conflict',
  POV_CONTINUITY_BREAK: 'pov_continuity_break',
  ENTITY_COLLISION: 'entity_collision',
  SPAN_ANOMALY: 'span_anomaly',
  EVIDENCE_MISMATCH: 'evidence_mismatch',
};

export const CONFLICT_SEVERITY = {
  HARD: { id: 'hard', penalty: 0.40, forceP0: true },
  MEDIUM: { id: 'medium', penalty: 0.25, forceP0: false },
  SOFT: { id: 'soft', penalty: 0.15, forceP0: false },
};

export const consistencyRiskSchema = {
  id: 'string',
  corpusId: 'string',
  analysisId: 'string',
  type: 'CONFLICT_TYPES',
  severity: '"hard" | "medium" | "soft"',
  description: 'string',
  details: 'object',
  involvedIncidents: 'string[]',
  involvedEvents: 'string[]',
  involvedLocations: 'string[]',
  evidence: 'string[]',
  chapterRange: '[start, end]',
  resolved: 'boolean',
  resolution: 'string',
  resolvedAt: 'timestamp',
  detectedAt: 'timestamp',
};

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeConsistencyRisk(raw = {}, defaults = {}) {
  const merged = { ...defaults, ...(raw || {}) };
  const severity = String(merged.severity || '').toLowerCase();

  return {
    id: merged.id || null,
    corpusId: merged.corpusId || merged.corpus_id || null,
    analysisId: merged.analysisId || merged.analysis_id || null,
    type: Object.values(CONFLICT_TYPES).includes(merged.type)
      ? merged.type
      : CONFLICT_TYPES.EVIDENCE_MISMATCH,
    severity: ['hard', 'medium', 'soft'].includes(severity) ? severity : 'soft',
    description: String(merged.description || '').trim(),
    details: merged.details && typeof merged.details === 'object' ? merged.details : {},
    involvedIncidents: toArray(merged.involvedIncidents || merged.involved_incidents),
    involvedEvents: toArray(merged.involvedEvents || merged.involved_events),
    involvedLocations: toArray(merged.involvedLocations || merged.involved_locations),
    evidence: toArray(merged.evidence).map((item) => String(item).trim()).filter(Boolean),
    chapterRange: [
      Number.isFinite(Number(merged.chapterStart ?? merged.chapter_start))
        ? Number(merged.chapterStart ?? merged.chapter_start)
        : null,
      Number.isFinite(Number(merged.chapterEnd ?? merged.chapter_end))
        ? Number(merged.chapterEnd ?? merged.chapter_end)
        : null,
    ],
    resolved: Boolean(merged.resolved),
    resolution: String(merged.resolution || '').trim(),
    resolvedAt: merged.resolvedAt || merged.resolved_at || null,
    detectedAt: merged.detectedAt || merged.detected_at || null,
  };
}

export function getSeverityConfig(severity) {
  const key = String(severity || '').toUpperCase();
  return CONFLICT_SEVERITY[key] || CONFLICT_SEVERITY.SOFT;
}
