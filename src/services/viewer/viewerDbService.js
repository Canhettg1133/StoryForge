/**
 * viewerDbService - Database operations for Phase 4 Analysis Viewer
 * Handles: event_annotations, saved_searches, export_history, event_usage, linked_events
 *
 * IMPORTANT: Dexie compound index syntax uses '[field1+field2]' as a single string key.
 * Queries use .where('[field1+field2]').equals([val1, val2])
 */

import db from '../db/database.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function toComparableName(value) {
  return normalizeText(value).toLowerCase();
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = '{}') {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return fallback;
  }
}

function buildCanonFactDescription(eventPayload, notes = '') {
  const chapter = Number(eventPayload?.chapter);
  const chapterLabel = Number.isFinite(chapter) && chapter > 0 ? `Ch.${chapter}` : 'Ch.?';
  const severity = normalizeText(eventPayload?.severity || 'unknown');
  const locationName = normalizeText(
    eventPayload?.locationLink?.locationName
    || eventPayload?.primaryLocationName
    || '',
  );
  const base = normalizeText(eventPayload?.description || '');
  const parts = [
    `[Corpus Event] ${chapterLabel} | ${severity}`,
    locationName ? `@ ${locationName}` : '',
    base,
    notes ? `Ghi chu: ${normalizeText(notes)}` : '',
  ].filter(Boolean);
  return parts.join(' - ');
}

async function upsertProjectLocationFromEvent(projectId, eventPayload) {
  const locationName = normalizeText(
    eventPayload?.locationLink?.locationName
    || eventPayload?.primaryLocationName
    || '',
  );

  if (!projectId || !locationName) {
    return null;
  }

  const normalized = toComparableName(locationName);
  const existing = await db.locations
    .where('project_id')
    .equals(projectId)
    .filter((item) => toComparableName(item?.name) === normalized)
    .first();

  const detailParts = [
    normalizeText(eventPayload?.locationLink?.evidenceSnippet || ''),
    normalizeText(eventPayload?.grounding?.evidenceSnippet || ''),
  ].filter(Boolean);
  const details = detailParts.join('\n\n');

  if (existing) {
    const patch = {};
    if (!normalizeText(existing.description)) {
      patch.description = `Nhap tu Corpus Analysis (${locationName})`;
    }
    if (details && !normalizeText(existing.details)) {
      patch.details = details;
    }
    if (Object.keys(patch).length > 0) {
      await db.locations.update(existing.id, patch);
    }
    return existing.id;
  }

  return db.locations.add({
    project_id: projectId,
    name: locationName,
    aliases: [],
    description: `Nhap tu Corpus Analysis (${locationName})`,
    details: details || '',
    parent_location_id: null,
    created_at: Date.now(),
    source_type: 'analysis_event',
    source_event_id: normalizeText(eventPayload?.id || ''),
  });
}

async function upsertCanonFactFromEvent({
  eventId,
  corpusId,
  projectId,
  chapterId,
  notes = '',
  eventPayload = null,
  linkedEventId = null,
}) {
  if (!projectId || !eventId || !eventPayload) {
    return null;
  }

  const sourceEventId = normalizeText(eventPayload.id || eventId);
  if (!sourceEventId) {
    return null;
  }

  const existing = await db.canonFacts
    .where('project_id')
    .equals(projectId)
    .filter((fact) => (
      fact?.source_type === 'analysis_event'
      && normalizeText(fact?.source_event_id) === sourceEventId
    ))
    .first();

  const description = buildCanonFactDescription(eventPayload, notes);
  const patch = {
    fact_type: 'fact',
    status: 'active',
    source_chapter_id: chapterId || null,
    source_type: 'analysis_event',
    source_event_id: sourceEventId,
    source_corpus_id: corpusId || null,
    source_link_id: linkedEventId || null,
    event_severity: normalizeText(eventPayload.severity || ''),
    event_chapter: Number.isFinite(Number(eventPayload.chapter))
      ? Number(eventPayload.chapter)
      : null,
    event_location_name: normalizeText(
      eventPayload.locationLink?.locationName
      || eventPayload.primaryLocationName
      || '',
    ),
    event_review_status: normalizeText(eventPayload.reviewStatus || ''),
    event_tags: Array.isArray(eventPayload.tags) ? eventPayload.tags : [],
    event_quality_score: Number(eventPayload?.quality?.score || 0),
    event_grounding_evidence: normalizeText(
      eventPayload?.grounding?.evidenceSnippet
      || eventPayload?.locationLink?.evidenceSnippet
      || '',
    ),
    notes: normalizeText(notes),
    auto_generated: true,
  };

  if (existing) {
    await db.canonFacts.update(existing.id, {
      ...patch,
      description: normalizeText(existing.description) || description,
    });
    return existing.id;
  }

  return db.canonFacts.add({
    project_id: projectId,
    description,
    ...patch,
    created_at: Date.now(),
  });
}

async function materializeLinkedEventToProject({
  eventId,
  corpusId,
  projectId,
  chapterId,
  notes,
  eventPayload,
  linkedEventId,
}) {
  if (!eventPayload || !projectId) {
    return { locationId: null, canonFactId: null };
  }

  const locationId = await upsertProjectLocationFromEvent(projectId, eventPayload);
  const canonFactId = await upsertCanonFactFromEvent({
    eventId,
    corpusId,
    projectId,
    chapterId,
    notes,
    eventPayload,
    linkedEventId,
  });

  return { locationId, canonFactId };
}

function summarizeAnalysisResult(result) {
  const raw = safeJsonParse(result, result) || {};
  const l2 = raw?.events || raw?.resultL2 || {};
  const majorEvents = l2?.majorEvents || l2?.major || l2?.major_events || [];
  const minorEvents = l2?.minorEvents || l2?.minor || l2?.minor_events || [];
  const twists = l2?.plotTwists || l2?.twists || l2?.plot_twists || [];
  const cliffhangers = l2?.cliffhangers || l2?.cliffhanger || l2?.cliff_hangers || [];
  const locations = raw?.locations || raw?.locationEntities || raw?.worldbuilding?.locations || [];
  const incidents = raw?.incidents || raw?.incidentClusters || [];

  const count = (list) => (Array.isArray(list) ? list.length : 0);

  return {
    majorEvents: count(majorEvents),
    minorEvents: count(minorEvents),
    twists: count(twists),
    cliffhangers: count(cliffhangers),
    totalEvents: count(majorEvents) + count(minorEvents) + count(twists) + count(cliffhangers),
    locations: count(locations),
    incidents: count(incidents),
  };
}

// ─── Event Annotations ────────────────────────────────────────────────────────

/**
 * Get annotation for a specific event
 */
export async function getAnnotation(corpusId, eventId) {
  const results = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .toArray();
  return results[0] || null;
}

/**
 * Get all annotations for a corpus
 */
export async function getAnnotationsForCorpus(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
}

/**
 * Get starred annotations only
 */
export async function getStarredAnnotations(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => a.starred)
    .toArray();
}

/**
 * Get annotations with notes
 */
export async function getAnnotatedEvents(corpusId) {
  return db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => Boolean(a.note))
    .toArray();
}

/**
 * Save (upsert) annotation for an event
 */
export async function saveAnnotation(corpusId, eventId, data) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();

  const record = {
    corpus_id: corpusId,
    event_id: eventId,
    note: data.note ?? '',
    custom_tags: Array.isArray(data.customTags) ? data.customTags : (data.custom_tags || []),
    starred: Boolean(data.starred),
    usage_count: existing?.usage_count ?? 0,
    linked_project_ids: Array.isArray(data.linkedProjectIds)
      ? data.linkedProjectIds
      : (data.linked_project_ids || []),
    updated_at: Date.now(),
  };

  if (existing) {
    await db.event_annotations.update(existing.id, record);
    return existing.id;
  } else {
    record.created_at = Date.now();
    return db.event_annotations.add(record);
  }
}

/**
 * Delete annotation
 */
export async function deleteAnnotation(corpusId, eventId) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_annotations.delete(existing.id);
  }
}

/**
 * Toggle star on annotation
 */
export async function toggleAnnotationStar(corpusId, eventId) {
  const existing = await db.event_annotations
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_annotations.update(existing.id, {
      starred: !existing.starred,
      updated_at: Date.now(),
    });
    return !existing.starred;
  }
  return false;
}

/**
 * Batch update annotations (e.g., after editing events)
 */
export async function batchUpdateAnnotations(corpusId, eventIds, updates) {
  const annotations = await db.event_annotations
    .where('corpus_id')
    .equals(corpusId)
    .filter(a => eventIds.includes(a.event_id))
    .toArray();

  await db.event_annotations.bulkPut(
    annotations.map(a => ({
      ...a,
      ...updates,
      updated_at: Date.now(),
    }))
  );
}

// ─── Saved Searches ───────────────────────────────────────────────────────────

/**
 * Get all saved searches for a corpus (non-history only)
 */
export async function getSavedSearches(corpusId) {
  return db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => !s.name?.startsWith('__history__'))
    .reverse()
    .sortBy('created_at');
}

/**
 * Get all saved searches (global)
 */
export async function getAllSavedSearches() {
  return db.saved_searches
    .filter(s => !s.name?.startsWith('__history__'))
    .reverse()
    .sortBy('created_at');
}

/**
 * Save a named search query
 */
export async function saveSearch(search) {
  const record = {
    corpus_id: search.corpusId || null,
    name: search.name || `Search ${new Date().toLocaleString('vi-VN')}`,
    query: search.query || '',
    filters: typeof search.filters === 'object' ? JSON.stringify(search.filters) : (search.filters || '{}'),
    created_at: Date.now(),
  };
  return db.saved_searches.add(record);
}

/**
 * Update a saved search
 */
export async function updateSavedSearch(id, updates) {
  const patch = { ...updates };
  if (updates.filters && typeof updates.filters === 'object') {
    patch.filters = JSON.stringify(updates.filters);
  }
  patch.created_at = Date.now();
  await db.saved_searches.update(id, patch);
}

/**
 * Delete a saved search
 */
export async function deleteSavedSearch(id) {
  await db.saved_searches.delete(id);
}

/**
 * Find saved search by name for a corpus
 */
export async function findSavedSearchByName(corpusId, name) {
  const results = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name === name)
    .toArray();
  return results[0] || null;
}

// ─── Search History ────────────────────────────────────────────────────────────

const MAX_SEARCH_HISTORY = 50;

/**
 * Add query to search history (deduplicated, newest first)
 */
export async function addToSearchHistory(corpusId, query, filters = {}) {
  if (!query || !query.trim()) return;

  // Remove duplicate if exists
  const existing = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.query === query && s.name?.startsWith('__history__'))
    .toArray();

  for (const item of existing) {
    await db.saved_searches.delete(item.id);
  }

  // Add new entry with history marker
  const record = {
    corpus_id: corpusId,
    name: `__history__${query.substring(0, 60)}`,
    query: query.trim(),
    filters: JSON.stringify(filters),
    created_at: Date.now(),
  };
  const id = await db.saved_searches.add(record);

  // Trim history to max entries
  const allHistory = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  if (allHistory.length > MAX_SEARCH_HISTORY) {
    const sorted = allHistory.sort((a, b) => b.created_at - a.created_at);
    const toDelete = sorted.slice(MAX_SEARCH_HISTORY);
    await db.saved_searches.bulkDelete(toDelete.map(h => h.id));
  }

  return id;
}

/**
 * Get search history for a corpus
 */
export async function getSearchHistory(corpusId, limit = 20) {
  const history = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  const sorted = history
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);

  return sorted.map(h => ({
    ...h,
    query: h.query,
    filters: h.filters ? JSON.parse(h.filters) : {},
  }));
}

/**
 * Clear search history for a corpus
 */
export async function clearSearchHistory(corpusId) {
  const history = await db.saved_searches
    .where('corpus_id')
    .equals(corpusId)
    .filter(s => s.name?.startsWith('__history__'))
    .toArray();

  await db.saved_searches.bulkDelete(history.map(h => h.id));
}

// ─── Export History ───────────────────────────────────────────────────────────

/**
 * Record an export action
 */
export async function recordExport(corpusId, eventIds, format, options = {}) {
  const record = {
    corpus_id: corpusId,
    event_ids: JSON.stringify(eventIds),
    event_count: eventIds.length,
    format,
    options: JSON.stringify(options),
    created_at: Date.now(),
  };
  return db.export_history.add(record);
}

/**
 * Get export history for a corpus
 */
export async function getExportHistory(corpusId, limit = 20) {
  return db.export_history
    .where('corpus_id')
    .equals(corpusId)
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Get all export history
 */
export async function getAllExportHistory(limit = 50) {
  return db.export_history
    .orderBy('created_at')
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Delete export history entry
 */
export async function deleteExportHistory(id) {
  await db.export_history.delete(id);
}

// ─── Event Usage Tracking ─────────────────────────────────────────────────────

/**
 * Increment usage count for an event
 */
export async function trackEventUsage(corpusId, eventId, action = 'export') {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();

  if (existing) {
    const history = existing.history || [];
    history.unshift({
      action,
      timestamp: Date.now(),
    });
    // Keep last 20 actions
    if (history.length > 20) history.pop();

    await db.event_usage.update(existing.id, {
      usage_count: (existing.usage_count || 0) + 1,
      last_used_at: Date.now(),
      last_action: action,
      history,
    });
    return existing.usage_count + 1;
  } else {
    await db.event_usage.add({
      corpus_id: corpusId,
      event_id: eventId,
      usage_count: 1,
      last_used_at: Date.now(),
      last_action: action,
      history: [{ action, timestamp: Date.now() }],
    });
    return 1;
  }
}

/**
 * Batch track usage for multiple events
 */
export async function batchTrackUsage(corpusId, eventIds, action = 'export') {
  for (const eventId of eventIds) {
    await trackEventUsage(corpusId, eventId, action);
  }
}

/**
 * Get usage stats for events in a corpus
 */
export async function getUsageStats(corpusId) {
  const usages = await db.event_usage
    .where('corpus_id')
    .equals(corpusId)
    .toArray();

  const stats = {};
  let totalUsage = 0;
  let mostUsed = null;
  let maxCount = 0;

  for (const u of usages) {
    stats[u.event_id] = {
      count: u.usage_count,
      lastUsed: u.last_used_at,
      lastAction: u.last_action,
    };
    totalUsage += u.usage_count;
    if (u.usage_count > maxCount) {
      maxCount = u.usage_count;
      mostUsed = u.event_id;
    }
  }

  return { stats, totalUsage, mostUsed, maxCount };
}

/**
 * Get usage count for a single event
 */
export async function getEventUsageCount(corpusId, eventId) {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  return existing?.usage_count || 0;
}

/**
 * Reset usage count for an event
 */
export async function resetEventUsage(corpusId, eventId) {
  const existing = await db.event_usage
    .where('[corpus_id+event_id]')
    .equals([corpusId, eventId])
    .first();
  if (existing) {
    await db.event_usage.update(existing.id, {
      usage_count: 0,
      history: [],
      last_used_at: null,
      last_action: null,
    });
  }
}

// ─── Linked Events (to Projects) ──────────────────────────────────────────────

/**
 * Link an event to a story project
 */
export async function linkEventToProject(
  eventId,
  corpusId,
  projectId,
  chapterId = null,
  sceneId = null,
  notes = '',
  eventPayload = null,
) {
  // Check if link already exists
  const existing = await db.linked_events
    .where('[event_id+project_id]')
    .equals([eventId, projectId])
    .first();

  const normalizedEvent = eventPayload && typeof eventPayload === 'object'
    ? eventPayload
    : null;
  const eventSnapshot = normalizedEvent
    ? {
      id: normalizeText(normalizedEvent.id || eventId),
      description: normalizeText(normalizedEvent.description || ''),
      chapter: Number.isFinite(Number(normalizedEvent.chapter)) ? Number(normalizedEvent.chapter) : null,
      severity: normalizeText(normalizedEvent.severity || ''),
      reviewStatus: normalizeText(normalizedEvent.reviewStatus || ''),
      locationName: normalizeText(
        normalizedEvent.locationLink?.locationName
        || normalizedEvent.primaryLocationName
        || '',
      ),
      qualityScore: Number(normalizedEvent?.quality?.score || 0),
    }
    : null;

  let linkId;

  if (existing) {
    await db.linked_events.update(existing.id, {
      chapter_id: chapterId,
      scene_id: sceneId,
      notes,
      event_summary: eventSnapshot?.description || existing.event_summary || '',
      event_chapter: eventSnapshot?.chapter ?? existing.event_chapter ?? null,
      event_severity: eventSnapshot?.severity || existing.event_severity || '',
      event_location_name: eventSnapshot?.locationName || existing.event_location_name || '',
      event_review_status: eventSnapshot?.reviewStatus || existing.event_review_status || '',
      event_quality_score: Number.isFinite(eventSnapshot?.qualityScore)
        ? eventSnapshot.qualityScore
        : (existing.event_quality_score || 0),
      event_snapshot: eventSnapshot ? safeJsonStringify(eventSnapshot) : (existing.event_snapshot || null),
      updated_at: Date.now(),
    });
    linkId = existing.id;
  } else {
    linkId = await db.linked_events.add({
      event_id: eventId,
      corpus_id: corpusId,
      project_id: projectId,
      chapter_id: chapterId,
      scene_id: sceneId,
      notes,
      event_summary: eventSnapshot?.description || '',
      event_chapter: eventSnapshot?.chapter ?? null,
      event_severity: eventSnapshot?.severity || '',
      event_location_name: eventSnapshot?.locationName || '',
      event_review_status: eventSnapshot?.reviewStatus || '',
      event_quality_score: Number(eventSnapshot?.qualityScore || 0),
      event_snapshot: eventSnapshot ? safeJsonStringify(eventSnapshot) : null,
      created_at: Date.now(),
    });
  }

  try {
    const materialized = await materializeLinkedEventToProject({
      eventId,
      corpusId,
      projectId,
      chapterId,
      notes,
      eventPayload: normalizedEvent,
      linkedEventId: linkId,
    });

    if (materialized.locationId || materialized.canonFactId) {
      await db.linked_events.update(linkId, {
        materialized_location_id: materialized.locationId || null,
        materialized_canon_fact_id: materialized.canonFactId || null,
        updated_at: Date.now(),
      });
    }
  } catch (error) {
    // Do not fail linking because materialization failed.
    console.warn('Failed to materialize linked event into project store:', error);
  }

  return linkId;
}

/**
 * Unlink an event from a project
 */
export async function unlinkEventFromProject(eventId, projectId) {
  const existing = await db.linked_events
    .where('[event_id+project_id]')
    .equals([eventId, projectId])
    .first();
  if (existing) {
    await db.linked_events.delete(existing.id);
  }
}

/**
 * Get all events linked to a project
 */
export async function getEventsLinkedToProject(projectId) {
  return db.linked_events
    .where('project_id')
    .equals(projectId)
    .toArray();
}

/**
 * Get all projects an event is linked to
 */
export async function getProjectsLinkedToEvent(eventId) {
  return db.linked_events
    .where('event_id')
    .equals(eventId)
    .toArray();
}

/**
 * Get all event links for a corpus
 */
export async function getEventLinksForCorpus(corpusId) {
  return db.linked_events
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
}

/**
 * Update link notes
 */
export async function updateEventLinkNotes(linkId, notes) {
  await db.linked_events.update(linkId, {
    notes,
    updated_at: Date.now(),
  });
}

/**
 * Get events linked to a specific chapter
 */
export async function getEventsLinkedToChapter(projectId, chapterId) {
  return db.linked_events
    .where('project_id')
    .equals(projectId)
    .filter(l => l.chapter_id === chapterId)
    .toArray();
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis snapshots (L1-L6) persisted by project
// ─────────────────────────────────────────────────────────────────────────────

export async function saveAnalysisSnapshotToProject({
  projectId,
  corpusId,
  analysisId,
  status = 'completed',
  layers = [],
  result = null,
}) {
  if (!projectId || !analysisId) {
    throw new Error('projectId và analysisId là bắt buộc để lưu snapshot.');
  }

  const resultJson = safeJsonStringify(result, '{}');
  const summary = summarizeAnalysisResult(result);
  const now = Date.now();

  const existing = await db.project_analysis_snapshots
    .where('[project_id+analysis_id]')
    .equals([projectId, analysisId])
    .first();

  const record = {
    project_id: projectId,
    corpus_id: corpusId || null,
    analysis_id: analysisId,
    status: normalizeText(status || 'completed'),
    layers: Array.isArray(layers) ? layers : [],
    result_json: resultJson,
    summary,
    updated_at: now,
  };

  if (existing) {
    await db.project_analysis_snapshots.update(existing.id, record);
    return existing.id;
  }

  return db.project_analysis_snapshots.add({
    ...record,
    created_at: now,
  });
}

export async function getProjectAnalysisSnapshots(projectId, limit = 20) {
  if (!projectId) return [];
  const rows = await db.project_analysis_snapshots
    .where('project_id')
    .equals(projectId)
    .reverse()
    .sortBy('updated_at');
  return rows.slice(0, limit);
}

export async function getProjectAnalysisSnapshot(projectId, analysisId) {
  if (!projectId || !analysisId) return null;
  return db.project_analysis_snapshots
    .where('[project_id+analysis_id]')
    .equals([projectId, analysisId])
    .first();
}

export async function deleteProjectAnalysisSnapshot(snapshotId) {
  if (!snapshotId) return;
  await db.project_analysis_snapshots.delete(snapshotId);
}

// ─── Combined helpers ──────────────────────────────────────────────────────────

/**
 * Load all viewer data for a corpus (annotations + saved searches + usage)
 */
export async function loadViewerDataForCorpus(corpusId) {
  const [annotations, savedSearches, searchHistory, exportHistory, usageStats, linkedEvents] =
    await Promise.all([
      getAnnotationsForCorpus(corpusId),
      getSavedSearches(corpusId),
      getSearchHistory(corpusId),
      getExportHistory(corpusId),
      getUsageStats(corpusId),
      getEventLinksForCorpus(corpusId),
    ]);

  return {
    annotations,
    savedSearches,
    searchHistory,
    exportHistory,
    usageStats,
    linkedEvents,
  };
}

/**
 * Build a lookup map of annotations keyed by eventId
 */
export async function getAnnotationMap(corpusId) {
  const annotations = await getAnnotationsForCorpus(corpusId);
  const map = {};
  for (const a of annotations) {
    map[a.event_id] = a;
  }
  return map;
}

/**
 * Build a lookup map of usage counts keyed by eventId
 */
export async function getUsageCountMap(corpusId) {
  const usages = await db.event_usage
    .where('corpus_id')
    .equals(corpusId)
    .toArray();
  const map = {};
  for (const u of usages) {
    map[u.event_id] = u.usage_count || 0;
  }
  return map;
}
