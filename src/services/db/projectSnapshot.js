import db from './database.js';
import { normalizeSupremeThreadForPersistence } from '../ai/supremeThreadPersistence.js';
import { normalizeEntityIdentity } from '../entityIdentity/index.js';
import { normalizeCanonFactRecord } from '../entityIdentity/factIdentity.js';
import {
  PROJECT_INDIRECT_SNAPSHOT_TABLES,
  PROJECT_SNAPSHOT_TABLES,
  PROJECT_SNAPSHOT_VERSION,
  getProjectCascadeTransactionTables,
  getProjectSnapshotTransactionTables,
} from './projectSnapshotRegistry.js';
import {
  createIdMap,
  getEntityMap,
  parseJsonValue,
  preserveJsonShape,
  rememberId,
  remapCandidateOperation,
  remapCanonSnapshot,
  remapJsonField,
  remapKnownEmbeddedValue,
  remapList,
  remapOptional,
} from './snapshotRemap.js';

const CLOUD_PROJECT_FIELDS = Object.freeze([
  'cloud_project_slug',
  'cloud_last_synced_at',
  'cloud_last_server_updated_at',
  'cloud_owner_user_id',
  'cloud_pending_local_fork_until_change',
  'cloud_pending_file_import',
]);
const FORBIDDEN_IMPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ACCESS_CONTROL_PROJECT_FIELDS = new Set([
  'role', 'roles', 'plan', 'plan_id', 'admin', 'is_admin', 'entitlements',
  'feature_entitlements', 'permissions', 'adult_consent', 'access_token', 'refresh_token',
]);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sortRecords(records = []) {
  return [...records].sort((left, right) => {
    const leftOrder = Number(left?.order_index ?? left?.index ?? Number.MAX_SAFE_INTEGER);
    const rightOrder = Number(right?.order_index ?? right?.index ?? Number.MAX_SAFE_INTEGER);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftId = left?.id;
    const rightId = right?.id;
    if (typeof leftId === 'number' && typeof rightId === 'number') return leftId - rightId;
    return String(leftId ?? '').localeCompare(String(rightId ?? ''));
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(stableValue(value), null, space);
}

function resolveImportedProjectTitle(title, titleMode = 'imported') {
  const normalizedTitle = String(title || 'Dự án').trim() || 'Dự án';
  if (titleMode === 'original') return normalizedTitle;
  if (/\((Imported|Đã nhập)\)$/iu.test(normalizedTitle)) return normalizedTitle;
  return `${normalizedTitle} (Đã nhập)`;
}

function stripPrimaryKey(record) {
  const { id: _id, ...rest } = record || {};
  return rest;
}

function stripProjectOwner(record) {
  const { id: _id, project_id: _projectId, ...rest } = record || {};
  return rest;
}

function mapPairKey(first, second, fallback = '') {
  if (first == null || second == null) return fallback;
  return [first, second].sort((a, b) => Number(a) - Number(b)).join(':');
}

function makeMaps(projectId) {
  return {
    projectId,
    macroArc: createIdMap(),
    arc: createIdMap(),
    chapter: createIdMap(),
    scene: createIdMap(),
    character: createIdMap(),
    location: createIdMap(),
    object: createIdMap(),
    worldTerm: createIdMap(),
    faction: createIdMap(),
    relationship: createIdMap(),
    plotThread: createIdMap(),
    stylePack: createIdMap(),
    voicePack: createIdMap(),
    legacyRevision: createIdMap(),
    chapterRevision: createIdMap(),
    canonFact: createIdMap(),
    storyEvent: createIdMap(),
    projectAsset: createIdMap(),
    chatThread: createIdMap(),
    chatMessage: createIdMap(),
    chatAttachment: createIdMap(),
  };
}

function tableExists(name) {
  return Boolean(db?.[name]);
}

async function readProjectTables(projectId) {
  const result = {};
  await Promise.all(PROJECT_SNAPSHOT_TABLES.map(async ({ key, table }) => {
    result[key] = tableExists(table)
      ? sortRecords(await db[table].where('project_id').equals(projectId).toArray())
      : [];
  }));

  const plotThreadIds = (result.plotThreads || []).map((row) => row.id);
  result.threadBeats = tableExists('threadBeats') && plotThreadIds.length > 0
    ? sortRecords(await db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).toArray())
    : [];

  const sceneIds = (result.scenes || []).map((row) => row.id);
  result.revisions = tableExists('revisions') && sceneIds.length > 0
    ? sortRecords(await db.revisions.where('scene_id').anyOf(sceneIds).toArray())
    : [];
  return result;
}

async function readReferencedCanonPack(project) {
  const canonPackId = String(project?.source_canon_pack_id || '').trim();
  if (!canonPackId) return { canonPack: null, warnings: [] };
  try {
    const { default: labLiteDb } = await import('../labLite/labLiteDb.js');
    const canonPack = await labLiteDb.canonPacks.get(canonPackId);
    if (canonPack) return { canonPack: clone(canonPack), warnings: [] };
  } catch {
    // A missing or unavailable Lab database must not block the project backup.
  }
  return {
    canonPack: null,
    warnings: [{ code: 'CANON_PACK_MISSING', canonPackId }],
  };
}

export async function buildProjectSnapshot(projectId, options = {}) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) {
    throw new Error('ID dự án không hợp lệ để sao lưu.');
  }

  let project = null;
  let sections = null;
  const transactionTables = getProjectSnapshotTransactionTables(db);
  await db.transaction('r', ...transactionTables, async () => {
    project = await db.projects.get(normalizedProjectId);
    if (!project) throw new Error('Không tìm thấy dự án');
    sections = await readProjectTables(normalizedProjectId);
  });

  const includeCanonPack = options.includeCanonPack !== false;
  const canon = includeCanonPack
    ? await readReferencedCanonPack(project)
    : { canonPack: null, warnings: [] };

  return {
    _storyforge_version: PROJECT_SNAPSHOT_VERSION,
    _exported_at: new Date().toISOString(),
    project: clone(project),
    ...sections,
    canon_pack: canon.canonPack,
    _warnings: canon.warnings,
  };
}

export function migrateProjectSnapshot(input) {
  const source = typeof input === 'string' ? JSON.parse(input) : clone(input);
  if (!source || typeof source !== 'object' || !source.project) {
    throw new Error('File không hợp lệ - không phải bản sao lưu StoryForge');
  }

  const version = Number(source._storyforge_version || 0);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('File không hợp lệ - không phải bản sao lưu StoryForge');
  }
  if (version > PROJECT_SNAPSHOT_VERSION) {
    const error = new Error('Bản sao lưu được tạo bởi phiên bản StoryForge mới hơn. Hãy cập nhật ứng dụng trước khi nhập.');
    error.code = 'PROJECT_SNAPSHOT_VERSION_UNSUPPORTED';
    throw error;
  }

  const migrated = {
    ...source,
    _storyforge_version: PROJECT_SNAPSHOT_VERSION,
  };
  for (const { key } of PROJECT_SNAPSHOT_TABLES) {
    if (!Array.isArray(migrated[key])) migrated[key] = [];
  }
  for (const { key } of PROJECT_INDIRECT_SNAPSHOT_TABLES) {
    if (!Array.isArray(migrated[key])) migrated[key] = [];
  }
  if (!Array.isArray(migrated._warnings)) migrated._warnings = [];
  if (!('canon_pack' in migrated)) migrated.canon_pack = null;
  return migrated;
}

export function validateProjectSnapshot(input) {
  const snapshot = migrateProjectSnapshot(input);
  if (!snapshot.project || typeof snapshot.project !== 'object' || Array.isArray(snapshot.project)) {
    throw new Error('Bản sao lưu không có metadata dự án hợp lệ.');
  }
  let nodes = 0;
  const stack = [{ value: snapshot, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > 1_000_000 || current.depth > 64) {
      throw new Error('Bản sao lưu quá phức tạp để nhập an toàn.');
    }
    if (!current.value || typeof current.value !== 'object') continue;
    for (const key of Object.keys(current.value)) {
      if (FORBIDDEN_IMPORT_KEYS.has(key)) throw new Error('Bản sao lưu chứa key không an toàn.');
      stack.push({ value: current.value[key], depth: current.depth + 1 });
    }
  }
  return snapshot;
}

function makeImportedCanonPackId(oldId) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${String(oldId || 'canon-pack')}-import-${suffix}`;
}

async function stageCanonPack(snapshot) {
  const sourceId = String(snapshot.project?.source_canon_pack_id || '').trim();
  if (!sourceId) return { canonPackId: '', cleanup: async () => {}, finalize: async () => {}, warning: null };
  if (!snapshot.canon_pack) {
    return {
      canonPackId: '',
      cleanup: async () => {},
      finalize: async () => {},
      warning: { code: 'CANON_PACK_REFERENCE_CLEARED', canonPackId: sourceId },
    };
  }

  const { default: labLiteDb } = await import('../labLite/labLiteDb.js');
  const canonPackId = makeImportedCanonPackId(snapshot.canon_pack.id || sourceId);
  const record = {
    ...clone(snapshot.canon_pack),
    id: canonPackId,
    projectId: '',
    linkedProjectId: '',
    updatedAt: Date.now(),
  };
  await labLiteDb.transaction('rw', labLiteDb.canonPacks, async () => {
    await labLiteDb.canonPacks.put(record);
  });
  return {
    canonPackId,
    cleanup: async () => {
      await labLiteDb.canonPacks.delete(canonPackId);
    },
    finalize: async (projectId) => {
      await labLiteDb.canonPacks.update(canonPackId, {
        projectId: String(projectId),
        linkedProjectId: String(projectId),
        updatedAt: Date.now(),
      });
    },
    warning: null,
  };
}

function copyCloudIdentity(targetProject) {
  return CLOUD_PROJECT_FIELDS.reduce((result, key) => {
    if (targetProject && key in targetProject) result[key] = targetProject[key];
    return result;
  }, {});
}

async function deleteProjectRowsInCurrentTransaction(projectId, options = {}) {
  if (!projectId) return;
  const preserveChatsForProjectId = Number(options.preserveChatsForProjectId || 0);
  const plotThreadIds = tableExists('plotThreads')
    ? (await db.plotThreads.where('project_id').equals(projectId).toArray()).map((row) => row.id)
    : [];
  const sceneIds = tableExists('scenes')
    ? (await db.scenes.where('project_id').equals(projectId).toArray()).map((row) => row.id)
    : [];
  const attachmentIds = !preserveChatsForProjectId && tableExists('ai_chat_attachments')
    ? (await db.ai_chat_attachments.where('project_id').equals(projectId).toArray()).map((row) => row.id)
    : [];
  const messageIds = !preserveChatsForProjectId && tableExists('ai_chat_messages')
    ? (await db.ai_chat_messages.where('project_id').equals(projectId).toArray()).map((row) => row.id)
    : [];

  if (attachmentIds.length > 0) {
    if (tableExists('ai_chat_attachment_chunks')) {
      await db.ai_chat_attachment_chunks.where('attachment_id').anyOf(attachmentIds).delete();
    }
    if (tableExists('ai_chat_message_attachments')) {
      await db.ai_chat_message_attachments.where('attachment_id').anyOf(attachmentIds).delete();
    }
  }
  if (messageIds.length > 0 && tableExists('ai_chat_message_attachments')) {
    await db.ai_chat_message_attachments.where('message_id').anyOf(messageIds).delete();
  }
  if (plotThreadIds.length > 0 && tableExists('threadBeats')) {
    await db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).delete();
  }
  if (sceneIds.length > 0 && tableExists('revisions')) {
    await db.revisions.where('scene_id').anyOf(sceneIds).delete();
  }
  if (preserveChatsForProjectId) {
    for (const tableName of ['ai_chat_threads', 'ai_chat_messages', 'ai_chat_attachments']) {
      if (tableExists(tableName)) {
        await db[tableName].where('project_id').equals(projectId).modify({ project_id: preserveChatsForProjectId });
      }
    }
  }

  const directTables = new Set([
    ...PROJECT_SNAPSHOT_TABLES.map((item) => item.table),
    'styleJobs',
    'aiJobs',
    'ai_chat_threads',
    'ai_chat_messages',
    'ai_chat_attachments',
    'storyMirrorOutbox',
    'storyMirrorStatus',
  ]);
  for (const tableName of directTables) {
    if (!tableExists(tableName) || tableName === 'projects') continue;
    if (preserveChatsForProjectId && ['ai_chat_threads', 'ai_chat_messages', 'ai_chat_attachments'].includes(tableName)) continue;
    try {
      await db[tableName].where('project_id').equals(projectId).delete();
    } catch {
      // A compatibility table without a project_id index is handled by its parent IDs above.
    }
  }
  await db.projects.delete(projectId);
}

export async function deleteProjectSnapshotData(projectId) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) {
    throw new Error('ID dự án không hợp lệ để xóa.');
  }
  const transactionTables = getProjectCascadeTransactionTables(db);
  await db.transaction('rw', ...transactionTables, async () => {
    await deleteProjectRowsInCurrentTransaction(normalizedProjectId);
  });
}

async function addMappedRows(tableName, rows, map, transform) {
  if (!tableExists(tableName)) return;
  for (const row of rows || []) {
    const newId = await db[tableName].add(await transform(row));
    if (map) rememberId(map, row.id, newId);
  }
}

function mapEntityReference(type, id, maps, fallback = null) {
  const map = getEntityMap(maps, type) || fallback;
  return map ? remapOptional(map, id) : null;
}

function remapCharactersPresent(value, maps) {
  const parsed = parseJsonValue(value, []);
  const remapped = remapList(Array.isArray(parsed) ? parsed : [], maps.character);
  return preserveJsonShape(value, remapped);
}

function remapCandidateOpsField(value, maps) {
  const parsed = parseJsonValue(value, []);
  if (!Array.isArray(parsed)) return value;
  return preserveJsonShape(value, parsed.map((operation) => remapCandidateOperation(operation, maps)));
}

function remapFanficSetup(value, canonPackId) {
  const parsed = parseJsonValue(value, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
  const next = { ...parsed };
  for (const key of ['canonPackId', 'canon_pack_id', 'source_canon_pack_id']) {
    if (key in next) next[key] = canonPackId || '';
  }
  return preserveJsonShape(value, next);
}

function remapSuggestionTarget(suggestion, maps) {
  const targetType = suggestion.target_type
    || suggestion.entity_kind
    || (suggestion.type === 'character_status' ? 'character' : '');
  return targetType ? mapEntityReference(targetType, suggestion.target_id, maps) : null;
}

async function importRows(snapshot, maps, now) {
  await addMappedRows('project_assets', snapshot.project_assets, maps.projectAsset, async (asset) => ({
    ...stripProjectOwner(asset),
    project_id: maps.projectId,
    created_at: asset.created_at || now,
    updated_at: asset.updated_at || now,
  }));

  await addMappedRows('macro_arcs', snapshot.macro_arcs, maps.macroArc, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
  }));
  await addMappedRows('arcs', snapshot.arcs, maps.arc, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    macro_arc_id: remapOptional(maps.macroArc, row.macro_arc_id),
  }));
  await addMappedRows('characters', snapshot.characters, maps.character, async (row) => {
    const data = stripProjectOwner(row);
    const identity = normalizeEntityIdentity('character', data);
    return { ...data, project_id: maps.projectId, ...identity, faction_id: null };
  });
  await addMappedRows('locations', snapshot.locations, maps.location, async (row) => {
    const data = stripProjectOwner(row);
    const identity = normalizeEntityIdentity('location', data);
    return { ...data, project_id: maps.projectId, ...identity, parent_location_id: null };
  });
  await addMappedRows('worldTerms', snapshot.worldTerms, maps.worldTerm, async (row) => {
    const data = stripProjectOwner(row);
    const identity = normalizeEntityIdentity('world_term', data);
    return { ...data, project_id: maps.projectId, ...identity };
  });
  await addMappedRows('factions', snapshot.factions, maps.faction, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    leader_character_id: null,
    base_location_id: null,
  }));
  await addMappedRows('plotThreads', snapshot.plotThreads, maps.plotThread, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
  }));
  await addMappedRows('chapters', snapshot.chapters, maps.chapter, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    arc_id: remapOptional(maps.arc, row.arc_id),
  }));
  await addMappedRows('scenes', snapshot.scenes, maps.scene, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    pov_character_id: remapOptional(maps.character, row.pov_character_id),
    location_id: remapOptional(maps.location, row.location_id),
    characters_present: remapCharactersPresent(row.characters_present, maps),
    content: row.content,
  }));
  await addMappedRows('objects', snapshot.objects, maps.object, async (row) => {
    const data = stripProjectOwner(row);
    const identity = normalizeEntityIdentity('object', data);
    return {
      ...data,
      project_id: maps.projectId,
      ...identity,
      owner_character_id: remapOptional(maps.character, row.owner_character_id),
      current_location_id: remapOptional(maps.location, row.current_location_id),
      location_id: remapOptional(maps.location, row.location_id),
    };
  });
  await addMappedRows('stylePacks', snapshot.stylePacks, maps.stylePack, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
  }));
  await addMappedRows('voicePacks', snapshot.voicePacks, maps.voicePack, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    character_id: remapOptional(maps.character, row.character_id),
  }));
  await addMappedRows('revisions', snapshot.revisions, maps.legacyRevision, async (row) => ({
    ...stripPrimaryKey(row), scene_id: remapOptional(maps.scene, row.scene_id),
  }));
  await addMappedRows('chapter_revisions', snapshot.chapter_revisions, maps.chapterRevision, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    candidate_ops: row.candidate_ops,
  }));
  await addMappedRows('canonFacts', snapshot.canonFacts, maps.canonFact, async (row) => {
    const subjectId = mapEntityReference(row.subject_type, row.subject_id, maps);
    const data = { ...stripProjectOwner(row), project_id: maps.projectId, subject_id: subjectId };
    return { ...data, ...normalizeCanonFactRecord(data), subject_id: subjectId };
  });
  await addMappedRows('story_events', snapshot.story_events, maps.storyEvent, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    revision_id: remapOptional(maps.chapterRevision, row.revision_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
    subject_id: mapEntityReference(row.subject_type || row.payload?.subject_type || 'character', row.subject_id, maps, maps.character),
    target_id: mapEntityReference(row.target_type || row.payload?.target_type || 'character', row.target_id, maps, maps.character),
    object_id: remapOptional(maps.object, row.object_id),
    location_id: remapOptional(maps.location, row.location_id),
    thread_id: remapOptional(maps.plotThread, row.thread_id),
    fact_id: remapOptional(maps.canonFact, row.fact_id),
    payload: remapKnownEmbeddedValue(row.payload, maps),
  }));

  for (const row of snapshot.locations || []) {
    const newId = remapOptional(maps.location, row.id);
    if (newId != null) await db.locations.update(newId, {
      parent_location_id: remapOptional(maps.location, row.parent_location_id),
    });
  }
  for (const row of snapshot.characters || []) {
    const newId = remapOptional(maps.character, row.id);
    if (newId != null) await db.characters.update(newId, {
      faction_id: remapOptional(maps.faction, row.faction_id),
      current_location_id: remapOptional(maps.location, row.current_location_id),
    });
  }
  for (const row of snapshot.factions || []) {
    const newId = remapOptional(maps.faction, row.id);
    if (newId != null) await db.factions.update(newId, {
      leader_character_id: remapOptional(maps.character, row.leader_character_id),
      base_location_id: remapOptional(maps.location, row.base_location_id),
    });
  }
  for (const row of snapshot.chapter_revisions || []) {
    const newId = remapOptional(maps.chapterRevision, row.id);
    if (newId != null) await db.chapter_revisions.update(newId, {
      candidate_ops: remapCandidateOpsField(row.candidate_ops, maps),
    });
  }

  await addMappedRows('characterStates', snapshot.characterStates, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    character_id: remapOptional(maps.character, row.character_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
  }));
  await addMappedRows('relationships', snapshot.relationships, maps.relationship, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    character_a_id: remapOptional(maps.character, row.character_a_id),
    character_b_id: remapOptional(maps.character, row.character_b_id),
  }));
  await addMappedRows('taboos', snapshot.taboos, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    character_id: remapOptional(maps.character, row.character_id),
  }));
  await addMappedRows('chapterMeta', snapshot.chapterMeta, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
  }));
  await addMappedRows('threadBeats', snapshot.threadBeats, null, async (row) => ({
    ...stripPrimaryKey(row),
    plot_thread_id: remapOptional(maps.plotThread, row.plot_thread_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
  }));
  await addMappedRows('timelineEvents', snapshot.timelineEvents, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    scene_id: remapOptional(maps.scene, row.scene_id),
    character_id: remapOptional(maps.character, row.character_id),
    location_id: remapOptional(maps.location, row.location_id),
    object_id: remapOptional(maps.object, row.object_id),
  }));
  await addMappedRows('qaReports', snapshot.qaReports, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
    revision_id: remapOptional(maps.legacyRevision, row.revision_id),
  }));
  await addMappedRows('suggestions', snapshot.suggestions, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    source_chapter_id: remapOptional(maps.chapter, row.source_chapter_id),
    target_id: remapSuggestionTarget(row, maps),
    candidate_ops: remapCandidateOpsField(row.candidate_ops, maps),
    operations: remapCandidateOpsField(row.operations, maps),
    payload_json: remapJsonField(row.payload_json, maps),
  }));
  await addMappedRows('entityTimeline', snapshot.entityTimeline, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    entity_id: mapEntityReference(row.entity_type, row.entity_id, maps),
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
  }));
  await addMappedRows('entity_state_current', snapshot.entity_state_current, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    entity_id: mapEntityReference(row.entity_type, row.entity_id, maps),
    last_event_id: remapOptional(maps.storyEvent, row.last_event_id),
    source_revision_id: remapOptional(maps.chapterRevision, row.source_revision_id),
  }));
  await addMappedRows('plot_thread_state', snapshot.plot_thread_state, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    thread_id: remapOptional(maps.plotThread, row.thread_id),
    focus_entity_ids: remapList(row.focus_entity_ids, maps.character),
    last_event_id: remapOptional(maps.storyEvent, row.last_event_id),
    source_revision_id: remapOptional(maps.chapterRevision, row.source_revision_id),
  }));
  await addMappedRows('item_state_current', snapshot.item_state_current, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    object_id: remapOptional(maps.object, row.object_id),
    owner_character_id: remapOptional(maps.character, row.owner_character_id),
    current_location_id: remapOptional(maps.location, row.current_location_id),
    last_event_id: remapOptional(maps.storyEvent, row.last_event_id),
    source_revision_id: remapOptional(maps.chapterRevision, row.source_revision_id),
  }));
  await addMappedRows('relationship_state_current', snapshot.relationship_state_current, null, async (row) => {
    const characterAId = remapOptional(maps.character, row.character_a_id);
    const characterBId = remapOptional(maps.character, row.character_b_id);
    return {
      ...stripProjectOwner(row), project_id: maps.projectId,
      character_a_id: characterAId,
      character_b_id: characterBId,
      pair_key: mapPairKey(characterAId, characterBId, ''),
      last_event_id: remapOptional(maps.storyEvent, row.last_event_id),
      source_revision_id: remapOptional(maps.chapterRevision, row.source_revision_id),
    };
  });
  await addMappedRows('validator_reports', snapshot.validator_reports, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    revision_id: remapOptional(maps.chapterRevision, row.revision_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
    related_entity_ids: remapList(row.related_entity_ids, maps.character),
    related_thread_ids: remapList(row.related_thread_ids, maps.plotThread),
    related_event_ids: remapList(row.related_event_ids, maps.storyEvent),
  }));
  await addMappedRows('memory_evidence', snapshot.memory_evidence, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    revision_id: remapOptional(maps.chapterRevision, row.revision_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
    target_id: mapEntityReference(row.target_type, row.target_id, maps),
  }));
  await addMappedRows('chapter_commits', snapshot.chapter_commits, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    current_revision_id: remapOptional(maps.chapterRevision, row.current_revision_id),
    canonical_revision_id: remapOptional(maps.chapterRevision, row.canonical_revision_id),
  }));
  await addMappedRows('chapter_snapshots', snapshot.chapter_snapshots, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    revision_id: remapOptional(maps.chapterRevision, row.revision_id),
    snapshot_json: remapCanonSnapshot(row.snapshot_json, maps),
  }));
  await addMappedRows('canon_purge_archives', snapshot.canon_purge_archives, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    removed_records: remapJsonField(row.removed_records, maps),
    payload: remapJsonField(row.payload, maps),
  }));
  await addMappedRows('linked_events', snapshot.linked_events, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    scene_id: remapOptional(maps.scene, row.scene_id),
    materialized_chapter_id: remapOptional(maps.chapter, row.materialized_chapter_id),
    materialized_scene_id: remapOptional(maps.scene, row.materialized_scene_id),
    event_snapshot: remapJsonField(row.event_snapshot, maps),
  }));
  await addMappedRows('project_analysis_snapshots', snapshot.project_analysis_snapshots, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    snapshot_json: remapJsonField(row.snapshot_json, maps),
    payload_json: remapJsonField(row.payload_json, maps),
  }));
  await addMappedRows('entity_resolution_candidates', snapshot.entity_resolution_candidates, null, async (row) => ({
    ...stripProjectOwner(row), project_id: maps.projectId,
    chapter_id: remapOptional(maps.chapter, row.chapter_id),
    revision_id: remapOptional(maps.chapterRevision, row.revision_id),
    matched_entity_id: mapEntityReference(row.entity_kind, row.matched_entity_id, maps),
    payload_json: remapJsonField(row.payload_json, maps),
    resolver_debug_json: remapJsonField(row.resolver_debug_json, maps),
  }));
}

async function importChats(chats, maps, now, { preserveCloudMetadata = false } = {}) {
  if (!chats || typeof chats !== 'object') return;
  await addMappedRows('ai_chat_threads', chats.threads, maps.chatThread, async (row) => {
    const normalizedThread = normalizeSupremeThreadForPersistence(row);
    const data = stripProjectOwner(normalizedThread);
    if (!preserveCloudMetadata) {
      for (const key of Object.keys(data)) {
        if (key.startsWith('cloud_')) delete data[key];
      }
    }
    if (data.chat_mode === 'supreme') {
      data.chat_mode = 'story';
      data.system_prompt = '';
      data.system_prompt_customized = false;
    }
    return { ...data, project_id: maps.projectId, created_at: row.created_at || now, updated_at: row.updated_at || now };
  });
  await addMappedRows('ai_chat_messages', chats.messages, maps.chatMessage, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    thread_id: remapOptional(maps.chatThread, row.thread_id),
  }));
  await addMappedRows('ai_chat_attachments', chats.attachments, maps.chatAttachment, async (row) => ({
    ...stripProjectOwner(row),
    project_id: maps.projectId,
    thread_id: remapOptional(maps.chatThread, row.thread_id),
  }));
  await addMappedRows('ai_chat_attachment_chunks', chats.attachment_chunks, null, async (row) => ({
    ...stripPrimaryKey(row),
    attachment_id: remapOptional(maps.chatAttachment, row.attachment_id),
  }));
  await addMappedRows('ai_chat_message_attachments', chats.message_attachments, null, async (row) => ({
    ...stripPrimaryKey(row),
    message_id: remapOptional(maps.chatMessage, row.message_id),
    attachment_id: remapOptional(maps.chatAttachment, row.attachment_id),
  }));
}

export async function importProjectSnapshot(input, options = {}) {
  const snapshot = validateProjectSnapshot(input);
  const replaceProjectId = Number(options.replaceProjectId || options.targetProjectId || 0);
  const shouldReplace = Number.isFinite(replaceProjectId) && replaceProjectId > 0;
  const targetProject = shouldReplace ? await db.projects.get(replaceProjectId) : null;
  if (shouldReplace && !targetProject) throw new Error('Project đích không còn tồn tại.');

  const stagedCanon = options.includeCanonPack === false
    ? { canonPackId: '', cleanup: async () => {}, finalize: async () => {}, warning: null }
    : await stageCanonPack(snapshot);
  const warnings = [...(snapshot._warnings || [])];
  if (stagedCanon.warning) warnings.push(stagedCanon.warning);

  try {
    let newProjectId = null;
    let importedMaps = null;
    const transactionTables = getProjectCascadeTransactionTables(db);
    await db.transaction('rw', ...transactionTables, async () => {
      const now = Date.now();
      const sourceProject = stripPrimaryKey(snapshot.project);
      const cleanProject = { ...sourceProject };
      for (const key of Object.keys(cleanProject)) {
        if (key.startsWith('cloud_') || ACCESS_CONTROL_PROJECT_FIELDS.has(key)) delete cleanProject[key];
      }
      const cloudIdentity = shouldReplace ? copyCloudIdentity(targetProject) : {};
      const oldCoverAssetId = snapshot.project.cover_asset_id;
      delete cleanProject.cover_asset_id;
      delete cleanProject.cover_thumbnail_data_url;
      cleanProject.source_canon_pack_id = String(options.sourceCanonPackId || stagedCanon.canonPackId || '');
      cleanProject.fanfic_setup = remapFanficSetup(cleanProject.fanfic_setup, cleanProject.source_canon_pack_id);
      if (shouldReplace && options.source !== 'cloud') {
        cloudIdentity.cloud_pending_file_import = true;
      }

      newProjectId = await db.projects.add({
        ...cleanProject,
        ...cloudIdentity,
        title: resolveImportedProjectTitle(
          sourceProject.title,
          shouldReplace || options.titleMode === 'original' ? 'original' : 'imported',
        ),
        created_at: shouldReplace ? (targetProject.created_at || now) : now,
        updated_at: now,
      });
      const maps = makeMaps(newProjectId);
      importedMaps = maps;
      await importRows(snapshot, maps, now);
      await importChats(options.chats, maps, now, {
        preserveCloudMetadata: options.preserveChatCloudMetadata ?? options.source === 'cloud',
      });

      const fallbackCoverSourceId = (snapshot.project_assets || []).find((asset) => asset.role === 'cover')?.id;
      const finalCoverAssetId = remapOptional(maps.projectAsset, oldCoverAssetId)
        || remapOptional(maps.projectAsset, fallbackCoverSourceId)
        || 0;
      if (finalCoverAssetId) {
        const cover = await db.project_assets.get(finalCoverAssetId);
        await db.projects.update(newProjectId, {
          cover_asset_id: finalCoverAssetId,
          cover_thumbnail_data_url: cover?.thumbnail_data_url || cover?.data_url || '',
        });
      }

      if (shouldReplace) {
        await deleteProjectRowsInCurrentTransaction(replaceProjectId, {
          preserveChatsForProjectId: options.preserveTargetChats ? newProjectId : 0,
        });
      }
    });

    try {
      await stagedCanon.finalize(newProjectId);
    } catch {
      warnings.push({ code: 'CANON_PACK_FINALIZE_INCOMPLETE', canonPackId: stagedCanon.canonPackId });
    }

    return {
      projectId: newProjectId,
      warnings,
      replacedProjectId: shouldReplace ? replaceProjectId : null,
      idMaps: importedMaps,
    };
  } catch (error) {
    await stagedCanon.cleanup();
    throw error;
  }
}

export async function hashProjectSnapshot(snapshot) {
  const normalized = clone(snapshot);
  delete normalized._exported_at;
  if (normalized.project && typeof normalized.project === 'object') {
    delete normalized.project.updated_at;
    for (const key of Object.keys(normalized.project)) {
      if (key.startsWith('cloud_')) delete normalized.project[key];
    }
  }
  const bytes = new TextEncoder().encode(stableStringify(normalized));
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto không khả dụng.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  buildProjectSnapshot,
  validateProjectSnapshot,
  migrateProjectSnapshot,
  importProjectSnapshot,
  deleteProjectSnapshotData,
  hashProjectSnapshot,
  stableStringify,
};
