import db from '../db/database.js';
import { normalizeEntityIdentity } from '../entityIdentity/index.js';
import { normalizeCanonFactRecord } from '../entityIdentity/factIdentity.js';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates.js';

const DEFAULT_INCLUDE = {
  settings: true,
  worldProfile: true,
  characters: true,
  locations: true,
  objects: true,
  worldTerms: true,
  factions: true,
  relationships: true,
  taboos: true,
  canonFacts: false,
};

const SETTINGS_FIELDS = [
  'genre_primary',
  'genre_secondary',
  'tone',
  'audience',
  'writing_mode',
  'ai_guidelines',
  'ai_strictness',
  'pov_mode',
  'pronoun_style',
  'story_structure',
  'nsfw_mode',
  'super_nsfw_mode',
  'prompt_templates',
];

const WORLD_FIELDS = [
  'world_name',
  'world_type',
  'world_scale',
  'world_era',
  'world_rules',
  'world_description',
];

function cleanText(value) {
  return String(value || '').trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickFields(source = {}, fields = []) {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function resolveInclude(include = {}) {
  const resolved = {
    ...DEFAULT_INCLUDE,
    ...(include || {}),
  };

  if (!resolved.characters) {
    resolved.relationships = false;
    resolved.taboos = false;
  }

  return resolved;
}

function parsePromptTemplates(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object') return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildInitialPromptTemplates(genreKey, existingTemplates) {
  const template = GENRE_TEMPLATES[genreKey] || {};
  const genreDNA = {
    constitution: template.constitution || [],
    style_dna: template.style_dna || [],
    anti_ai_blacklist: template.anti_ai_blacklist || [],
  };
  return JSON.stringify({
    ...genreDNA,
    ...parsePromptTemplates(existingTemplates),
  });
}

function clampInitialChapterCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function withoutIdentity(row = {}) {
  const {
    id: _oldId,
    project_id: _oldProjectId,
    canon_state: _canonState,
    canon_status_summary: _canonStatusSummary,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...rest
  } = row;
  return rest;
}

function withEntityIdentity(kind, payload) {
  const identity = normalizeEntityIdentity(kind, payload);
  return {
    ...payload,
    normalized_name: identity.normalized_name,
    alias_keys: identity.alias_keys,
    identity_key: identity.identity_key,
  };
}

function buildEntityPayload(kind, row, projectId, now, extra = {}) {
  const payload = withoutIdentity(row);
  return withEntityIdentity(kind, {
    ...payload,
    ...extra,
    project_id: projectId,
    source_chapter_id: null,
    source_kind: 'bible_template_transfer',
    created_at: now,
    updated_at: now,
  });
}

async function createInitialChapters(projectId, count, now) {
  for (let index = 0; index < count; index += 1) {
    const chapterId = await db.chapters.add({
      project_id: projectId,
      arc_id: null,
      order_index: index,
      title: `Chương ${index + 1}`,
      summary: '',
      purpose: '',
      status: 'draft',
      word_count_target: 3000,
      actual_word_count: 0,
      created_at: now,
      updated_at: now,
    });

    await db.scenes.add({
      project_id: projectId,
      chapter_id: chapterId,
      order_index: 0,
      title: 'Cảnh 1',
      summary: '',
      pov_character_id: null,
      location_id: null,
      time_marker: '',
      goal: '',
      conflict: '',
      emotional_start: '',
      emotional_end: '',
      status: 'draft',
      draft_text: '',
      final_text: '',
      must_happen: '[]',
      must_not_happen: '[]',
      pacing: '',
      characters_present: '[]',
      created_at: now,
      updated_at: now,
    });
  }
}

function buildProjectRecord(sourceProject, projectData, include, now) {
  const sourceSettings = include.settings ? pickFields(sourceProject, SETTINGS_FIELDS) : {};
  const sourceWorld = include.worldProfile ? pickFields(sourceProject, WORLD_FIELDS) : {};
  const genrePrimary = projectData.genre_primary || sourceSettings.genre_primary || 'fantasy';
  const promptTemplates = buildInitialPromptTemplates(
    genrePrimary,
    projectData.prompt_templates ?? sourceSettings.prompt_templates,
  );

  return {
    title: cleanText(projectData.title) || `${cleanText(sourceProject.title) || 'Truyện'} - Truyện mới`,
    description: projectData.description || '',
    genre_primary: genrePrimary,
    genre_secondary: projectData.genre_secondary ?? sourceSettings.genre_secondary ?? '',
    tone: projectData.tone ?? sourceSettings.tone ?? '',
    audience: projectData.audience ?? sourceSettings.audience ?? '',
    status: 'draft',
    writing_mode: sourceSettings.writing_mode || 'balanced',
    default_style_pack_id: null,
    world_name: projectData.world_name ?? sourceWorld.world_name ?? '',
    world_type: projectData.world_type ?? sourceWorld.world_type ?? '',
    world_scale: projectData.world_scale ?? sourceWorld.world_scale ?? '',
    world_era: projectData.world_era ?? sourceWorld.world_era ?? '',
    world_rules: projectData.world_rules ?? sourceWorld.world_rules ?? '[]',
    world_description: projectData.world_description ?? sourceWorld.world_description ?? '',
    ai_guidelines: projectData.ai_guidelines ?? sourceSettings.ai_guidelines ?? '',
    ai_strictness: projectData.ai_strictness ?? sourceSettings.ai_strictness ?? 'balanced',
    pov_mode: projectData.pov_mode ?? sourceSettings.pov_mode ?? 'third_limited',
    synopsis: projectData.synopsis || '',
    story_structure: projectData.story_structure ?? sourceSettings.story_structure ?? '',
    pronoun_style: projectData.pronoun_style ?? sourceSettings.pronoun_style ?? '',
    target_length: Number(projectData.target_length || 0),
    target_length_type: projectData.target_length_type || 'unset',
    ultimate_goal: projectData.ultimate_goal || '',
    milestones: projectData.milestones || '[]',
    nsfw_mode: Boolean(projectData.nsfw_mode ?? sourceSettings.nsfw_mode ?? false),
    super_nsfw_mode: Boolean(projectData.super_nsfw_mode ?? sourceSettings.super_nsfw_mode ?? false),
    project_mode: 'original',
    source_canon_pack_id: '',
    fanfic_setup: '',
    canon_adherence_level: '',
    divergence_point: '',
    prompt_templates: promptTemplates,
    created_at: now,
    updated_at: now,
  };
}

async function copyCharacters(projectId, sourceProjectId, now) {
  const idMap = new Map();
  const rows = await db.characters.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const payload = buildEntityPayload('character', row, projectId, now);
    const newId = await db.characters.add(payload);
    idMap.set(row.id, newId);
  }
  return { idMap, count: idMap.size };
}

async function copyLocations(projectId, sourceProjectId, now) {
  const idMap = new Map();
  const rows = await db.locations.where('project_id').equals(sourceProjectId).toArray();
  const pendingParents = [];
  for (const row of rows) {
    const payload = buildEntityPayload('location', row, projectId, now, {
      parent_location_id: null,
    });
    const newId = await db.locations.add(payload);
    idMap.set(row.id, newId);
    if (row.parent_location_id) {
      pendingParents.push({ newId, oldParentId: row.parent_location_id });
    }
  }
  for (const item of pendingParents) {
    await db.locations.update(item.newId, {
      parent_location_id: idMap.get(item.oldParentId) || null,
    });
  }
  return { idMap, count: idMap.size };
}

async function copyWorldTerms(projectId, sourceProjectId, now) {
  const idMap = new Map();
  const rows = await db.worldTerms.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const payload = buildEntityPayload('world_term', row, projectId, now);
    const newId = await db.worldTerms.add(payload);
    idMap.set(row.id, newId);
  }
  return { idMap, count: idMap.size };
}

async function copyFactions(projectId, sourceProjectId, now) {
  const idMap = new Map();
  const rows = await db.factions.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const payload = {
      ...withoutIdentity(row),
      project_id: projectId,
      source_chapter_id: null,
      source_kind: 'bible_template_transfer',
      created_at: now,
      updated_at: now,
    };
    const newId = await db.factions.add(payload);
    idMap.set(row.id, newId);
  }
  return { idMap, count: idMap.size };
}

async function copyObjects(projectId, sourceProjectId, now, maps) {
  const idMap = new Map();
  const rows = await db.objects.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const payload = buildEntityPayload('object', row, projectId, now, {
      owner_character_id: maps.characters.get(row.owner_character_id) || null,
      current_location_id: maps.locations.get(row.current_location_id) || null,
    });
    const newId = await db.objects.add(payload);
    idMap.set(row.id, newId);
  }
  return { idMap, count: idMap.size };
}

async function copyRelationships(projectId, sourceProjectId, now, characterIdMap) {
  let count = 0;
  const rows = await db.relationships.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const characterAId = characterIdMap.get(row.character_a_id);
    const characterBId = characterIdMap.get(row.character_b_id);
    if (!characterAId || !characterBId) continue;
    const payload = {
      ...withoutIdentity(row),
      project_id: projectId,
      character_a_id: characterAId,
      character_b_id: characterBId,
      start_scene_id: null,
      end_scene_id: null,
      source_scene_id: null,
      created_at: now,
      updated_at: now,
    };
    delete payload.pair_key;
    await db.relationships.add(payload);
    count += 1;
  }
  return count;
}

async function copyTaboos(projectId, sourceProjectId, now, characterIdMap) {
  let count = 0;
  const rows = await db.taboos.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const hasCharacter = row.character_id != null && row.character_id !== '';
    const mappedCharacterId = hasCharacter ? characterIdMap.get(row.character_id) : null;
    if (hasCharacter && !mappedCharacterId) continue;
    await db.taboos.add({
      ...withoutIdentity(row),
      project_id: projectId,
      character_id: mappedCharacterId || null,
      created_at: now,
      updated_at: now,
    });
    count += 1;
  }
  return count;
}

function remapCanonFactSubject(fact, maps) {
  const subjectType = cleanText(fact.subject_type || '');
  const subjectId = fact.subject_id;
  if (subjectId == null || !subjectType) {
    return { keep: true, subject_id: subjectId ?? null };
  }

  const mapByType = {
    character: maps.characters,
    location: maps.locations,
    object: maps.objects,
    world_term: maps.worldTerms,
    term: maps.worldTerms,
    faction: maps.factions,
  };
  const idMap = mapByType[subjectType];
  if (!idMap) return { keep: true, subject_id: subjectId };

  const mappedId = idMap.get(subjectId);
  return mappedId
    ? { keep: true, subject_id: mappedId }
    : { keep: false, subject_id: null };
}

async function copyCanonFacts(projectId, sourceProjectId, now, maps) {
  let count = 0;
  const rows = await db.canonFacts.where('project_id').equals(sourceProjectId).toArray();
  for (const row of rows) {
    const remappedSubject = remapCanonFactSubject(row, maps);
    if (!remappedSubject.keep) continue;
    const payload = {
      ...withoutIdentity(row),
      project_id: projectId,
      subject_id: remappedSubject.subject_id,
      source_chapter_id: null,
      source_scene_id: null,
      source_revision_id: null,
      valid_from_scene_id: null,
      valid_to_scene_id: null,
      source_event_id: '',
      source_corpus_id: null,
      source_link_id: null,
      source_kind: 'bible_template_transfer',
      created_at: now,
      updated_at: now,
    };
    delete payload.fact_fingerprint;
    delete payload.subject_scope;
    delete payload.normalized_description;
    await db.canonFacts.add({
      ...payload,
      ...normalizeCanonFactRecord(payload),
    });
    count += 1;
  }
  return count;
}

export async function createProjectFromBibleTemplate({
  sourceProjectId,
  projectData = {},
  include = {},
  initialChapterCount = 1,
} = {}) {
  const normalizedSourceProjectId = Number(sourceProjectId);
  if (!Number.isFinite(normalizedSourceProjectId) || normalizedSourceProjectId <= 0) {
    throw new Error('Dự án nguồn không hợp lệ.');
  }

  const sourceProject = await db.projects.get(normalizedSourceProjectId);
  if (!sourceProject) {
    throw new Error('Không tìm thấy dự án nguồn.');
  }

  const resolvedInclude = resolveInclude(include);
  const chapterCount = clampInitialChapterCount(initialChapterCount);
  const now = Date.now();
  const stats = {
    characters: 0,
    locations: 0,
    objects: 0,
    worldTerms: 0,
    factions: 0,
    relationships: 0,
    taboos: 0,
    canonFacts: 0,
    chapters: chapterCount,
  };
  const maps = {
    characters: new Map(),
    locations: new Map(),
    objects: new Map(),
    worldTerms: new Map(),
    factions: new Map(),
  };

  let projectId = null;

  await db.transaction(
    'rw',
    db.projects,
    db.chapters,
    db.scenes,
    db.characters,
    db.locations,
    db.objects,
    db.worldTerms,
    db.factions,
    db.relationships,
    db.taboos,
    db.canonFacts,
    async () => {
      projectId = await db.projects.add(buildProjectRecord(sourceProject, projectData, resolvedInclude, now));
      await createInitialChapters(projectId, chapterCount, now);

      if (resolvedInclude.characters) {
        const result = await copyCharacters(projectId, normalizedSourceProjectId, now);
        maps.characters = result.idMap;
        stats.characters = result.count;
      }

      if (resolvedInclude.locations) {
        const result = await copyLocations(projectId, normalizedSourceProjectId, now);
        maps.locations = result.idMap;
        stats.locations = result.count;
      }

      if (resolvedInclude.worldTerms) {
        const result = await copyWorldTerms(projectId, normalizedSourceProjectId, now);
        maps.worldTerms = result.idMap;
        stats.worldTerms = result.count;
      }

      if (resolvedInclude.factions) {
        const result = await copyFactions(projectId, normalizedSourceProjectId, now);
        maps.factions = result.idMap;
        stats.factions = result.count;
      }

      if (resolvedInclude.objects) {
        const result = await copyObjects(projectId, normalizedSourceProjectId, now, maps);
        maps.objects = result.idMap;
        stats.objects = result.count;
      }

      if (resolvedInclude.relationships) {
        stats.relationships = await copyRelationships(projectId, normalizedSourceProjectId, now, maps.characters);
      }

      if (resolvedInclude.taboos) {
        stats.taboos = await copyTaboos(projectId, normalizedSourceProjectId, now, maps.characters);
      }

      if (resolvedInclude.canonFacts) {
        stats.canonFacts = await copyCanonFacts(projectId, normalizedSourceProjectId, now, maps);
      }
    },
  );

  return {
    projectId,
    sourceProjectId: normalizedSourceProjectId,
    include: cloneJson(resolvedInclude),
    stats,
  };
}

export async function getBibleTemplateSourceSummary(sourceProjectId) {
  const normalizedSourceProjectId = Number(sourceProjectId);
  if (!Number.isFinite(normalizedSourceProjectId) || normalizedSourceProjectId <= 0) {
    return null;
  }

  const [
    project,
    characters,
    locations,
    objects,
    worldTerms,
    factions,
    relationships,
    taboos,
    canonFacts,
  ] = await Promise.all([
    db.projects.get(normalizedSourceProjectId),
    db.characters.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.locations.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.objects.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.worldTerms.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.factions.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.relationships.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.taboos.where('project_id').equals(normalizedSourceProjectId).toArray(),
    db.canonFacts.where('project_id').equals(normalizedSourceProjectId).toArray(),
  ]);

  if (!project) return null;

  const worldRules = (() => {
    try {
      const parsed = JSON.parse(project.world_rules || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const hasWorldProfile = WORLD_FIELDS
    .filter((field) => field !== 'world_rules')
    .some((field) => cleanText(project[field]))
    || worldRules.length > 0;

  return {
    project,
    counts: {
      settings: 1,
      worldProfile: hasWorldProfile ? 1 : 0,
      characters: characters.length,
      locations: locations.length,
      objects: objects.length,
      worldTerms: worldTerms.length,
      factions: factions.length,
      relationships: relationships.length,
      taboos: taboos.length,
      canonFacts: canonFacts.length,
    },
  };
}

export default {
  createProjectFromBibleTemplate,
  getBibleTemplateSourceSummary,
};
