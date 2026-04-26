import db from '../db/database.js';
import { normalizeEntityIdentity } from '../entityIdentity/index.js';
import { normalizeCanonFactRecord } from '../entityIdentity/factIdentity.js';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function now() {
  return Date.now();
}

function actionRecord({ type, source, action, reason, existing = null, payload = null }) {
  return {
    id: `${type}_${source?.name || source?.title || source?.description || Math.random().toString(36).slice(2)}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
    type,
    action,
    reason,
    existingId: existing?.id || null,
    source,
    payload,
  };
}

async function findEntity(table, projectId, kind, source) {
  const identity = normalizeEntityIdentity(kind, source);
  const rows = await table.where('project_id').equals(projectId).toArray();
  const normalizedNameMatches = (row) => {
    if (!row?.name) return false;
    return normalizeEntityIdentity(kind, { name: row.name }).normalized_name === identity.normalized_name;
  };
  const existing = rows.find((row) => (
    row.identity_key === identity.identity_key
    || row.normalized_name === identity.normalized_name
    || normalizedNameMatches(row)
    || (Array.isArray(row.alias_keys) && row.alias_keys.some((alias) => identity.alias_keys.includes(alias)))
  )) || null;
  return { identity, existing };
}

async function planCharacters(projectId, pack) {
  const actions = [];
  for (const character of pack.characterCanon || []) {
    const name = clean(character.name);
    if (!name) continue;
    const { identity, existing } = await findEntity(db.characters, projectId, 'character', character);
    const payload = {
      project_id: projectId,
      name,
      normalized_name: identity.normalized_name,
      alias_keys: identity.alias_keys,
      identity_key: identity.identity_key,
      aliases: character.aliases || [],
      role: character.role || 'supporting',
      age: character.age || character.ageRange || character.age_range || '',
      personality: character.personality || '',
      current_status: character.status || '',
      goals: character.goals || '',
      secrets: character.secrets || '',
      speech_pattern: character.voice || '',
      notes: character.evidence?.join('\n') || '',
      source_kind: 'lab_lite_canon_pack',
      created_at: now(),
    };
    if (existing && !payload.age) {
      delete payload.age;
    }
    actions.push(actionRecord({
      type: 'character',
      source: character,
      action: existing ? 'update' : 'create',
      reason: existing ? 'Trùng identity_key hoặc normalized_name.' : 'Nhân vật mới từ Canon Pack.',
      existing,
      payload,
    }));
  }
  return actions;
}

async function planWorldItems(projectId, pack) {
  const actions = [];
  const updates = [];
  for (const item of pack.chapterCanon || []) {
    for (const event of item.mainEvents || []) {
      updates.push({
        type: 'timeline',
        chapterIndex: item.chapterIndex,
        event,
      });
    }
  }
  for (const rule of pack.globalCanon?.worldRules || []) {
    updates.push({ type: 'term', name: rule, description: rule, category: 'rule' });
  }

  const worldUpdates = [];
  for (const item of pack.metadata?.worldUpdates || []) worldUpdates.push(item);
  for (const item of updates) worldUpdates.push(item);

  for (const item of worldUpdates) {
    if (item.type === 'timeline') {
      actions.push(actionRecord({
        type: 'timeline',
        source: item,
        action: 'create',
        reason: 'Sự kiện timeline từ chapter canon.',
        payload: {
          project_id: projectId,
          date_marker: item.chapterIndex ? `Chương ${item.chapterIndex}` : '',
          description: item.event || item.description || '',
          created_at: now(),
          source_kind: 'lab_lite_canon_pack',
        },
      }));
      continue;
    }

    const type = item.type === 'location' ? 'location'
      : item.type === 'object' ? 'object'
        : item.type === 'faction' ? 'faction'
          : 'world_term';
    const table = type === 'location' ? db.locations
      : type === 'object' ? db.objects
        : type === 'faction' ? db.factions
          : db.worldTerms;
    const kind = type === 'world_term' ? 'world_term' : type;
    const name = clean(item.name || item.description);
    if (!name) continue;
    const { identity, existing } = await findEntity(table, projectId, kind, { name });
    const payload = {
      project_id: projectId,
      name,
      normalized_name: identity.normalized_name,
      alias_keys: identity.alias_keys,
      identity_key: identity.identity_key,
      description: item.description || '',
      definition: item.description || '',
      category: item.category || 'canon',
      faction_type: 'organization',
      source_kind: 'lab_lite_canon_pack',
      created_at: now(),
    };
    actions.push(actionRecord({
      type,
      source: item,
      action: existing ? 'update' : 'create',
      reason: existing ? 'Trùng tên đã chuẩn hóa.' : 'Mục thế giới mới từ Canon Pack.',
      existing,
      payload,
    }));
  }
  return actions;
}

async function planCanonFacts(projectId, pack) {
  const actions = [];
  const descriptions = [
    ...(pack.canonRestrictions || []).map((description) => ({ description, fact_type: 'rule' })),
    ...(pack.globalCanon?.hardRestrictions || []).map((description) => ({ description, fact_type: 'rule' })),
    ...(pack.globalCanon?.timelineAnchors || []).map((item) => ({ description: item.event || item.description || String(item), fact_type: 'fact' })),
  ];

  const existingFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
  for (const fact of descriptions) {
    const description = clean(fact.description);
    if (!description) continue;
    const normalized = normalizeCanonFactRecord({ ...fact, description });
    const existing = existingFacts.find((item) => item.fact_fingerprint === normalized.fact_fingerprint) || null;
    actions.push(actionRecord({
      type: 'canon_fact',
      source: fact,
      action: existing ? 'skip' : 'create',
      reason: existing ? 'Canon fact đã tồn tại.' : 'Canon restriction/fact mới từ Canon Pack.',
      existing,
      payload: {
        project_id: projectId,
        description,
        fact_type: fact.fact_type || 'fact',
        status: 'active',
        source_kind: 'lab_lite_canon_pack',
        ...normalized,
        created_at: now(),
      },
    }));
  }
  return actions;
}

async function planRelationships(projectId, pack) {
  if (!db.relationships) return [];
  const actions = [];
  const characters = await db.characters.where('project_id').equals(projectId).toArray();
  const relationships = await db.relationships.where('project_id').equals(projectId).toArray();

  const findCharacterByName = (name) => {
    const identity = normalizeEntityIdentity('character', { name });
    return characters.find((character) => (
      character.identity_key === identity.identity_key
      || character.normalized_name === identity.normalized_name
      || normalizeEntityIdentity('character', { name: character.name }).normalized_name === identity.normalized_name
      || (Array.isArray(character.alias_keys) && character.alias_keys.some((alias) => identity.alias_keys.includes(alias)))
    )) || null;
  };

  for (const relationship of pack.relationshipCanon || []) {
    const characterAName = clean(relationship.characterA || relationship.source || relationship.a);
    const characterBName = clean(relationship.characterB || relationship.target || relationship.b);
    if (!characterAName || !characterBName) continue;

    const characterA = findCharacterByName(characterAName);
    const characterB = findCharacterByName(characterBName);
    if (!characterA || !characterB) {
      actions.push(actionRecord({
        type: 'relationship',
        source: relationship,
        action: 'needs_review',
        reason: 'Cần xác nhận vì chưa tìm thấy đủ nhân vật trong Story Bible.',
        payload: null,
      }));
      continue;
    }

    const ids = [characterA.id, characterB.id].sort((a, b) => Number(a) - Number(b));
    const existing = relationships.find((item) => {
      const existingIds = [item.character_a_id, item.character_b_id].sort((a, b) => Number(a) - Number(b));
      return existingIds[0] === ids[0] && existingIds[1] === ids[1];
    }) || null;
    const payload = {
      project_id: projectId,
      character_a_id: characterA.id,
      character_b_id: characterB.id,
      relation_type: clean(relationship.relation || relationship.relationship || 'connected', 120),
      description: clean(relationship.change || relationship.description || relationship.summary),
      notes: relationship.evidence?.join('\n') || '',
      source_kind: 'lab_lite_canon_pack',
      created_at: existing?.created_at || now(),
      updated_at: now(),
    };

    actions.push(actionRecord({
      type: 'relationship',
      source: relationship,
      action: existing ? 'update' : 'create',
      reason: existing ? 'Cập nhật quan hệ đã có từ Relationship Canon.' : 'Tạo quan hệ mới từ Relationship Canon.',
      existing,
      payload,
    }));
  }

  return actions;
}

async function planChapterMeta(projectId, pack) {
  if (!db.chapters || !db.chapterMeta) return [];
  const chapters = await db.chapters.where('project_id').equals(projectId).toArray();
  const existingMetas = await db.chapterMeta.where('project_id').equals(projectId).toArray();
  const chapterByNumber = new Map(chapters.map((chapter) => [
    Number(chapter.order_index || 0) + 1,
    chapter,
  ]));

  const actions = [];
  for (const chapterCanon of pack.chapterCanon || []) {
    const chapterIndex = Number(chapterCanon.chapterIndex || 0);
    const chapter = chapterByNumber.get(chapterIndex);
    if (!chapter) continue;
    const existing = existingMetas.find((meta) => meta.chapter_id === chapter.id) || null;
    const payload = {
      project_id: projectId,
      chapter_id: chapter.id,
      summary: clean(chapterCanon.summary),
      lab_lite_chapter_canon: JSON.stringify(chapterCanon),
      key_events: chapterCanon.mainEvents || [],
      state_changes: chapterCanon.stateChanges || [],
      characters_present: chapterCanon.charactersAppearing || [],
      source_kind: 'lab_lite_canon_pack',
      updated_at: now(),
      created_at: existing?.created_at || now(),
    };
    actions.push(actionRecord({
      type: 'chapter_meta',
      source: chapterCanon,
      action: existing ? 'update' : 'create',
      reason: existing ? 'Cập nhật chapterMeta từ Chapter Canon đã duyệt.' : 'Tạo chapterMeta từ Chapter Canon đã duyệt.',
      existing,
      payload,
    }));
  }
  return actions;
}

async function planStyle(projectId, pack) {
  const observations = pack.styleCanon?.observations || [];
  if (observations.length === 0) return [];
  return [actionRecord({
    type: 'style_pack',
    source: pack.styleCanon,
    action: 'create',
    reason: 'Style Canon được lưu thành style pack để writer có thể tham chiếu.',
    payload: {
      project_id: projectId,
      name: `${pack.title || 'Canon Pack'} Style Canon`,
      type: 'lab_lite_style',
      source_kind: 'lab_lite_canon_pack',
      content: observations.join('\n'),
      created_at: now(),
    },
  })];
}

export async function buildMaterializationPlan({ canonPack, projectId }) {
  if (!canonPack || !projectId) {
    return { projectId, canonPackId: canonPack?.id || null, actions: [], summary: { create: 0, update: 0, skip: 0, needs_review: 0 } };
  }
  const actionGroups = await Promise.all([
    planCharacters(projectId, canonPack),
    planWorldItems(projectId, canonPack),
    planRelationships(projectId, canonPack),
    planCanonFacts(projectId, canonPack),
    planChapterMeta(projectId, canonPack),
    planStyle(projectId, canonPack),
  ]);
  const actions = actionGroups.flat();
  const summary = actions.reduce((acc, action) => {
    acc[action.action] = (acc[action.action] || 0) + 1;
    return acc;
  }, { create: 0, update: 0, skip: 0, needs_review: 0 });
  return {
    canonPackId: canonPack.id || null,
    projectId,
    status: 'draft',
    actions,
    summary,
  };
}

export async function applyMaterializationPlan(plan, { selectedActionIds = null } = {}) {
  const selected = Array.isArray(selectedActionIds) ? new Set(selectedActionIds) : null;
  const actions = (plan?.actions || [])
    .filter((action) => !selected || selected.has(action.id))
    .filter((action) => ['create', 'update'].includes(action.action));
  const applied = [];
  await db.transaction('rw', db.characters, db.locations, db.objects, db.worldTerms, db.factions, db.relationships, db.timelineEvents, db.canonFacts, db.stylePacks, db.chapterMeta, async () => {
    for (const action of actions) {
      if (action.type === 'character') {
        if (action.action === 'update' && action.existingId) await db.characters.update(action.existingId, action.payload);
        else applied.push(await db.characters.add(action.payload));
      } else if (action.type === 'location') {
        if (action.action === 'update' && action.existingId) await db.locations.update(action.existingId, action.payload);
        else applied.push(await db.locations.add(action.payload));
      } else if (action.type === 'object') {
        if (action.action === 'update' && action.existingId) await db.objects.update(action.existingId, action.payload);
        else applied.push(await db.objects.add(action.payload));
      } else if (action.type === 'world_term') {
        if (action.action === 'update' && action.existingId) await db.worldTerms.update(action.existingId, action.payload);
        else applied.push(await db.worldTerms.add(action.payload));
      } else if (action.type === 'faction') {
        if (action.action === 'update' && action.existingId) await db.factions.update(action.existingId, action.payload);
        else applied.push(await db.factions.add(action.payload));
      } else if (action.type === 'relationship') {
        if (action.action === 'update' && action.existingId) await db.relationships.update(action.existingId, action.payload);
        else applied.push(await db.relationships.add(action.payload));
      } else if (action.type === 'timeline') {
        applied.push(await db.timelineEvents.add(action.payload));
      } else if (action.type === 'canon_fact') {
        applied.push(await db.canonFacts.add(action.payload));
      } else if (action.type === 'style_pack') {
        applied.push(await db.stylePacks.add(action.payload));
      } else if (action.type === 'chapter_meta') {
        if (action.action === 'update' && action.existingId) await db.chapterMeta.update(action.existingId, action.payload);
        else applied.push(await db.chapterMeta.add(action.payload));
      }
    }
  });
  return { appliedCount: actions.length, applied };
}
