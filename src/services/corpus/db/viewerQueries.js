/**
 * Phase 4: Viewer Database Queries
 * CRUD operations for event_annotations, exports, saved_searches
 */

import { randomUUID } from 'node:crypto';
import { getViewerDb } from './viewerSchema.js';

/* ========================
   EVENT ANNOTATIONS
   ======================== */

function mapAnnotation(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    corpusId: row.corpus_id,
    analysisId: row.analysis_id,
    note: row.note,
    customTags: row.custom_tags ? JSON.parse(row.custom_tags) : [],
    starred: Boolean(row.starred),
    usageCount: row.usage_count || 0,
    lastUsedAt: row.last_used_at || null,
    linkedProjectIds: row.linked_project_ids ? JSON.parse(row.linked_project_ids) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAnnotation(data = {}) {
  const db = getViewerDb();
  const id = data.id || randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO event_annotations (
      id, event_id, corpus_id, analysis_id, note, custom_tags, starred,
      usage_count, last_used_at, linked_project_ids, created_at, updated_at
    ) VALUES (
      @id, @eventId, @corpusId, @analysisId, @note, @customTags, @starred,
      @usageCount, @lastUsedAt, @linkedProjectIds, @createdAt, @updatedAt
    )
  `).run({
    id,
    eventId: data.eventId || '',
    corpusId: data.corpusId || '',
    analysisId: data.analysisId || null,
    note: data.note || '',
    customTags: JSON.stringify(data.customTags || []),
    starred: data.starred ? 1 : 0,
    usageCount: data.usageCount || 0,
    lastUsedAt: data.lastUsedAt || null,
    linkedProjectIds: JSON.stringify(data.linkedProjectIds || []),
    createdAt: now,
    updatedAt: now,
  });

  return getAnnotationById(id);
}

export function getAnnotationById(annotationId) {
  const db = getViewerDb();
  const row = db.prepare('SELECT * FROM event_annotations WHERE id = ?').get(annotationId);
  return mapAnnotation(row);
}

export function getAnnotationsByEventId(eventId) {
  const db = getViewerDb();
  const rows = db.prepare('SELECT * FROM event_annotations WHERE event_id = ? ORDER BY created_at DESC').all(eventId);
  return rows.map(mapAnnotation);
}

export function getAnnotationsByCorpusId(corpusId) {
  const db = getViewerDb();
  const rows = db.prepare('SELECT * FROM event_annotations WHERE corpus_id = ? ORDER BY created_at DESC').all(corpusId);
  return rows.map(mapAnnotation);
}

export function getStarredAnnotations(corpusId) {
  const db = getViewerDb();
  const query = corpusId
    ? 'SELECT * FROM event_annotations WHERE corpus_id = ? AND starred = 1 ORDER BY updated_at DESC'
    : 'SELECT * FROM event_annotations WHERE starred = 1 ORDER BY updated_at DESC';
  const params = corpusId ? [corpusId] : [];
  const rows = db.prepare(query).all(...params);
  return rows.map(mapAnnotation);
}

export function updateAnnotation(annotationId, updates = {}) {
  const db = getViewerDb();
  const setClauses = [];
  const params = { id: annotationId, updatedAt: Date.now() };

  if (updates.note !== undefined) {
    setClauses.push('note = @note');
    params.note = updates.note;
  }
  if (updates.customTags !== undefined) {
    setClauses.push('custom_tags = @customTags');
    params.customTags = JSON.stringify(updates.customTags);
  }
  if (updates.starred !== undefined) {
    setClauses.push('starred = @starred');
    params.starred = updates.starred ? 1 : 0;
  }
  if (updates.linkedProjectIds !== undefined) {
    setClauses.push('linked_project_ids = @linkedProjectIds');
    params.linkedProjectIds = JSON.stringify(updates.linkedProjectIds);
  }
  if (updates.usageCount !== undefined) {
    setClauses.push('usage_count = @usageCount');
    params.usageCount = updates.usageCount;
  }
  if (updates.lastUsedAt !== undefined) {
    setClauses.push('last_used_at = @lastUsedAt');
    params.lastUsedAt = updates.lastUsedAt;
  }

  if (setClauses.length === 0) {
    return getAnnotationById(annotationId);
  }

  setClauses.push('updated_at = @updatedAt');

  db.prepare(`UPDATE event_annotations SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  return getAnnotationById(annotationId);
}

export function upsertAnnotation(data = {}) {
  const existing = data.eventId && data.corpusId
    ? db => db.prepare(
        'SELECT * FROM event_annotations WHERE event_id = @eventId AND corpus_id = @corpusId'
      ).get({ eventId: data.eventId, corpusId: data.corpusId })
    : null;

  const db = getViewerDb();

  if (existing) {
    return updateAnnotation(existing.id, data);
  }

  return createAnnotation(data);
}

export function deleteAnnotation(annotationId) {
  const db = getViewerDb();
  const result = db.prepare('DELETE FROM event_annotations WHERE id = ?').run(annotationId);
  return result.changes > 0;
}

export function incrementUsageCount(annotationId) {
  const db = getViewerDb();
  const now = Date.now();
  db.prepare(`
    UPDATE event_annotations
    SET usage_count = usage_count + 1, last_used_at = @lastUsedAt, updated_at = @updatedAt
    WHERE id = @id
  `).run({ id: annotationId, lastUsedAt: now, updatedAt: now });
}

/* ========================
   EXPORTS
   ======================== */

function mapExport(row) {
  if (!row) return null;
  return {
    id: row.id,
    corpusId: row.corpus_id,
    eventIds: row.event_ids ? JSON.parse(row.event_ids) : [],
    eventCount: row.event_count || 0,
    format: row.format,
    options: row.options ? JSON.parse(row.options) : {},
    filePath: row.file_path,
    fileSize: row.file_size,
    createdAt: row.created_at,
  };
}

export function createExportRecord(data = {}) {
  const db = getViewerDb();
  const id = data.id || randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO exports (
      id, corpus_id, event_ids, event_count, format, options, file_path, file_size, created_at
    ) VALUES (
      @id, @corpusId, @eventIds, @eventCount, @format, @options, @filePath, @fileSize, @createdAt
    )
  `).run({
    id,
    corpusId: data.corpusId || null,
    eventIds: JSON.stringify(data.eventIds || []),
    eventCount: data.eventCount || (Array.isArray(data.eventIds) ? data.eventIds.length : 0),
    format: data.format || 'markdown',
    options: JSON.stringify(data.options || {}),
    filePath: data.filePath || null,
    fileSize: data.fileSize || null,
    createdAt: now,
  });

  return getExportById(id);
}

export function getExportById(exportId) {
  const db = getViewerDb();
  const row = db.prepare('SELECT * FROM exports WHERE id = ?').get(exportId);
  return mapExport(row);
}

export function getExportsByCorpusId(corpusId) {
  const db = getViewerDb();
  const rows = db.prepare('SELECT * FROM exports WHERE corpus_id = ? ORDER BY created_at DESC LIMIT 50').all(corpusId);
  return rows.map(mapExport);
}

export function getRecentExports(limit = 20) {
  const db = getViewerDb();
  const rows = db.prepare('SELECT * FROM exports ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(mapExport);
}

export function deleteExport(exportId) {
  const db = getViewerDb();
  const result = db.prepare('DELETE FROM exports WHERE id = ?').run(exportId);
  return result.changes > 0;
}

/* ========================
   SAVED SEARCHES
   ======================== */

function mapSavedSearch(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    filters: row.filters ? JSON.parse(row.filters) : {},
    searchIn: row.search_in ? JSON.parse(row.search_in) : ['description'],
    corpusId: row.corpus_id,
    sortBy: row.sort_by || 'relevance',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export function createSavedSearch(data = {}) {
  const db = getViewerDb();
  const id = data.id || randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO saved_searches (
      id, name, query, filters, search_in, corpus_id, sort_by, created_at, updated_at, last_used_at
    ) VALUES (
      @id, @name, @query, @filters, @searchIn, @corpusId, @sortBy, @createdAt, @updatedAt, @lastUsedAt
    )
  `).run({
    id,
    name: data.name || 'Untitled Search',
    query: data.query || '',
    filters: JSON.stringify(data.filters || {}),
    searchIn: JSON.stringify(data.searchIn || ['description', 'annotation']),
    corpusId: data.corpusId || null,
    sortBy: data.sortBy || 'relevance',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  });

  return getSavedSearchById(id);
}

export function getSavedSearchById(searchId) {
  const db = getViewerDb();
  const row = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(searchId);
  return mapSavedSearch(row);
}

export function getSavedSearchesByCorpusId(corpusId) {
  const db = getViewerDb();
  const query = corpusId
    ? 'SELECT * FROM saved_searches WHERE corpus_id = ? OR corpus_id IS NULL ORDER BY last_used_at DESC NULLS LAST, created_at DESC'
    : 'SELECT * FROM saved_searches ORDER BY last_used_at DESC NULLS LAST, created_at DESC';
  const params = corpusId ? [corpusId] : [];
  const rows = db.prepare(query).all(...params);
  return rows.map(mapSavedSearch);
}

export function getAllSavedSearches() {
  return getSavedSearchesByCorpusId(null);
}

export function updateSavedSearch(searchId, updates = {}) {
  const db = getViewerDb();
  const setClauses = [];
  const params = { id: searchId, updatedAt: Date.now() };

  if (updates.name !== undefined) {
    setClauses.push('name = @name');
    params.name = updates.name;
  }
  if (updates.query !== undefined) {
    setClauses.push('query = @query');
    params.query = updates.query;
  }
  if (updates.filters !== undefined) {
    setClauses.push('filters = @filters');
    params.filters = JSON.stringify(updates.filters);
  }
  if (updates.searchIn !== undefined) {
    setClauses.push('search_in = @searchIn');
    params.searchIn = JSON.stringify(updates.searchIn);
  }
  if (updates.sortBy !== undefined) {
    setClauses.push('sort_by = @sortBy');
    params.sortBy = updates.sortBy;
  }
  if (updates.lastUsedAt !== undefined) {
    setClauses.push('last_used_at = @lastUsedAt');
    params.lastUsedAt = updates.lastUsedAt;
  }

  if (setClauses.length === 0) {
    return getSavedSearchById(searchId);
  }

  setClauses.push('updated_at = @updatedAt');

  db.prepare(`UPDATE saved_searches SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  return getSavedSearchById(searchId);
}

export function touchSavedSearch(searchId) {
  return updateSavedSearch(searchId, { lastUsedAt: Date.now() });
}

export function deleteSavedSearch(searchId) {
  const db = getViewerDb();
  const result = db.prepare('DELETE FROM saved_searches WHERE id = ?').run(searchId);
  return result.changes > 0;
}

/* ========================
   EVENT FLAGS
   ======================== */

export function setEventFlag(eventId, corpusId, flagType, flagValue = '1') {
  const db = getViewerDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO event_flags (id, event_id, corpus_id, flag_type, flag_value, created_at)
    VALUES (@id, @eventId, @corpusId, @flagType, @flagValue, @createdAt)
    ON CONFLICT(event_id, flag_type) DO UPDATE SET flag_value = @flagValue
  `).run({
    id,
    eventId,
    corpusId,
    flagType,
    flagValue,
    createdAt: Date.now(),
  });
}

export function getEventFlag(eventId, flagType) {
  const db = getViewerDb();
  const row = db.prepare(
    'SELECT * FROM event_flags WHERE event_id = ? AND flag_type = ?'
  ).get(eventId, flagType);
  return row ? { eventId: row.event_id, flagType: row.flag_type, value: row.flag_value } : null;
}

export function getEventFlagsByCorpusId(corpusId, flagType) {
  const db = getViewerDb();
  const query = flagType
    ? 'SELECT * FROM event_flags WHERE corpus_id = ? AND flag_type = ?'
    : 'SELECT * FROM event_flags WHERE corpus_id = ?';
  const params = flagType ? [corpusId, flagType] : [corpusId];
  return db.prepare(query).all(...params);
}

export function removeEventFlag(eventId, flagType) {
  const db = getViewerDb();
  const result = db.prepare(
    'DELETE FROM event_flags WHERE event_id = ? AND flag_type = ?'
  ).run(eventId, flagType);
  return result.changes > 0;
}

/* ========================
   EVENT GROUPS
   ======================== */

function mapEventGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    eventIds: row.event_ids ? JSON.parse(row.event_ids) : [],
    corpusId: row.corpus_id,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createEventGroup(data = {}) {
  const db = getViewerDb();
  const id = data.id || randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO event_groups (id, name, description, event_ids, corpus_id, color, created_at, updated_at)
    VALUES (@id, @name, @description, @eventIds, @corpusId, @color, @createdAt, @updatedAt)
  `).run({
    id,
    name: data.name || 'Untitled Group',
    description: data.description || '',
    eventIds: JSON.stringify(data.eventIds || []),
    corpusId: data.corpusId || null,
    color: data.color || '#6366f1',
    createdAt: now,
    updatedAt: now,
  });

  return getEventGroupById(id);
}

export function getEventGroupById(groupId) {
  const db = getViewerDb();
  const row = db.prepare('SELECT * FROM event_groups WHERE id = ?').get(groupId);
  return mapEventGroup(row);
}

export function getEventGroupsByCorpusId(corpusId) {
  const db = getViewerDb();
  const rows = db.prepare('SELECT * FROM event_groups WHERE corpus_id = ? ORDER BY created_at DESC').all(corpusId);
  return rows.map(mapEventGroup);
}

export function updateEventGroup(groupId, updates = {}) {
  const db = getViewerDb();
  const setClauses = [];
  const params = { id: groupId, updatedAt: Date.now() };

  if (updates.name !== undefined) {
    setClauses.push('name = @name');
    params.name = updates.name;
  }
  if (updates.description !== undefined) {
    setClauses.push('description = @description');
    params.description = updates.description;
  }
  if (updates.eventIds !== undefined) {
    setClauses.push('event_ids = @eventIds');
    params.eventIds = JSON.stringify(updates.eventIds);
  }
  if (updates.color !== undefined) {
    setClauses.push('color = @color');
    params.color = updates.color;
  }

  if (setClauses.length === 0) return getEventGroupById(groupId);

  setClauses.push('updated_at = @updatedAt');
  db.prepare(`UPDATE event_groups SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  return getEventGroupById(groupId);
}

export function deleteEventGroup(groupId) {
  const db = getViewerDb();
  const result = db.prepare('DELETE FROM event_groups WHERE id = ?').run(groupId);
  return result.changes > 0;
}
