import dbDefault from '../db/database.js';
import { rebuildCanonFromChapter } from '../canon/projection.js';
import { normalizeCanonFactRecord } from '../entityIdentity/factIdentity.js';

const KIND_TABLES = {
  character: 'characters',
  location: 'locations',
  object: 'objects',
  world_term: 'worldTerms',
};

const PROTECTED_FIELDS = new Set([
  'id',
  'project_id',
  'name',
  'role',
  'entity_kind',
  'owner_character_id',
  'parent_location_id',
  'created_at',
]);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizedText(value) {
  return cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
}

function normalizedAliasText(value) {
  return cleanText(value).normalize('NFC').toLocaleLowerCase('vi');
}

function stableGuardValue(value) {
  if (Array.isArray(value)) return value.map(stableGuardValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key !== 'project_id' && key !== 'entity_kind') result[key] = stableGuardValue(value[key]);
    return result;
  }, {});
}

export function buildStoryBibleEntityGuard(entity, entityKind) {
  const normalizedEntity = {
    ...(entity || {}),
    name: entity?.name || entity?.term || '',
    aliases: Array.isArray(entity?.aliases) ? entity.aliases : [],
  };
  return {
    entity_kind: entityKind === 'term' ? 'world_term' : entityKind,
    record: stableGuardValue(normalizedEntity),
  };
}

function createMergeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseSuggestionPayload(suggestion) {
  try {
    return typeof suggestion?.candidate_op === 'string'
      ? JSON.parse(suggestion.candidate_op)
      : (suggestion?.candidate_op || {});
  } catch {
    throw createMergeError('DUPLICATE_REVIEW_INVALID', 'Duplicate-review suggestion payload is invalid.');
  }
}

function validateMergeSuggestion({ suggestion, projectId, kind, survivorId, duplicateId, survivor, duplicate }) {
  if (
    !suggestion
    || suggestion.project_id !== projectId
    || suggestion.type !== 'entity_duplicate_review'
    || suggestion.status !== 'pending'
  ) {
    throw createMergeError('DUPLICATE_REVIEW_STALE', 'Duplicate-review suggestion is missing or already resolved.');
  }
  const payload = parseSuggestionPayload(suggestion);
  const pairIds = Array.isArray(payload.entity_ids) ? payload.entity_ids.map(Number).sort((a, b) => a - b) : [];
  const requestedIds = [Number(survivorId), Number(duplicateId)].sort((a, b) => a - b);
  if (
    payload.entity_kind !== kind
    || pairIds.length !== 2
    || pairIds.some((id, index) => id !== requestedIds[index])
  ) {
    throw createMergeError('DUPLICATE_REVIEW_INVALID', 'Selected merge pair does not match the reviewed suggestion.');
  }
  const guards = payload.entity_guards || {};
  const currentGuards = {
    [survivorId]: buildStoryBibleEntityGuard(survivor, kind),
    [duplicateId]: buildStoryBibleEntityGuard(duplicate, kind),
  };
  if (
    JSON.stringify(guards[survivorId]) !== JSON.stringify(currentGuards[survivorId])
    || JSON.stringify(guards[duplicateId]) !== JSON.stringify(currentGuards[duplicateId])
  ) {
    throw createMergeError('DUPLICATE_REVIEW_STALE', 'Story Bible entities changed after duplicate analysis.');
  }
}

function mergeAliases(survivor, duplicate) {
  const values = [
    ...(Array.isArray(survivor.aliases) ? survivor.aliases : []),
    duplicate.name,
    ...(Array.isArray(duplicate.aliases) ? duplicate.aliases : []),
  ];
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizedAliasText(value);
    if (!key || key === normalizedAliasText(survivor.name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMergedEntity(survivor, duplicate) {
  const merged = {
    ...survivor,
    aliases: mergeAliases(survivor, duplicate),
    updated_at: Date.now(),
  };
  for (const [field, value] of Object.entries(duplicate)) {
    if (PROTECTED_FIELDS.has(field) || field === 'aliases') continue;
    const current = merged[field];
    const currentBlank = current == null || current === '' || (Array.isArray(current) && current.length === 0);
    const nextPresent = value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
    if (currentBlank && nextPresent) merged[field] = value;
  }
  return merged;
}

async function projectRows(db, tableName, projectId) {
  const table = db[tableName];
  if (!table?.where) return [];
  return table.where('project_id').equals(projectId).toArray();
}

function replaceId(value, duplicateId, survivorId) {
  return value === duplicateId ? survivorId : value;
}

function replaceIdList(value, duplicateId, survivorId) {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.map((id) => replaceId(id, duplicateId, survivorId)))];
}

function rewriteJsonList(value, duplicateId, survivorId) {
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? JSON.stringify(replaceIdList(parsed, duplicateId, survivorId)) : value;
  } catch {
    return value;
  }
}

function targetTypeMatches(value, kind) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (kind === 'world_term') return ['world_term', 'term', 'worldterm'].includes(normalized);
  return normalized === kind || normalized === `${kind}s`;
}

function rewriteCandidateOp(value, kind, duplicateId, survivorId, fallbackKind = '') {
  if (!value) return value;
  let payload;
  try {
    payload = typeof value === 'string' ? JSON.parse(value) : { ...value };
  } catch {
    return value;
  }
  if (normalizeEntityKind(payload.entity_kind || fallbackKind) !== kind) return value;
  if (Array.isArray(payload.target_entity_ids)) {
    payload.target_entity_ids = replaceIdList(payload.target_entity_ids, duplicateId, survivorId);
  }
  if (Array.isArray(payload.entity_ids)) {
    payload.entity_ids = replaceIdList(payload.entity_ids, duplicateId, survivorId);
  }
  payload.recommended_target_id = replaceId(payload.recommended_target_id, duplicateId, survivorId);
  payload.recommended_survivor_id = replaceId(payload.recommended_survivor_id, duplicateId, survivorId);
  payload.duplicate_id = replaceId(payload.duplicate_id, duplicateId, survivorId);
  if (Array.isArray(payload.resolution_options)) {
    payload.resolution_options = payload.resolution_options.map((option) => ({
      ...option,
      entity_id: replaceId(option.entity_id, duplicateId, survivorId),
    }));
  }
  if (Array.isArray(payload.entity_options)) {
    payload.entity_options = payload.entity_options.map((option) => ({
      ...option,
      id: replaceId(option.id, duplicateId, survivorId),
    }));
  }
  return typeof value === 'string' ? JSON.stringify(payload) : payload;
}

function normalizeEntityKind(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/gu, '_');
  if (['term', 'worldterm', 'world_term'].includes(normalized)) return 'world_term';
  if (['item', 'object'].includes(normalized)) return 'object';
  return normalized;
}

function typedId(value, declaredKind, kind, duplicateId, survivorId, fallbackKind = '') {
  const normalizedKind = normalizeEntityKind(declaredKind) || fallbackKind;
  return normalizedKind === kind ? replaceId(value, duplicateId, survivorId) : value;
}

function rowPayload(row) {
  if (row?.payload && typeof row.payload === 'object') return row.payload;
  if (typeof row?.payload === 'string') {
    try { return JSON.parse(row.payload); } catch { return {}; }
  }
  return {};
}

function rewritePayloadIds(row, fields, duplicateId, survivorId) {
  const payload = rowPayload(row);
  const next = { ...payload };
  let didChange = false;
  for (const field of fields) {
    const value = replaceId(payload[field], duplicateId, survivorId);
    if (value !== payload[field]) didChange = true;
    if (Object.prototype.hasOwnProperty.call(payload, field)) next[field] = value;
  }
  if (!didChange) return row?.payload;
  return typeof row?.payload === 'string' ? JSON.stringify(next) : next;
}

function rewriteFactRow(row, kind, duplicateId, survivorId) {
  const next = { ...row };
  next.subject_id = typedId(row.subject_id, row.subject_type, kind, duplicateId, survivorId);
  next.entity_id = typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId);
  if (Array.isArray(row.related_entity_ids)) {
    if (Array.isArray(row.related_entity_types)) {
      next.related_entity_ids = row.related_entity_ids.map((id, index) => (
        typedId(id, row.related_entity_types[index], kind, duplicateId, survivorId)
      ));
    } else if (normalizeEntityKind(row.subject_type) === kind) {
      next.related_entity_ids = replaceIdList(row.related_entity_ids, duplicateId, survivorId);
    }
  }
  if (
    next.subject_id === row.subject_id
    && next.entity_id === row.entity_id
    && JSON.stringify(next.related_entity_ids) === JSON.stringify(row.related_entity_ids)
  ) {
    return row;
  }
  return {
    ...next,
    ...normalizeCanonFactRecord(next),
  };
}

function mutatorsForKind(kind, duplicateId, survivorId) {
  const common = {
    suggestions: (row) => ({
      ...row,
      target_id: rewriteCandidateOp(row.candidate_op, kind, duplicateId, survivorId) !== row.candidate_op
        ? replaceId(row.target_id, duplicateId, survivorId)
        : row.target_id,
      candidate_op: rewriteCandidateOp(row.candidate_op, kind, duplicateId, survivorId),
    }),
    entity_resolution_candidates: (row) => row.entity_kind === kind ? ({
      ...row,
      matched_entity_id: replaceId(row.matched_entity_id, duplicateId, survivorId),
      payload_json: rewriteCandidateOp(row.payload_json, kind, duplicateId, survivorId, row.entity_kind),
    }) : row,
    memory_evidence: (row) => targetTypeMatches(row.target_type, kind) ? ({
      ...row,
      target_id: replaceId(row.target_id, duplicateId, survivorId),
    }) : row,
  };

  if (kind === 'character') {
    return {
      ...common,
      objects: (row) => ({
        ...row,
        owner_character_id: replaceId(row.owner_character_id, duplicateId, survivorId),
        holder_character_id: replaceId(row.holder_character_id, duplicateId, survivorId),
      }),
      characterStates: (row) => ({ ...row, character_id: replaceId(row.character_id, duplicateId, survivorId) }),
      factions: (row) => ({ ...row, leader_character_id: replaceId(row.leader_character_id, duplicateId, survivorId) }),
      taboos: (row) => ({ ...row, character_id: replaceId(row.character_id, duplicateId, survivorId) }),
      voicePacks: (row) => ({ ...row, character_id: replaceId(row.character_id, duplicateId, survivorId) }),
      relationships: (row) => ({
        ...row,
        character_a_id: replaceId(row.character_a_id, duplicateId, survivorId),
        character_b_id: replaceId(row.character_b_id, duplicateId, survivorId),
      }),
      scenes: (row) => ({
        ...row,
        pov_character_id: replaceId(row.pov_character_id, duplicateId, survivorId),
        characters_present: rewriteJsonList(row.characters_present, duplicateId, survivorId),
      }),
      story_events: (row) => {
        const payload = rowPayload(row);
        return {
          ...row,
          subject_id: typedId(row.subject_id, row.subject_type || payload.subject_type, kind, duplicateId, survivorId, 'character'),
          target_id: typedId(row.target_id, row.target_type || payload.target_type, kind, duplicateId, survivorId, 'character'),
          payload: rewritePayloadIds(row, [
            'owner_character_id',
            'holder_character_id',
            'receiver_character_id',
            'recipient_character_id',
            'return_to_character_id',
            'target_character_id',
          ], duplicateId, survivorId),
        };
      },
      entityTimeline: (row) => ({
        ...row,
        entity_id: typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId),
      }),
      entity_state_current: (row) => ({
        ...row,
        entity_id: typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId),
      }),
      canonFacts: (row) => rewriteFactRow(row, kind, duplicateId, survivorId),
    };
  }
  if (kind === 'location') {
    return {
      ...common,
      locations: (row) => ({ ...row, parent_location_id: replaceId(row.parent_location_id, duplicateId, survivorId) }),
      factions: (row) => ({ ...row, base_location_id: replaceId(row.base_location_id, duplicateId, survivorId) }),
      scenes: (row) => ({ ...row, location_id: replaceId(row.location_id, duplicateId, survivorId) }),
      story_events: (row) => ({
        ...row,
        location_id: replaceId(row.location_id, duplicateId, survivorId),
        payload: rewritePayloadIds(row, ['location_id', 'current_location_id'], duplicateId, survivorId),
      }),
      entity_state_current: (row) => ({ ...row, current_location_id: replaceId(row.current_location_id, duplicateId, survivorId) }),
      item_state_current: (row) => ({ ...row, current_location_id: replaceId(row.current_location_id, duplicateId, survivorId) }),
      entityTimeline: (row) => ({
        ...row,
        entity_id: typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId),
      }),
      canonFacts: (row) => rewriteFactRow(row, kind, duplicateId, survivorId),
    };
  }
  if (kind === 'object') {
    return {
      ...common,
      story_events: (row) => ({
        ...row,
        object_id: replaceId(row.object_id, duplicateId, survivorId),
        payload: rewritePayloadIds(row, ['object_id'], duplicateId, survivorId),
      }),
      item_state_current: (row) => ({ ...row, object_id: replaceId(row.object_id, duplicateId, survivorId) }),
      entityTimeline: (row) => ({
        ...row,
        entity_id: typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId),
      }),
      canonFacts: (row) => rewriteFactRow(row, kind, duplicateId, survivorId),
    };
  }
  return {
    ...common,
    entityTimeline: (row) => ({
      ...row,
      entity_id: typedId(row.entity_id, row.entity_type, kind, duplicateId, survivorId),
    }),
    canonFacts: (row) => rewriteFactRow(row, kind, duplicateId, survivorId),
  };
}

function changed(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

async function collectRewrites(db, projectId, mutators) {
  const rewrites = {};
  let referenceCount = 0;
  for (const [tableName, mutate] of Object.entries(mutators)) {
    if (!db[tableName]) continue;
    const rows = await projectRows(db, tableName, projectId);
    const nextRows = rows.map(mutate);
    const changedRows = nextRows.filter((row, index) => changed(row, rows[index]));
    if (changedRows.length > 0) {
      rewrites[tableName] = changedRows;
      referenceCount += changedRows.length;
    }
  }
  return { rewrites, referenceCount };
}

async function loadMergeEntities(db, projectId, kind, survivorId, duplicateId) {
  const tableName = KIND_TABLES[kind];
  if (!tableName || !db[tableName]) throw new Error('Unsupported Story Bible entity kind.');
  const [survivor, duplicate] = await Promise.all([db[tableName].get(survivorId), db[tableName].get(duplicateId)]);
  if (!survivor || !duplicate || survivor.project_id !== projectId || duplicate.project_id !== projectId) {
    throw new Error('Merge entities must exist in the same project.');
  }
  if (survivorId === duplicateId) throw new Error('Survivor and duplicate must be different entities.');
  return { tableName, survivor, duplicate };
}

export async function previewStoryBibleEntityMerge({
  db = dbDefault,
  projectId,
  entityKind,
  survivorId,
  duplicateId,
}) {
  const kind = entityKind === 'term' ? 'world_term' : entityKind;
  const { survivor, duplicate } = await loadMergeEntities(db, projectId, kind, survivorId, duplicateId);
  const merged = buildMergedEntity(survivor, duplicate);
  const { rewrites, referenceCount } = await collectRewrites(
    db,
    projectId,
    mutatorsForKind(kind, duplicateId, survivorId),
  );
  return {
    entity_kind: kind,
    survivor,
    duplicate,
    merged,
    reference_count: referenceCount,
    reference_counts: Object.fromEntries(Object.entries(rewrites).map(([table, rows]) => [table, rows.length])),
    field_changes: Object.keys(merged)
      .filter((field) => !['id', 'project_id', 'created_at', 'updated_at'].includes(field))
      .filter((field) => changed(survivor[field], merged[field]))
      .map((field) => ({ field, before: survivor[field] ?? null, after: merged[field] ?? null })),
    protected_conflicts: [
      survivor.role && duplicate.role && survivor.role !== duplicate.role ? 'role' : '',
      survivor.owner_character_id && duplicate.owner_character_id && survivor.owner_character_id !== duplicate.owner_character_id ? 'owner_character_id' : '',
      survivor.parent_location_id && duplicate.parent_location_id && survivor.parent_location_id !== duplicate.parent_location_id ? 'parent_location_id' : '',
    ].filter(Boolean),
  };
}

async function dedupeRelationships(db, projectId) {
  if (!db.relationships) return;
  const rows = await projectRows(db, 'relationships', projectId);
  const seen = new Map();
  const deleteIds = [];
  for (const row of rows) {
    if (row.character_a_id === row.character_b_id) {
      deleteIds.push(row.id);
      continue;
    }
    const key = [
      row.character_a_id,
      row.character_b_id,
      normalizedText(row.relation_type || row.type || ''),
    ].join(':');
    if (seen.has(key)) deleteIds.push(row.id);
    else seen.set(key, row.id);
  }
  if (deleteIds.length > 0) await db.relationships.bulkDelete(deleteIds);
}

export async function mergeStoryBibleEntities({
  db = dbDefault,
  projectId,
  entityKind,
  survivorId,
  duplicateId,
  suggestionId = null,
  confirmed = false,
  rebuildProjection = true,
  rebuildProjectionImpl = rebuildCanonFromChapter,
}) {
  if (!confirmed) throw new Error('Story Bible merge requires explicit user confirmation.');
  const kind = entityKind === 'term' ? 'world_term' : entityKind;
  const { tableName, survivor, duplicate } = await loadMergeEntities(db, projectId, kind, survivorId, duplicateId);
  const mutators = mutatorsForKind(kind, duplicateId, survivorId);
  const tableNames = [...new Set([
    tableName,
    ...Object.keys(mutators),
    ...(rebuildProjection ? ['projects'] : []),
  ])].filter((name) => db[name]);
  const tables = tableNames.map((name) => db[name]);
  let result;
  await db.transaction('rw', ...tables, async () => {
    const fresh = await loadMergeEntities(db, projectId, kind, survivorId, duplicateId);
    if (suggestionId != null) {
      const suggestion = await db.suggestions.get(suggestionId);
      validateMergeSuggestion({
        suggestion,
        projectId,
        kind,
        survivorId,
        duplicateId,
        survivor: fresh.survivor,
        duplicate: fresh.duplicate,
      });
    }
    const merged = buildMergedEntity(fresh.survivor, fresh.duplicate);
    const { rewrites, referenceCount } = await collectRewrites(db, projectId, mutators);
    for (const [name, rows] of Object.entries(rewrites)) {
      await db[name].bulkPut(rows);
    }
    if (kind === 'character') await dedupeRelationships(db, projectId);
    await db[tableName].update(survivorId, merged);
    await db[tableName].delete(duplicateId);
    if (suggestionId != null) {
      await db.suggestions.update(suggestionId, {
        status: 'accepted',
        applied_at: Date.now(),
        last_error: '',
      });
    }
    if (rebuildProjection && db.projects) {
      await db.projects.update(projectId, {
        canon_rebuild_required: true,
        canon_rebuild_error: '',
        updated_at: Date.now(),
      });
    }
    result = {
      entity_kind: kind,
      survivor_id: survivorId,
      duplicate_id: duplicateId,
      reference_count: referenceCount,
      merged,
      suggestionUpdated: suggestionId != null,
    };
  });

  if (rebuildProjection) {
    try {
      await rebuildProjectionImpl(projectId, null);
      if (db.projects) {
        await db.projects.update(projectId, {
          canon_rebuild_required: false,
          canon_rebuild_error: '',
          updated_at: Date.now(),
        });
      }
    } catch (error) {
      if (db.projects) {
        await db.projects.update(projectId, {
          canon_rebuild_required: true,
          canon_rebuild_error: String(error?.code || 'CANON_REBUILD_REQUIRED').slice(0, 120),
          updated_at: Date.now(),
        });
      }
      result.canon_rebuild_required = true;
    }
  }
  return result;
}
