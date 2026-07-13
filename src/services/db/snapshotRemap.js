function mapKey(value) {
  return value == null ? '' : String(value);
}

export function createIdMap() {
  return new Map();
}

export function rememberId(map, oldId, newId) {
  if (oldId != null && newId != null) map.set(mapKey(oldId), newId);
}

export function remapOptional(map, oldId) {
  if (oldId == null || oldId === '') return null;
  return map.get(mapKey(oldId)) ?? null;
}

export function remapList(value, map) {
  if (!Array.isArray(value)) return [];
  return value.map((id) => remapOptional(map, id)).filter((id) => id != null);
}

export function parseJsonValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function preserveJsonShape(original, value) {
  return typeof original === 'string' ? JSON.stringify(value) : value;
}

export function getEntityMap(maps, entityType) {
  const normalized = String(entityType || '').trim().toLowerCase();
  if (normalized === 'character' || normalized === 'person') return maps.character;
  if (normalized === 'location' || normalized === 'place') return maps.location;
  if (normalized === 'object' || normalized === 'item') return maps.object;
  if (normalized === 'world_term' || normalized === 'worldterm' || normalized === 'term') return maps.worldTerm;
  if (normalized === 'faction' || normalized === 'organization') return maps.faction;
  if (normalized === 'plot_thread' || normalized === 'thread') return maps.plotThread;
  if (normalized === 'canon_fact' || normalized === 'fact') return maps.canonFact;
  if (normalized === 'story_event' || normalized === 'event') return maps.storyEvent;
  if (normalized === 'chapter_revision' || normalized === 'revision') return maps.chapterRevision;
  if (normalized === 'scene') return maps.scene;
  if (normalized === 'chapter') return maps.chapter;
  return null;
}

function remapTypedId(value, type, maps, fallbackMap = null) {
  const map = getEntityMap(maps, type) || fallbackMap;
  return map ? remapOptional(map, value) : null;
}

export function remapCandidateOperation(operation, maps) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation;
  const next = { ...operation };
  const subjectType = next.subject_type || next.payload?.subject_type || 'character';
  const targetType = next.target_type || next.payload?.target_type || 'character';
  if ('project_id' in next) next.project_id = maps.projectId;
  if ('chapter_id' in next) next.chapter_id = remapOptional(maps.chapter, next.chapter_id);
  if ('scene_id' in next) next.scene_id = remapOptional(maps.scene, next.scene_id);
  if ('revision_id' in next) next.revision_id = remapOptional(maps.chapterRevision, next.revision_id);
  if ('subject_id' in next) next.subject_id = remapTypedId(next.subject_id, subjectType, maps, maps.character);
  if ('target_id' in next) next.target_id = remapTypedId(next.target_id, targetType, maps, maps.character);
  if ('object_id' in next) next.object_id = remapOptional(maps.object, next.object_id);
  if ('location_id' in next) next.location_id = remapOptional(maps.location, next.location_id);
  if ('fact_id' in next) next.fact_id = remapOptional(maps.canonFact, next.fact_id);
  if ('thread_id' in next) next.thread_id = remapOptional(maps.plotThread, next.thread_id);
  if (next.payload && typeof next.payload === 'object') {
    next.payload = remapKnownEmbeddedValue(next.payload, maps);
  }
  return next;
}

export function remapKnownEmbeddedValue(value, maps, depth = 0) {
  if (depth > 64 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => remapKnownEmbeddedValue(item, maps, depth + 1));
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'project_id') next[key] = maps.projectId;
    else if (key === 'chapter_id') next[key] = remapOptional(maps.chapter, item);
    else if (key === 'scene_id') next[key] = remapOptional(maps.scene, item);
    else if (key === 'revision_id' || key === 'source_revision_id') next[key] = remapOptional(maps.chapterRevision, item);
    else if (key === 'character_id' || key === 'owner_character_id' || key === 'holder_character_id' || key === 'return_to_character_id' || key === 'pov_character_id') next[key] = remapOptional(maps.character, item);
    else if (key === 'location_id' || key === 'current_location_id' || key === 'parent_location_id') next[key] = remapOptional(maps.location, item);
    else if (key === 'object_id') next[key] = remapOptional(maps.object, item);
    else if (key === 'fact_id') next[key] = remapOptional(maps.canonFact, item);
    else if (key === 'thread_id' || key === 'plot_thread_id') next[key] = remapOptional(maps.plotThread, item);
    else if (key === 'event_id' || key === 'last_event_id') next[key] = remapOptional(maps.storyEvent, item);
    else if (key === 'arc_id') next[key] = remapOptional(maps.arc, item);
    else if (key === 'macro_arc_id') next[key] = remapOptional(maps.macroArc, item);
    else if (key === 'style_pack_id') next[key] = remapOptional(maps.stylePack, item);
    else if (key === 'voice_pack_id') next[key] = remapOptional(maps.voicePack, item);
    else if (key === 'faction_id') next[key] = remapOptional(maps.faction, item);
    else if (key === 'characters_present' || key === 'character_ids' || key === 'focus_entity_ids' || key === 'related_entity_ids') next[key] = remapList(item, maps.character);
    else if (key === 'related_thread_ids') next[key] = remapList(item, maps.plotThread);
    else if (key === 'related_event_ids') next[key] = remapList(item, maps.storyEvent);
    else next[key] = remapKnownEmbeddedValue(item, maps, depth + 1);
  }
  return next;
}

export function remapCanonSnapshot(snapshotValue, maps) {
  const parsed = parseJsonValue(snapshotValue, null);
  if (!parsed || typeof parsed !== 'object') return snapshotValue;
  const next = remapKnownEmbeddedValue(parsed, maps);

  if (Array.isArray(next.entityStates)) {
    next.entityStates = next.entityStates.map((state) => ({
      ...state,
      entity_id: remapTypedId(state.entity_id, state.entity_type, maps),
    }));
  }
  if (Array.isArray(next.factStates)) {
    next.factStates = next.factStates.map((fact) => ({
      ...fact,
      id: remapOptional(maps.canonFact, fact.id),
      subject_id: remapTypedId(fact.subject_id, fact.subject_type, maps),
    }));
  }
  return preserveJsonShape(snapshotValue, next);
}

export function remapJsonField(value, maps, mapper = remapKnownEmbeddedValue) {
  const parsed = parseJsonValue(value, null);
  if (parsed == null) return value;
  return preserveJsonShape(value, mapper(parsed, maps));
}
