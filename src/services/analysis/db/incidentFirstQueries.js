import { getCorpusDb } from '../../corpus/db/schema.js';
import { randomUUID } from 'node:crypto';

function toNumber(value, fallback = null) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function mapIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    title: row.title,
    type: row.type,
    description: row.description,
    startChapterId: row.start_chapter_id,
    startChunkId: row.start_chunk_id,
    endChapterId: row.end_chapter_id,
    endChunkId: row.end_chunk_id,
    chapterStartIndex: toNumber(row.chapter_start_index),
    chapterEndIndex: toNumber(row.chapter_end_index),
    chunkStartIndex: toNumber(row.chunk_start_index),
    chunkEndIndex: toNumber(row.chunk_end_index),
    startAnchor: safeParseJson(row.start_anchor, null),
    activeSpan: toNumber(row.active_span, 0),
    climaxAnchor: safeParseJson(row.climax_anchor, null),
    endAnchor: safeParseJson(row.end_anchor, null),
    boundaryNote: row.boundary_note,
    uncertainStart: Boolean(row.uncertain_start),
    uncertainEnd: Boolean(row.uncertain_end),
    confidence: toNumber(row.confidence, 0),
    evidence: safeParseJson(row.evidence, []),
    containedEvents: safeParseJson(row.contained_events, []),
    subIncidentIds: safeParseJson(row.sub_incident_ids, []),
    relatedIncidents: safeParseJson(row.related_incidents, []),
    relatedLocations: safeParseJson(row.related_locations, []),
    causalPredecessors: safeParseJson(row.causal_predecessors, []),
    causalSuccessors: safeParseJson(row.causal_successors, []),
    majorScore: toNumber(row.major_score, 0),
    impactScore: toNumber(row.impact_score, 0),
    status: row.status,
    reviewStatus: row.review_status,
    priority: row.priority,
    createdAt: toNumber(row.created_at),
    analyzedAt: toNumber(row.analyzed_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapAnalysisEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    title: row.title,
    description: row.description,
    severity: toNumber(row.severity, 0),
    tags: safeParseJson(row.tags, []),
    chapterId: row.chapter_id,
    chapterIndex: toNumber(row.chapter_index),
    chunkId: row.chunk_id,
    chunkIndex: toNumber(row.chunk_index),
    incidentId: row.incident_id,
    linkRole: row.link_role,
    secondaryIncidentIds: safeParseJson(row.secondary_incident_ids, []),
    locationLink: safeParseJson(row.location_link, null),
    causalLinks: safeParseJson(row.causal_links, { causes: [], causedBy: [] }),
    confidence: toNumber(row.confidence, 0),
    evidence: safeParseJson(row.evidence, []),
    qualityProxy: toNumber(row.quality_proxy, 0),
    reviewStatus: row.review_status,
    needsReview: Boolean(row.needs_review),
    annotation: row.annotation,
    createdAt: toNumber(row.created_at),
    groundedAt: toNumber(row.grounded_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapAnalysisLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    name: row.name,
    normalized: row.normalized,
    aliases: safeParseJson(row.aliases, []),
    mentionCount: toNumber(row.mention_count, 0),
    chapterStart: toNumber(row.chapter_start),
    chapterEnd: toNumber(row.chapter_end),
    chapterSpread: safeParseJson(row.chapter_spread, [null, null]),
    importance: toNumber(row.importance, 0),
    isMajor: Boolean(row.is_major),
    tokens: safeParseJson(row.tokens, []),
    evidence: safeParseJson(row.evidence, []),
    incidentIds: safeParseJson(row.incident_ids, []),
    eventIds: safeParseJson(row.event_ids, []),
    confidence: toNumber(row.confidence, 0),
    evidenceStrength: toNumber(row.evidence_strength, 0),
    reviewStatus: row.review_status,
    createdAt: toNumber(row.created_at),
    reviewedAt: toNumber(row.reviewed_at),
  };
}

function mapConsistencyRisk(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    type: row.type,
    severity: row.severity,
    description: row.description,
    details: safeParseJson(row.details, {}),
    involvedIncidents: safeParseJson(row.involved_incidents, []),
    involvedEvents: safeParseJson(row.involved_events, []),
    involvedLocations: safeParseJson(row.involved_locations, []),
    evidence: safeParseJson(row.evidence, []),
    chapterStart: toNumber(row.chapter_start),
    chapterEnd: toNumber(row.chapter_end),
    resolved: Boolean(row.resolved),
    resolution: row.resolution,
    resolvedAt: toNumber(row.resolved_at),
    detectedAt: toNumber(row.detected_at),
  };
}

function mapReviewQueueItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    itemType: row.item_type,
    itemId: row.item_id,
    priority: row.priority,
    priorityScore: toNumber(row.priority_score, 0),
    scoreBreakdown: safeParseJson(row.score_breakdown, {}),
    reason: safeParseJson(row.reason, []),
    suggestions: safeParseJson(row.suggestions, []),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: toNumber(row.reviewed_at),
    resolution: row.resolution,
    createdAt: toNumber(row.created_at),
  };
}

export function upsertIncident(payload = {}) {
  const db = getCorpusDb();
  const id = payload.id || randomUUID();

  db.prepare(`
    INSERT INTO incidents (
      id, corpus_id, analysis_id, title, type, description,
      start_chapter_id, start_chunk_id, end_chapter_id, end_chunk_id,
      chapter_start_index, chapter_end_index, chunk_start_index, chunk_end_index,
      start_anchor, active_span, climax_anchor, end_anchor, boundary_note,
      uncertain_start, uncertain_end, confidence, evidence,
      contained_events, sub_incident_ids, related_incidents, related_locations,
      causal_predecessors, causal_successors, major_score, impact_score,
      status, review_status, priority, created_at, analyzed_at, reviewed_at
    ) VALUES (
      @id, @corpusId, @analysisId, @title, @type, @description,
      @startChapterId, @startChunkId, @endChapterId, @endChunkId,
      @chapterStartIndex, @chapterEndIndex, @chunkStartIndex, @chunkEndIndex,
      @startAnchor, @activeSpan, @climaxAnchor, @endAnchor, @boundaryNote,
      @uncertainStart, @uncertainEnd, @confidence, @evidence,
      @containedEvents, @subIncidentIds, @relatedIncidents, @relatedLocations,
      @causalPredecessors, @causalSuccessors, @majorScore, @impactScore,
      @status, @reviewStatus, @priority, @createdAt, @analyzedAt, @reviewedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      corpus_id = excluded.corpus_id,
      analysis_id = excluded.analysis_id,
      title = excluded.title,
      type = excluded.type,
      description = excluded.description,
      start_chapter_id = excluded.start_chapter_id,
      start_chunk_id = excluded.start_chunk_id,
      end_chapter_id = excluded.end_chapter_id,
      end_chunk_id = excluded.end_chunk_id,
      chapter_start_index = excluded.chapter_start_index,
      chapter_end_index = excluded.chapter_end_index,
      chunk_start_index = excluded.chunk_start_index,
      chunk_end_index = excluded.chunk_end_index,
      start_anchor = excluded.start_anchor,
      active_span = excluded.active_span,
      climax_anchor = excluded.climax_anchor,
      end_anchor = excluded.end_anchor,
      boundary_note = excluded.boundary_note,
      uncertain_start = excluded.uncertain_start,
      uncertain_end = excluded.uncertain_end,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      contained_events = excluded.contained_events,
      sub_incident_ids = excluded.sub_incident_ids,
      related_incidents = excluded.related_incidents,
      related_locations = excluded.related_locations,
      causal_predecessors = excluded.causal_predecessors,
      causal_successors = excluded.causal_successors,
      major_score = excluded.major_score,
      impact_score = excluded.impact_score,
      status = excluded.status,
      review_status = excluded.review_status,
      priority = excluded.priority,
      analyzed_at = excluded.analyzed_at,
      reviewed_at = excluded.reviewed_at
  `).run({
    id,
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    title: payload.title || 'Untitled incident',
    type: payload.type || 'subplot',
    description: payload.description || null,
    startChapterId: payload.startChapterId || null,
    startChunkId: payload.startChunkId || null,
    endChapterId: payload.endChapterId || null,
    endChunkId: payload.endChunkId || null,
    chapterStartIndex: toNumber(payload.chapterStartIndex ?? payload.chapterRange?.[0]),
    chapterEndIndex: toNumber(payload.chapterEndIndex ?? payload.chapterRange?.[1]),
    chunkStartIndex: toNumber(payload.chunkStartIndex ?? payload.chunkRange?.[0]),
    chunkEndIndex: toNumber(payload.chunkEndIndex ?? payload.chunkRange?.[1]),
    startAnchor: toJson(payload.startAnchor),
    activeSpan: toNumber(payload.activeSpan, 0),
    climaxAnchor: toJson(payload.climaxAnchor),
    endAnchor: toJson(payload.endAnchor),
    boundaryNote: payload.boundaryNote || null,
    uncertainStart: payload.uncertainStart ? 1 : 0,
    uncertainEnd: payload.uncertainEnd ? 1 : 0,
    confidence: toNumber(payload.confidence, 0),
    evidence: toJson(payload.evidence || []),
    containedEvents: toJson(payload.containedEvents || payload.eventIds || []),
    subIncidentIds: toJson(payload.subIncidentIds || []),
    relatedIncidents: toJson(payload.relatedIncidents || []),
    relatedLocations: toJson(payload.relatedLocations || []),
    causalPredecessors: toJson(payload.causalPredecessors || []),
    causalSuccessors: toJson(payload.causalSuccessors || []),
    majorScore: toNumber(payload.majorScore, 0),
    impactScore: toNumber(payload.impactScore, 0),
    status: payload.status || 'pending',
    reviewStatus: payload.reviewStatus || 'needs_review',
    priority: payload.priority || null,
    createdAt: payload.createdAt || Date.now(),
    analyzedAt: payload.analyzedAt || null,
    reviewedAt: payload.reviewedAt || null,
  });

  return getIncidentById(id);
}

export function getIncidentById(incidentId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId);
  return mapIncident(row);
}

export function listIncidentsByAnalysis(analysisId) {
  const db = getCorpusDb();
  const rows = db.prepare(`
    SELECT *
    FROM incidents
    WHERE analysis_id = ?
    ORDER BY chapter_start_index ASC, confidence DESC
  `).all(analysisId);
  return rows.map(mapIncident);
}

export function getLatestAnalysisIdForCorpus(corpusId, options = {}) {
  const db = getCorpusDb();
  const includeNonTerminal = options.includeNonTerminal === true;

  const row = includeNonTerminal
    ? db.prepare(`
      SELECT id
      FROM corpus_analyses
      WHERE corpus_id = @corpusId
      ORDER BY created_at DESC
      LIMIT 1
    `).get({ corpusId })
    : db.prepare(`
      SELECT id
      FROM corpus_analyses
      WHERE corpus_id = @corpusId
        AND status IN ('completed', 'processing', 'pending')
      ORDER BY
        CASE status
          WHEN 'completed' THEN 0
          WHEN 'processing' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END ASC,
        created_at DESC
      LIMIT 1
    `).get({ corpusId });

  return row?.id || null;
}

export function listIncidentsByCorpus(corpusId, options = {}) {
  const analysisId = options.analysisId || getLatestAnalysisIdForCorpus(corpusId, {
    includeNonTerminal: options.includeNonTerminal,
  });
  if (!analysisId) return { analysisId: null, incidents: [] };
  return {
    analysisId,
    incidents: listIncidentsByAnalysis(analysisId),
  };
}

export function upsertAnalysisEvent(payload = {}) {
  const db = getCorpusDb();
  const id = payload.id || randomUUID();

  db.prepare(`
    INSERT INTO analysis_events (
      id, corpus_id, analysis_id, title, description, severity, tags,
      chapter_id, chapter_index, chunk_id, chunk_index,
      incident_id, link_role, secondary_incident_ids, location_link, causal_links,
      confidence, evidence, quality_proxy, review_status, needs_review, annotation,
      created_at, grounded_at, reviewed_at
    ) VALUES (
      @id, @corpusId, @analysisId, @title, @description, @severity, @tags,
      @chapterId, @chapterIndex, @chunkId, @chunkIndex,
      @incidentId, @linkRole, @secondaryIncidentIds, @locationLink, @causalLinks,
      @confidence, @evidence, @qualityProxy, @reviewStatus, @needsReview, @annotation,
      @createdAt, @groundedAt, @reviewedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      corpus_id = excluded.corpus_id,
      analysis_id = excluded.analysis_id,
      title = excluded.title,
      description = excluded.description,
      severity = excluded.severity,
      tags = excluded.tags,
      chapter_id = excluded.chapter_id,
      chapter_index = excluded.chapter_index,
      chunk_id = excluded.chunk_id,
      chunk_index = excluded.chunk_index,
      incident_id = excluded.incident_id,
      link_role = excluded.link_role,
      secondary_incident_ids = excluded.secondary_incident_ids,
      location_link = excluded.location_link,
      causal_links = excluded.causal_links,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      quality_proxy = excluded.quality_proxy,
      review_status = excluded.review_status,
      needs_review = excluded.needs_review,
      annotation = excluded.annotation,
      grounded_at = excluded.grounded_at,
      reviewed_at = excluded.reviewed_at
  `).run({
    id,
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    title: payload.title || payload.description || 'Untitled event',
    description: payload.description || null,
    severity: toNumber(payload.severity, 0),
    tags: toJson(payload.tags || []),
    chapterId: payload.chapterId || null,
    chapterIndex: toNumber(payload.chapterIndex),
    chunkId: payload.chunkId || null,
    chunkIndex: toNumber(payload.chunkIndex),
    incidentId: payload.incidentId || null,
    linkRole: payload.linkRole || 'primary',
    secondaryIncidentIds: toJson(payload.secondaryIncidentIds || []),
    locationLink: toJson(payload.locationLink),
    causalLinks: toJson(payload.causalLinks || { causes: [], causedBy: [] }),
    confidence: toNumber(payload.confidence, 0),
    evidence: toJson(payload.evidence || []),
    qualityProxy: toNumber(payload.qualityProxy, 0),
    reviewStatus: payload.reviewStatus || 'needs_review',
    needsReview: payload.needsReview ? 1 : 0,
    annotation: payload.annotation || null,
    createdAt: payload.createdAt || Date.now(),
    groundedAt: payload.groundedAt || null,
    reviewedAt: payload.reviewedAt || null,
  });

  return getAnalysisEventById(id);
}

export function getAnalysisEventById(eventId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM analysis_events WHERE id = ?').get(eventId);
  return mapAnalysisEvent(row);
}

export function listAnalysisEventsByAnalysis(analysisId) {
  const db = getCorpusDb();
  const rows = db.prepare(`
    SELECT *
    FROM analysis_events
    WHERE analysis_id = ?
    ORDER BY chapter_index ASC, confidence DESC
  `).all(analysisId);
  return rows.map(mapAnalysisEvent);
}

export function listAnalysisEventsByIncident(incidentId) {
  const db = getCorpusDb();
  const rows = db.prepare(`
    SELECT *
    FROM analysis_events
    WHERE incident_id = ?
    ORDER BY chapter_index ASC, confidence DESC
  `).all(incidentId);
  return rows.map(mapAnalysisEvent);
}

export function upsertAnalysisLocation(payload = {}) {
  const db = getCorpusDb();
  const id = payload.id || randomUUID();

  db.prepare(`
    INSERT INTO analysis_locations (
      id, corpus_id, analysis_id, name, normalized, aliases,
      mention_count, chapter_start, chapter_end, chapter_spread,
      importance, is_major, tokens, evidence, incident_ids, event_ids,
      confidence, evidence_strength, review_status, created_at, reviewed_at
    ) VALUES (
      @id, @corpusId, @analysisId, @name, @normalized, @aliases,
      @mentionCount, @chapterStart, @chapterEnd, @chapterSpread,
      @importance, @isMajor, @tokens, @evidence, @incidentIds, @eventIds,
      @confidence, @evidenceStrength, @reviewStatus, @createdAt, @reviewedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      corpus_id = excluded.corpus_id,
      analysis_id = excluded.analysis_id,
      name = excluded.name,
      normalized = excluded.normalized,
      aliases = excluded.aliases,
      mention_count = excluded.mention_count,
      chapter_start = excluded.chapter_start,
      chapter_end = excluded.chapter_end,
      chapter_spread = excluded.chapter_spread,
      importance = excluded.importance,
      is_major = excluded.is_major,
      tokens = excluded.tokens,
      evidence = excluded.evidence,
      incident_ids = excluded.incident_ids,
      event_ids = excluded.event_ids,
      confidence = excluded.confidence,
      evidence_strength = excluded.evidence_strength,
      review_status = excluded.review_status,
      reviewed_at = excluded.reviewed_at
  `).run({
    id,
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    name: payload.name || 'Unknown location',
    normalized: payload.normalized || String(payload.name || '').toLowerCase(),
    aliases: toJson(payload.aliases || []),
    mentionCount: toNumber(payload.mentionCount, 0),
    chapterStart: toNumber(payload.chapterStart),
    chapterEnd: toNumber(payload.chapterEnd),
    chapterSpread: toJson(payload.chapterSpread || [payload.chapterStart ?? null, payload.chapterEnd ?? null]),
    importance: toNumber(payload.importance, 0),
    isMajor: payload.isMajor ? 1 : 0,
    tokens: toJson(payload.tokens || []),
    evidence: toJson(payload.evidence || []),
    incidentIds: toJson(payload.incidentIds || []),
    eventIds: toJson(payload.eventIds || []),
    confidence: toNumber(payload.confidence, 0),
    evidenceStrength: toNumber(payload.evidenceStrength, 0),
    reviewStatus: payload.reviewStatus || 'needs_review',
    createdAt: payload.createdAt || Date.now(),
    reviewedAt: payload.reviewedAt || null,
  });

  return getAnalysisLocationById(id);
}

export function getAnalysisLocationById(locationId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM analysis_locations WHERE id = ?').get(locationId);
  return mapAnalysisLocation(row);
}

export function listAnalysisLocationsByAnalysis(analysisId) {
  const db = getCorpusDb();
  const rows = db.prepare(`
    SELECT *
    FROM analysis_locations
    WHERE analysis_id = ?
    ORDER BY importance DESC, mention_count DESC
  `).all(analysisId);
  return rows.map(mapAnalysisLocation);
}

export function upsertConsistencyRisk(payload = {}) {
  const db = getCorpusDb();
  const id = payload.id || randomUUID();

  db.prepare(`
    INSERT INTO consistency_risks (
      id, corpus_id, analysis_id, type, severity, description, details,
      involved_incidents, involved_events, involved_locations, evidence,
      chapter_start, chapter_end, resolved, resolution, resolved_at, detected_at
    ) VALUES (
      @id, @corpusId, @analysisId, @type, @severity, @description, @details,
      @involvedIncidents, @involvedEvents, @involvedLocations, @evidence,
      @chapterStart, @chapterEnd, @resolved, @resolution, @resolvedAt, @detectedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      corpus_id = excluded.corpus_id,
      analysis_id = excluded.analysis_id,
      type = excluded.type,
      severity = excluded.severity,
      description = excluded.description,
      details = excluded.details,
      involved_incidents = excluded.involved_incidents,
      involved_events = excluded.involved_events,
      involved_locations = excluded.involved_locations,
      evidence = excluded.evidence,
      chapter_start = excluded.chapter_start,
      chapter_end = excluded.chapter_end,
      resolved = excluded.resolved,
      resolution = excluded.resolution,
      resolved_at = excluded.resolved_at
  `).run({
    id,
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    type: payload.type || 'evidence_mismatch',
    severity: payload.severity || 'soft',
    description: payload.description || null,
    details: toJson(payload.details || {}),
    involvedIncidents: toJson(payload.involvedIncidents || []),
    involvedEvents: toJson(payload.involvedEvents || []),
    involvedLocations: toJson(payload.involvedLocations || []),
    evidence: toJson(payload.evidence || []),
    chapterStart: toNumber(payload.chapterStart ?? payload.chapterRange?.[0]),
    chapterEnd: toNumber(payload.chapterEnd ?? payload.chapterRange?.[1]),
    resolved: payload.resolved ? 1 : 0,
    resolution: payload.resolution || null,
    resolvedAt: payload.resolvedAt || null,
    detectedAt: payload.detectedAt || Date.now(),
  });

  return getConsistencyRiskById(id);
}

export function getConsistencyRiskById(riskId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM consistency_risks WHERE id = ?').get(riskId);
  return mapConsistencyRisk(row);
}

export function listConsistencyRisksByAnalysis(analysisId, options = {}) {
  const db = getCorpusDb();
  const resolvedFilter = options.resolved;
  const hasResolvedFilter = resolvedFilter === true || resolvedFilter === false;

  const rows = hasResolvedFilter
    ? db.prepare(`
      SELECT *
      FROM consistency_risks
      WHERE analysis_id = @analysisId AND resolved = @resolved
      ORDER BY detected_at DESC
    `).all({ analysisId, resolved: resolvedFilter ? 1 : 0 })
    : db.prepare(`
      SELECT *
      FROM consistency_risks
      WHERE analysis_id = ?
      ORDER BY detected_at DESC
    `).all(analysisId);

  return rows.map(mapConsistencyRisk);
}

export function upsertReviewQueueItem(payload = {}) {
  const db = getCorpusDb();
  const id = payload.id || randomUUID();

  db.prepare(`
    INSERT INTO review_queue (
      id, corpus_id, analysis_id, item_type, item_id,
      priority, priority_score, score_breakdown, reason, suggestions,
      status, reviewed_by, reviewed_at, resolution, created_at
    ) VALUES (
      @id, @corpusId, @analysisId, @itemType, @itemId,
      @priority, @priorityScore, @scoreBreakdown, @reason, @suggestions,
      @status, @reviewedBy, @reviewedAt, @resolution, @createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      corpus_id = excluded.corpus_id,
      analysis_id = excluded.analysis_id,
      item_type = excluded.item_type,
      item_id = excluded.item_id,
      priority = excluded.priority,
      priority_score = excluded.priority_score,
      score_breakdown = excluded.score_breakdown,
      reason = excluded.reason,
      suggestions = excluded.suggestions,
      status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      resolution = excluded.resolution
  `).run({
    id,
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    itemType: payload.itemType || 'event',
    itemId: payload.itemId || '',
    priority: payload.priority || 'P2',
    priorityScore: toNumber(payload.priorityScore, 0),
    scoreBreakdown: toJson(payload.scoreBreakdown || {}),
    reason: toJson(payload.reason || []),
    suggestions: toJson(payload.suggestions || []),
    status: payload.status || 'pending',
    reviewedBy: payload.reviewedBy || null,
    reviewedAt: payload.reviewedAt || null,
    resolution: payload.resolution || null,
    createdAt: payload.createdAt || Date.now(),
  });

  return getReviewQueueItemById(id);
}

export function getReviewQueueItemById(itemId) {
  const db = getCorpusDb();
  const row = db.prepare('SELECT * FROM review_queue WHERE id = ?').get(itemId);
  return mapReviewQueueItem(row);
}

export function listReviewQueueByAnalysis(analysisId, options = {}) {
  const db = getCorpusDb();
  const status = String(options.status || '').trim();
  const priority = String(options.priority || '').trim();
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
  const offset = Math.max(0, Number(options.offset) || 0);

  const hasStatus = Boolean(status);
  const hasPriority = ['P0', 'P1', 'P2'].includes(priority);

  const rows = hasStatus || hasPriority
    ? db.prepare(`
      SELECT *
      FROM review_queue
      WHERE analysis_id = @analysisId
        ${hasStatus ? 'AND status = @status' : ''}
        ${hasPriority ? 'AND priority = @priority' : ''}
      ORDER BY
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END ASC,
        priority_score DESC,
        created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ analysisId, status, priority, limit, offset })
    : db.prepare(`
      SELECT *
      FROM review_queue
      WHERE analysis_id = @analysisId
      ORDER BY
        CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END ASC,
        priority_score DESC,
        created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ analysisId, limit, offset });

  return rows.map(mapReviewQueueItem);
}

export function getReviewQueueStatsByAnalysis(analysisId) {
  const db = getCorpusDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN priority = 'P0' THEN 1 ELSE 0 END) AS p0,
      SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) AS p1,
      SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) AS p2,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM review_queue
    WHERE analysis_id = @analysisId
  `).get({ analysisId });

  return {
    total: toNumber(row?.total, 0),
    P0: toNumber(row?.p0, 0),
    P1: toNumber(row?.p1, 0),
    P2: toNumber(row?.p2, 0),
    pending: toNumber(row?.pending, 0),
  };
}

function runDeleteIncidentFirstArtifactsByAnalysis(db, analysisId) {
  db.prepare('DELETE FROM review_queue WHERE analysis_id = ?').run(analysisId);
  db.prepare('DELETE FROM consistency_risks WHERE analysis_id = ?').run(analysisId);
  db.prepare('DELETE FROM analysis_events WHERE analysis_id = ?').run(analysisId);
  db.prepare('DELETE FROM analysis_locations WHERE analysis_id = ?').run(analysisId);
  db.prepare('DELETE FROM incidents WHERE analysis_id = ?').run(analysisId);
}

export function deleteIncidentFirstArtifactsByAnalysis(analysisId) {
  const db = getCorpusDb();
  const tx = db.transaction(() => {
    runDeleteIncidentFirstArtifactsByAnalysis(db, analysisId);
  });
  tx();
}

export function replaceIncidentFirstArtifacts(payload = {}) {
  const db = getCorpusDb();
  const tx = db.transaction(() => {
    runDeleteIncidentFirstArtifactsByAnalysis(db, payload.analysisId);

    for (const incident of (payload.incidents || [])) {
      upsertIncident({ ...incident, corpusId: payload.corpusId, analysisId: payload.analysisId });
    }
    for (const event of (payload.events || [])) {
      upsertAnalysisEvent({ ...event, corpusId: payload.corpusId, analysisId: payload.analysisId });
    }
    for (const location of (payload.locations || [])) {
      upsertAnalysisLocation({ ...location, corpusId: payload.corpusId, analysisId: payload.analysisId });
    }
    for (const risk of (payload.consistencyRisks || [])) {
      upsertConsistencyRisk({ ...risk, corpusId: payload.corpusId, analysisId: payload.analysisId });
    }
    for (const item of (payload.reviewQueue || [])) {
      upsertReviewQueueItem({ ...item, corpusId: payload.corpusId, analysisId: payload.analysisId });
    }
  });

  tx();

  return {
    incidents: listIncidentsByAnalysis(payload.analysisId),
    events: listAnalysisEventsByAnalysis(payload.analysisId),
    locations: listAnalysisLocationsByAnalysis(payload.analysisId),
    consistencyRisks: listConsistencyRisksByAnalysis(payload.analysisId),
    reviewQueue: listReviewQueueByAnalysis(payload.analysisId),
  };
}
