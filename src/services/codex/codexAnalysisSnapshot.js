import dbDefault from '../db/database.js';
import { sha256HexBytes } from '../storyBundle/storyBundleHash.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, token) => {
    const normalized = String(token).toLowerCase();
    if (normalized[0] !== '#') return named[normalized] ?? match;
    const isHex = normalized.startsWith('#x');
    const parsed = Number.parseInt(normalized.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
  });
}

function htmlToParagraphs(value) {
  const text = decodeHtmlEntities(String(value || '')
    .replace(/<\s*br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, ' '));
  return text
    .split(/\n+/gu)
    .map(cleanText)
    .filter(Boolean);
}

function splitBoundedParagraph(text, maxLength = 4000) {
  const chunks = [];
  let remaining = cleanText(text);
  while (remaining.length > maxLength) {
    const preferredBreak = remaining.lastIndexOf(' ', maxLength);
    const breakAt = preferredBreak >= Math.floor(maxLength * 0.6) ? preferredBreak : maxLength;
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function hashJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return `sha256:${await sha256HexBytes(bytes)}`;
}

async function loadProjectRows(db, tableName, projectId) {
  const table = db?.[tableName];
  if (!table?.where) return [];
  return table.where('project_id').equals(projectId).toArray();
}

function withoutProjectIds(value) {
  if (Array.isArray(value)) return value.map(withoutProjectIds);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((result, [key, item]) => {
    if (key === 'project_id') return result;
    result[key] = withoutProjectIds(item);
    return result;
  }, {});
}

function relatedRows(rows, predicate, limit = 50) {
  return rows.filter(predicate).slice(-limit).map(withoutProjectIds);
}

function normalizeEntityKind(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/gu, '_');
  if (['term', 'worldterm', 'world_term'].includes(normalized)) return 'world_term';
  if (['item', 'object'].includes(normalized)) return 'object';
  return normalized;
}

function typedIdMatches(row, idField, typeField, entity, fallbackKind = '') {
  if (row?.[idField] !== entity.id) return false;
  const declaredKind = normalizeEntityKind(row?.[typeField]);
  return declaredKind
    ? declaredKind === entity.entity_kind
    : fallbackKind === entity.entity_kind;
}

function eventPayload(row) {
  if (row?.payload && typeof row.payload === 'object') return row.payload;
  if (typeof row?.payload === 'string') {
    try { return JSON.parse(row.payload); } catch { return {}; }
  }
  return {};
}

function storyEventMatches(row, entity) {
  if (entity.entity_kind === 'object' && row.object_id === entity.id) return true;
  if (entity.entity_kind === 'location' && row.location_id === entity.id) return true;
  const payload = eventPayload(row);
  const subjectType = row.subject_type || payload.subject_type || '';
  const targetType = row.target_type || payload.target_type || '';
  return typedIdMatches({ ...row, subject_type: subjectType }, 'subject_id', 'subject_type', entity, 'character')
    || typedIdMatches({ ...row, target_type: targetType }, 'target_id', 'target_type', entity, 'character');
}

function canonFactMatches(row, entity) {
  if (typedIdMatches(row, 'subject_id', 'subject_type', entity)) return true;
  if (typedIdMatches(row, 'entity_id', 'entity_type', entity)) return true;
  const relatedIds = Array.isArray(row.related_entity_ids) ? row.related_entity_ids : [];
  const relatedTypes = Array.isArray(row.related_entity_types) ? row.related_entity_types : [];
  return relatedIds.some((id, index) => (
    id === entity.id && normalizeEntityKind(relatedTypes[index]) === entity.entity_kind
  ));
}

function catalogFingerprint(entity) {
  return {
    id: entity.id,
    entity_kind: entity.entity_kind,
    name: entity.name,
    aliases: entity.aliases,
    role: entity.role,
    description: entity.description,
    definition: entity.definition,
    category: entity.category,
    owner_character_id: entity.owner_character_id,
    holder_character_id: entity.holder_character_id,
    parent_location_id: entity.parent_location_id,
    current_status: entity.current_status,
    canon_state: entity.canon_state,
    relationships: entity.relationships,
    history: entity.history,
    canon_facts: entity.canon_facts,
    source_appearances: entity.source_appearances,
    updated_at: entity.updated_at || 0,
  };
}

export async function buildCodexAnalysisSnapshot({
  db = dbDefault,
  projectId,
  chapterId,
}) {
  const [chapter, scenes, characters, locations, objects, worldTerms, relationships, timelines, entityStates, itemStates, storyEvents, canonFacts, memoryEvidence] = await Promise.all([
    db.chapters.get(chapterId),
    db.scenes.where('chapter_id').equals(chapterId).toArray(),
    loadProjectRows(db, 'characters', projectId),
    loadProjectRows(db, 'locations', projectId),
    loadProjectRows(db, 'objects', projectId),
    loadProjectRows(db, 'worldTerms', projectId),
    loadProjectRows(db, 'relationships', projectId),
    loadProjectRows(db, 'entityTimeline', projectId),
    loadProjectRows(db, 'entity_state_current', projectId),
    loadProjectRows(db, 'item_state_current', projectId),
    loadProjectRows(db, 'story_events', projectId),
    loadProjectRows(db, 'canonFacts', projectId),
    loadProjectRows(db, 'memory_evidence', projectId),
  ]);
  if (!chapter || Number(chapter.project_id) !== Number(projectId)) {
    throw new Error('Codex chapter is outside the current project.');
  }

  const orderedScenes = scenes
    .filter((scene) => Number(scene.project_id) === Number(projectId))
    .sort((left, right) => (Number(left.order_index) || 0) - (Number(right.order_index) || 0));
  const paragraphs = orderedScenes.flatMap((scene) => (
    htmlToParagraphs(scene.draft_text || scene.final_text || '').flatMap((text, index) => {
      const chunks = splitBoundedParagraph(text);
      return chunks.map((chunk, chunkIndex) => ({
        id: chunks.length === 1
          ? `scene-${scene.id}:p-${index + 1}`
          : `scene-${scene.id}:p-${index + 1}:c-${chunkIndex + 1}`,
        text: chunk,
      }));
    })
  ));

  const baseEntities = [
    ...characters.map((entity) => ({ ...entity, entity_kind: 'character' })),
    ...locations.map((entity) => ({ ...entity, entity_kind: 'location' })),
    ...objects.map((entity) => ({ ...entity, entity_kind: 'object' })),
    ...worldTerms.map((entity) => ({ ...entity, name: entity.name || entity.term || '', entity_kind: 'world_term' })),
  ].sort((left, right) => (
    String(left.entity_kind).localeCompare(String(right.entity_kind))
    || Number(left.id) - Number(right.id)
  ));
  const characterNameById = new Map(characters.map((character) => [character.id, character.name]));
  const entities = baseEntities.map((entity) => {
    const entityId = entity.id;
    const isCharacter = entity.entity_kind === 'character';
    const isObject = entity.entity_kind === 'object';
    return {
      ...withoutProjectIds(entity),
      aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
      owner_name: characterNameById.get(entity.owner_character_id) || '',
      holder_name: characterNameById.get(entity.holder_character_id) || '',
      canon_state: isCharacter
        ? withoutProjectIds(entityStates.find((row) => (
          row.entity_id === entityId && normalizeEntityKind(row.entity_type || 'character') === 'character'
        )) || null)
        : isObject
          ? withoutProjectIds(itemStates.find((row) => row.object_id === entityId) || null)
          : null,
      relationships: isCharacter
        ? relatedRows(relationships, (row) => row.character_a_id === entityId || row.character_b_id === entityId)
        : [],
      history: relatedRows([
        ...timelines,
        ...storyEvents,
      ], (row) => (
        ('entity_id' in row
          ? typedIdMatches(row, 'entity_id', 'entity_type', entity)
          : storyEventMatches(row, entity))
      )),
      canon_facts: relatedRows(canonFacts, (row) => canonFactMatches(row, entity)),
      source_appearances: relatedRows(memoryEvidence, (row) => (
        typedIdMatches(row, 'target_id', 'target_type', entity)
      )),
    };
  });

  const sourceHash = await hashJson({
    chapter_id: chapterId,
    scenes: orderedScenes.map((scene) => ({
      id: scene.id,
      order_index: scene.order_index || 0,
      text: scene.draft_text || scene.final_text || '',
    })),
  });
  const catalogRevision = await hashJson(entities.map(catalogFingerprint));
  return {
    projectId,
    chapterId,
    chapterTitle: chapter.title || '',
    paragraphs,
    entities,
    sourceHash,
    catalogRevision,
  };
}

export { htmlToParagraphs, splitBoundedParagraph };
