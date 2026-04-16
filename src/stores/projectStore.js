import { create } from 'zustand';
import db from '../services/db/database';
import { countWords } from '../utils/constants';
import { GENRE_TEMPLATES } from '../utils/genreTemplates';
import { buildProseBuffer } from '../utils/proseBuffer';
import { PROVIDERS, QUALITY_MODES } from '../services/ai/router';
import {
  canonicalizeChapter as canonicalizeChapterEngine,
  purgeChapterCanonState,
  rebuildCanonFromChapter as rebuildCanonFromChapterEngine,
} from '../services/canon/engine';
import useAIStore from './aiStore';
import useCodexStore from './codexStore';

function getNextOrderIndex(items) {
  return items.reduce((max, item) => {
    const order = Number.isFinite(item?.order_index) ? item.order_index : -1;
    return Math.max(max, order);
  }, -1) + 1;
}

function isEventLike(value) {
  return value
    && typeof value === 'object'
    && (typeof value.preventDefault === 'function' || typeof value.stopPropagation === 'function');
}

function getFirstSceneForChapter(scenes, chapterId) {
  return scenes.find((scene) => scene.chapter_id === chapterId) || null;
}

function resolveActiveSelection(chapters, scenes, requestedChapterId, requestedSceneId) {
  let activeScene = requestedSceneId != null
    ? scenes.find((scene) => scene.id === requestedSceneId) || null
    : null;
  let activeChapter = activeScene
    ? chapters.find((chapter) => chapter.id === activeScene.chapter_id) || null
    : null;

  if (!activeChapter && requestedChapterId != null) {
    activeChapter = chapters.find((chapter) => chapter.id === requestedChapterId) || null;
  }

  if (!activeScene && activeChapter) {
    activeScene = getFirstSceneForChapter(scenes, activeChapter.id);
  }

  if (!activeChapter && !activeScene) {
    for (const chapter of chapters) {
      const firstScene = getFirstSceneForChapter(scenes, chapter.id);
      if (firstScene) {
        activeChapter = chapter;
        activeScene = firstScene;
        break;
      }
    }
  }

  if (!activeChapter) {
    activeChapter = chapters[0] || null;
  }

  return {
    activeChapterId: activeChapter?.id || null,
    activeSceneId: activeScene?.id || null,
  };
}

async function syncChapterWordCounts(chapters, scenes) {
  const totals = new Map();

  for (const chapter of chapters) {
    totals.set(chapter.id, 0);
  }

  for (const scene of scenes) {
    const text = scene.draft_text || scene.final_text || '';
    const currentTotal = totals.get(scene.chapter_id) || 0;
    totals.set(scene.chapter_id, currentTotal + countWords(text));
  }

  const updates = [];
  const nextChapters = chapters.map((chapter) => {
    const actualWordCount = totals.get(chapter.id) || 0;
    if (chapter.actual_word_count === actualWordCount) {
      return chapter;
    }

    updates.push(db.chapters.update(chapter.id, { actual_word_count: actualWordCount }));
    return { ...chapter, actual_word_count: actualWordCount };
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return nextChapters;
}

async function reindexProjectChapters(projectId) {
  const chapters = await db.chapters.where('project_id').equals(projectId).sortBy('order_index');
  for (let index = 0; index < chapters.length; index++) {
    if (chapters[index].order_index !== index) {
      await db.chapters.update(chapters[index].id, { order_index: index });
    }
  }
}

async function reindexChapterScenes(chapterId) {
  const scenes = await db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index');
  for (let index = 0; index < scenes.length; index++) {
    if (scenes[index].order_index !== index) {
      await db.scenes.update(scenes[index].id, { order_index: index });
    }
  }
}

/**
 * Builds the initial prompt_templates JSON string from a genre key.
 * Extracts constitution, style_dna, anti_ai_blacklist from GENRE_TEMPLATES.
 * Merges with any existing prompt_templates passed in data (custom overrides win).
 *
 * @param {string} genreKey - e.g. 'tien_hiep', 'do_thi'
 * @param {string|object} [existingTemplates] - existing prompt_templates from data (optional)
 * @returns {string} - JSON string ready for DB storage
 */
function buildInitialPromptTemplates(genreKey, existingTemplates) {
  const template = GENRE_TEMPLATES[genreKey];

  // Start with genre DNA defaults (empty if genre not found)
  const genreDNA = template
    ? {
      constitution: template.constitution || [],
      style_dna: template.style_dna || [],
      anti_ai_blacklist: template.anti_ai_blacklist || [],
    }
    : {};

  // Parse any existing templates passed in (e.g. from AI Wizard or manual form)
  let existing = {};
  if (existingTemplates) {
    try {
      existing = typeof existingTemplates === 'string'
        ? JSON.parse(existingTemplates)
        : existingTemplates;
    } catch {
      existing = {};
    }
  }

  // Merge: existing custom overrides take priority over genre defaults
  const merged = { ...genreDNA, ...existing };

  return JSON.stringify(merged);
}

const CHAPTER_COMPLETION_ROUTE_OPTIONS = {
  providerOverride: PROVIDERS.GEMINI_PROXY,
  qualityOverride: QUALITY_MODES.FAST,
};

function sanitizeChapterText(scenes = []) {
  return scenes
    .map((scene) => scene.draft_text || '')
    .join('\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function yieldToUi() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

async function bulkAddWithIds(table, records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const keys = await table.bulkAdd(records, undefined, { allKeys: true });
  return records.map((record, index) => ({
    ...record,
    id: Array.isArray(keys) ? keys[index] : null,
  }));
}

async function persistChapterSummary({ projectId, chapterId, summary, chapterText }) {
  const existingMeta = await db.chapterMeta.where('chapter_id').equals(chapterId).first();
  const lastProseBuffer = buildProseBuffer(chapterText);

  if (existingMeta) {
    const updates = {
      updated_at: Date.now(),
    };
    if (summary?.trim()) updates.summary = summary.trim();
    if (lastProseBuffer) updates.last_prose_buffer = lastProseBuffer;
    if (Object.keys(updates).length > 1) {
      await db.chapterMeta.update(existingMeta.id, updates);
    }
    return;
  }

  await db.chapterMeta.add({
    chapter_id: chapterId,
    project_id: projectId,
    summary: summary?.trim() || '',
    last_prose_buffer: lastProseBuffer,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}

async function createExtractedCodexEntries({
  projectId,
  chapterId,
  extracted,
}) {
  if (!extracted || typeof extracted !== 'object') {
    return { createdCount: 0 };
  }

  const [existingCharacters, existingLocations, existingTerms, existingObjects] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.worldTerms.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
  ]);

  const normalizeName = (value) => String(value || '').trim().toLowerCase();
  const created = {
    characters: 0,
    locations: 0,
    terms: 0,
    objects: 0,
  };
  const createdEntries = {
    characters: [],
    locations: [],
    worldTerms: [],
    objects: [],
  };
  const now = Date.now();

  const characterNames = new Set(existingCharacters.map((item) => normalizeName(item.name)));
  const characterRecords = [];
  for (const character of extracted.characters || []) {
    const name = normalizeName(character?.name);
    if (!name || characterNames.has(name)) continue;
    characterNames.add(name);
    created.characters += 1;
    characterRecords.push({
      project_id: projectId,
      name: character.name || '',
      role: character.role || 'minor',
      appearance: character.appearance || '',
      personality: character.personality || '',
      flaws: character.flaws || '',
      personality_tags: character.personality_tags || '',
      source_chapter_id: chapterId,
      source_kind: 'chapter_extract',
      created_at: now,
    });
  }
  const locationNames = new Set(existingLocations.map((item) => normalizeName(item.name)));
  const locationRecords = [];
  for (const location of extracted.locations || []) {
    const name = normalizeName(location?.name);
    if (!name || locationNames.has(name)) continue;
    locationNames.add(name);
    created.locations += 1;
    locationRecords.push({
      project_id: projectId,
      name: location.name || '',
      description: location.description || '',
      details: location.details || '',
      source_chapter_id: chapterId,
      source_kind: 'chapter_extract',
      created_at: now,
    });
  }
  const termNames = new Set(existingTerms.map((item) => normalizeName(item.name)));
  const termRecords = [];
  for (const term of extracted.terms || []) {
    const name = normalizeName(term?.name);
    if (!name || termNames.has(name)) continue;
    termNames.add(name);
    created.terms += 1;
    termRecords.push({
      project_id: projectId,
      name: term.name || '',
      definition: term.definition || '',
      category: term.category || 'other',
      source_chapter_id: chapterId,
      source_kind: 'chapter_extract',
      created_at: now,
    });
  }
  const objectNames = new Set(existingObjects.map((item) => normalizeName(item.name)));
  const objectRecords = [];
  for (const objectItem of extracted.objects || []) {
    const name = normalizeName(objectItem?.name);
    if (!name || objectNames.has(name)) continue;
    objectNames.add(name);
    created.objects += 1;
    objectRecords.push({
      project_id: projectId,
      name: objectItem.name || '',
      description: objectItem.description || '',
      owner_character_id: null,
      source_chapter_id: chapterId,
      source_kind: 'chapter_extract',
      created_at: now,
    });
  }
  const [createdCharacters, createdLocations, createdTerms, createdObjects] = await Promise.all([
    bulkAddWithIds(db.characters, characterRecords),
    bulkAddWithIds(db.locations, locationRecords),
    bulkAddWithIds(db.worldTerms, termRecords),
    bulkAddWithIds(db.objects, objectRecords),
  ]);

  createdEntries.characters = createdCharacters;
  createdEntries.locations = createdLocations;
  createdEntries.worldTerms = createdTerms;
  createdEntries.objects = createdObjects;

  return {
    createdCount: Object.values(created).reduce((sum, value) => sum + value, 0),
    created,
    createdEntries,
  };
}

const useProjectStore = create((set, get) => ({
  projects: [],
  currentProject: null,
  chapters: [],
  scenes: [],
  activeChapterId: null,
  activeSceneId: null,
  loading: false,

  // Tracks chapters currently running auto-complete to prevent double-trigger
  completingChapterId: null,
  chapterCompletionById: {},

  loadProjects: async () => {
    const projects = await db.projects.orderBy('updated_at').reverse().toArray();
    set({ projects });
  },

  createProject: async (data) => {
    const now = Date.now();

    // Auto-load writing DNA from the selected genre template.
    // Merge constitution + style_dna + anti_ai_blacklist into prompt_templates.
    const genreKey = data.genre_primary || 'fantasy';
    const initialPromptTemplates = buildInitialPromptTemplates(
      genreKey,
      data.prompt_templates, // Merge caller-provided templates instead of overwriting.
    );

    const id = await db.projects.add({
      title: data.title || 'Truyen chua dat ten',
      description: data.description || '',
      genre_primary: data.genre_primary || 'fantasy',
      genre_secondary: data.genre_secondary || '',
      tone: data.tone || '',
      audience: data.audience || '',
      status: 'draft',
      writing_mode: 'balanced',
      default_style_pack_id: null,
      world_name: data.world_name || '',
      world_type: data.world_type || '',
      world_scale: data.world_scale || '',
      world_era: data.world_era || '',
      world_rules: data.world_rules || '[]',
      world_description: data.world_description || '',
      ai_guidelines: data.ai_guidelines || '',
      ai_strictness: data.ai_strictness || 'balanced',
      pov_mode: data.pov_mode || 'third_limited',
      synopsis: data.synopsis || '',
      story_structure: data.story_structure || '',
      pronoun_style: data.pronoun_style || '',
      target_length: data.target_length || 0,
      target_length_type: data.target_length_type || 'unset',
      ultimate_goal: data.ultimate_goal || '',
      milestones: data.milestones || '[]',
      prompt_templates: initialPromptTemplates, // Writing DNA is injected here at project creation.
      created_at: now,
      updated_at: now,
    });

    if (!data.skipFirstChapter) {
      const chapterId = await db.chapters.add({
        project_id: id,
        arc_id: null,
        order_index: 0,
        title: 'Chuong 1',
        summary: '',
        purpose: '',
        status: 'draft',
        word_count_target: 7000,
        actual_word_count: 0,
      });

      await db.scenes.add({
        project_id: id,
        chapter_id: chapterId,
        order_index: 0,
        title: 'Canh 1',
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
      });
    }

    await get().loadProjects();
    return id;
  },

  deleteProject: async (id) => {
    // First: get plotThread IDs for indirect threadBeats deletion
    const projectPlotThreads = await db.plotThreads.where('project_id').equals(id).toArray();
    const plotThreadIds = projectPlotThreads.map(pt => pt.id);

    await Promise.all([
      db.projects.delete(id),
      db.chapters.where('project_id').equals(id).delete(),
      db.scenes.where('project_id').equals(id).delete(),
      db.characters.where('project_id').equals(id).delete(),
      db.characterStates.where('project_id').equals(id).delete(),
      db.relationships.where('project_id').equals(id).delete(),
      db.locations.where('project_id').equals(id).delete(),
      db.objects.where('project_id').equals(id).delete(),
      db.canonFacts.where('project_id').equals(id).delete(),
      db.plotThreads.where('project_id').equals(id).delete(),
      db.timelineEvents.where('project_id').equals(id).delete(),
      db.stylePacks.where('project_id').equals(id).delete(),
      db.voicePacks.where('project_id').equals(id).delete(),
      db.aiJobs.where('project_id').equals(id).delete(),
      db.qaReports.where('project_id').equals(id).delete(),
      db.suggestions.where('project_id').equals(id).delete(),
      db.project_analysis_snapshots.where('project_id').equals(id).delete(),
      // Phase 3+: tables added in later versions
      db.worldTerms.where('project_id').equals(id).delete(),
      db.taboos.where('project_id').equals(id).delete(),
      db.chapterMeta.where('project_id').equals(id).delete(),
      db.entityTimeline.where('project_id').equals(id).delete(),
      db.factions.where('project_id').equals(id).delete(),
      db.macro_arcs.where('project_id').equals(id).delete(),
      db.arcs.where('project_id').equals(id).delete(),
      db.story_events.where('project_id').equals(id).delete(),
      db.entity_state_current.where('project_id').equals(id).delete(),
      db.plot_thread_state.where('project_id').equals(id).delete(),
      db.validator_reports.where('project_id').equals(id).delete(),
      db.memory_evidence.where('project_id').equals(id).delete(),
      db.chapter_revisions.where('project_id').equals(id).delete(),
      db.chapter_commits.where('project_id').equals(id).delete(),
      db.chapter_snapshots.where('project_id').equals(id).delete(),
      db.canon_purge_archives.where('project_id').equals(id).delete(),
      db.ai_chat_threads.where('project_id').equals(id).delete(),
      db.ai_chat_messages.where('project_id').equals(id).delete(),
      // threadBeats: no project_id index, delete via plotThread IDs
      ...(plotThreadIds.length > 0
        ? [db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).delete()]
        : []),
    ]);
    set({
      currentProject: null,
      chapters: [],
      scenes: [],
      activeChapterId: null,
      activeSceneId: null,
    });
    await get().loadProjects();
  },

  updateWorldProfile: async (data) => {
    const { currentProject } = get();
    if (!currentProject) return;
    await db.projects.update(currentProject.id, {
      world_name: data.world_name ?? currentProject.world_name,
      world_type: data.world_type ?? currentProject.world_type,
      world_scale: data.world_scale ?? currentProject.world_scale,
      world_era: data.world_era ?? currentProject.world_era,
      world_rules: data.world_rules ?? currentProject.world_rules,
      world_description: data.world_description ?? currentProject.world_description,
      updated_at: Date.now(),
    });
    const updated = await db.projects.get(currentProject.id);
    set({ currentProject: updated });
  },

  updateProjectSettings: async (data) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const updates = { ...data, updated_at: Date.now() };
    delete updates.id;
    delete updates.created_at;
    await db.projects.update(currentProject.id, updates);
    const updated = await db.projects.get(currentProject.id);
    set({ currentProject: updated });
  },

  loadProject: async (id, options = {}) => {
    set({ loading: true });
    const { currentProject, activeChapterId, activeSceneId } = get();
    const project = await db.projects.get(id);
    const chapters = await db.chapters.where('project_id').equals(id).sortBy('order_index');
    const scenes = await db.scenes.where('project_id').equals(id).sortBy('order_index');
    const syncedChapters = await syncChapterWordCounts(chapters, scenes);
    const shouldPreserveSelection = options.preserveSelection !== false && currentProject?.id === id;
    const requestedChapterId = options.activeChapterId ?? (shouldPreserveSelection ? activeChapterId : null);
    const requestedSceneId = options.activeSceneId ?? (shouldPreserveSelection ? activeSceneId : null);
    const selection = resolveActiveSelection(
      syncedChapters,
      scenes,
      requestedChapterId,
      requestedSceneId,
    );

    set({
      currentProject: project,
      chapters: syncedChapters,
      scenes,
      ...selection,
      loading: false,
    });
  },

  createChapter: async (projectId, title, chapterData = {}) => {
    if (isEventLike(projectId)) projectId = null;
    if (isEventLike(title)) title = '';

    const { currentProject, chapters } = get();
    const pid = projectId || currentProject?.id;
    if (!pid) return null;

    const existingChapters = projectId
      ? await db.chapters.where('project_id').equals(pid).sortBy('order_index')
      : chapters;
    const order = getNextOrderIndex(existingChapters);
    const {
      featured_characters = [],
      primary_location = '',
      thread_titles = [],
      key_events = [],
      required_factions = [],
      required_objects = [],
      required_terms = [],
      ...chapterCore
    } = chapterData || {};
    const chapterId = await db.chapters.add({
      project_id: pid,
      arc_id: chapterCore.arc_id ?? null,
      order_index: order,
      title: title || chapterData.title || `Chuong ${order + 1}`,
      summary: chapterCore.summary || '',
      purpose: chapterCore.purpose || '',
      status: chapterCore.status || 'draft',
      word_count_target: chapterCore.word_count_target ?? 3000,
      actual_word_count: chapterCore.actual_word_count ?? 0,
      featured_characters,
      primary_location,
      thread_titles,
      key_events,
      required_factions,
      required_objects,
      required_terms,
    });

    const sceneId = await db.scenes.add({
      project_id: pid,
      chapter_id: chapterId,
      order_index: 0,
      title: 'Canh 1',
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
    });

    if (currentProject?.id === pid) {
      await get().loadProject(pid, { activeChapterId: chapterId, activeSceneId: sceneId });
    }

    return { chapterId, sceneId };
  },

  updateChapter: async (id, data) => {
    const chapter = get().chapters.find((item) => item.id === id) || await db.chapters.get(id);
    if (!chapter) return;

    await db.chapters.update(id, data);
    const { currentProject } = get();
    if (currentProject?.id === chapter.project_id) {
      set((state) => ({
        chapters: state.chapters.map((item) => (
          item.id === id ? { ...item, ...data } : item
        )),
      }));
    }
  },

  deleteChapter: async (id) => {
    const chapter = get().chapters.find((item) => item.id === id) || await db.chapters.get(id);
    if (!chapter) return;

    await purgeChapterCanonState(chapter.project_id, id);
    await db.chapters.delete(id);
    await db.scenes.where('chapter_id').equals(id).delete();
    await db.chapterMeta.where('chapter_id').equals(id).delete();
    const relatedSuggestions = await db.suggestions.where('source_chapter_id').equals(id).toArray();
    if (relatedSuggestions.length > 0) {
      await db.suggestions.bulkDelete(relatedSuggestions.map((item) => item.id));
    }
    await reindexProjectChapters(chapter.project_id);
    await rebuildCanonFromChapterEngine(chapter.project_id);
    const { currentProject } = get();
    if (currentProject?.id === chapter.project_id) {
      await get().loadProject(currentProject.id);
      await useCodexStore.getState().loadCodex(currentProject.id);
    }
  },

  createScene: async (chapterId) => {
    const { currentProject, scenes } = get();
    if (!currentProject) return null;

    const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapterId);
    const order = getNextOrderIndex(chapterScenes);
    const sceneId = await db.scenes.add({
      project_id: currentProject.id,
      chapter_id: chapterId,
      order_index: order,
      title: `Canh ${order + 1}`,
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
    });

    await get().loadProject(currentProject.id, { activeChapterId: chapterId, activeSceneId: sceneId });
    return sceneId;
  },

  updateScene: async (id, data) => {
    const scene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!scene) return;

    await db.scenes.update(id, data);

    const { currentProject } = get();
    if (currentProject?.id === scene.project_id) {
      set((state) => ({
        scenes: state.scenes.map((item) => (item.id === id ? { ...item, ...data } : item)),
      }));
    }

    if ('draft_text' in data || 'final_text' in data) {
      await get().refreshChapterWordCount(scene.chapter_id);
    }
  },

  deleteScene: async (id) => {
    const scene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!scene) return;

    await db.scenes.delete(id);
    await reindexChapterScenes(scene.chapter_id);
    await get().refreshChapterWordCount(scene.chapter_id);
    const { currentProject } = get();
    if (currentProject?.id === scene.project_id) {
      await get().loadProject(currentProject.id);
    }
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),
  setActiveScene: (id) => set({ activeSceneId: id }),
  setCompletingChapterId: (id) => set({ completingChapterId: id }),
  setChapterCompletionState: (chapterId, payload = {}) => {
    if (!chapterId) return;
    set((state) => ({
      chapterCompletionById: {
        ...state.chapterCompletionById,
        [chapterId]: {
          ...(state.chapterCompletionById[chapterId] || {}),
          ...payload,
        },
      },
      completingChapterId: payload.running ? chapterId : (
        state.completingChapterId === chapterId ? null : state.completingChapterId
      ),
    }));
  },
  clearChapterCompletionState: (chapterId) => {
    if (!chapterId) return;
    set((state) => {
      const next = { ...state.chapterCompletionById };
      delete next[chapterId];
      return {
        chapterCompletionById: next,
        completingChapterId: state.completingChapterId === chapterId ? null : state.completingChapterId,
      };
    });
  },

  getActiveScene: () => {
    const { scenes, activeSceneId } = get();
    return scenes.find((scene) => scene.id === activeSceneId) || null;
  },

  refreshChapterWordCount: async (chapterId) => {
    if (!chapterId) return 0;

    const chapter = get().chapters.find((item) => item.id === chapterId) || await db.chapters.get(chapterId);
    if (!chapter) return 0;

    const chapterScenes = await db.scenes.where('chapter_id').equals(chapterId).toArray();
    const actualWordCount = chapterScenes.reduce((total, scene) => {
      return total + countWords(scene.draft_text || scene.final_text || '');
    }, 0);

    await db.chapters.update(chapterId, { actual_word_count: actualWordCount });

    const { currentProject } = get();
    if (currentProject?.id === chapter.project_id) {
      set((state) => ({
        chapters: state.chapters.map((item) => (
          item.id === chapterId ? { ...item, actual_word_count: actualWordCount } : item
        )),
      }));
    }

    return actualWordCount;
  },

  /**
   * Auto-complete a chapter: summarize + extract Codex entries + mark done.
   * Called automatically when chapter reaches 100% word target.
   * Non-blocking - errors are silently handled.
   */
  runChapterCompletion: async (chapterId, options = {}) => {
    const { currentProject, chapters, scenes } = get();
    if (!currentProject || !chapterId) return null;

    const chapter = chapters.find((item) => item.id === chapterId) || await db.chapters.get(chapterId);
    if (!chapter) return null;

    get().setChapterCompletionState(chapterId, {
      running: true,
      phase: 'prepare',
      progress: 5,
      message: 'Dang chuan bi hoan thanh chuong...',
      error: '',
      result: null,
      mode: options.mode || 'manual',
    });

    try {
      const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapterId);
      const chapterText = sanitizeChapterText(chapterScenes);
      if (!chapterText) {
        const emptyResult = {
          ok: false,
          kind: 'empty',
          message: 'Chuong chua co noi dung de hoan thanh.',
        };
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'idle',
          progress: 0,
          message: emptyResult.message,
          error: emptyResult.message,
          result: emptyResult,
        });
        return emptyResult;
      }

      const context = {
        sceneText: chapterText,
        chapterTitle: chapter.title,
        projectTitle: currentProject.title,
        genre: currentProject.genre_primary || '',
        projectId: currentProject.id,
        promptTemplates: parsePromptTemplates(currentProject.prompt_templates),
        nsfwMode: !!currentProject.nsfw_mode,
        superNsfwMode: !!currentProject.super_nsfw_mode,
        allowConcurrent: true,
        routeOptions: CHAPTER_COMPLETION_ROUTE_OPTIONS,
      };

      let summary = '';
      let extracted = null;
      let extractionStats = {
        createdCount: 0,
        created: {},
        createdEntries: {},
      };
      let canonResult = null;
      let canonProcessed = false;
      let canonSucceeded = false;
      let canonRuntimeError = '';
      const { summarizeChapter, extractFromChapter } = useAIStore.getState();

      get().setChapterCompletionState(chapterId, {
        phase: 'summarize_extract',
        progress: 20,
        message: 'Dang tom tat va trich xuat du lieu codex...',
      });
      await yieldToUi();
      const [summaryResult, extractResult] = await Promise.allSettled([
        summarizeChapter(context),
        extractFromChapter(context),
      ]);

      if (summaryResult.status === 'fulfilled') {
        summary = summaryResult.value || '';
        try {
          await persistChapterSummary({
            projectId: currentProject.id,
            chapterId,
            summary,
            chapterText,
          });
        } catch (error) {
          console.warn('[ChapterCompletion] Persist summary failed (non-fatal):', error);
        }
      } else {
        console.warn('[ChapterCompletion] Summarize failed (non-fatal):', summaryResult.reason);
      }

      if (extractResult.status === 'fulfilled') {
        extracted = extractResult.value || null;
        try {
          extractionStats = await createExtractedCodexEntries({
            projectId: currentProject.id,
            chapterId,
            extracted,
          });
        } catch (error) {
          console.warn('[ChapterCompletion] Persist extraction failed (non-fatal):', error);
        }
      } else {
        console.warn('[ChapterCompletion] Extraction failed (non-fatal):', extractResult.reason);
      }

      get().setChapterCompletionState(chapterId, {
        phase: 'canon',
        progress: 72,
        message: 'Dang phan tich su that va canon hoa...',
      });
      await yieldToUi();
      try {
        canonResult = await canonicalizeChapterEngine(currentProject.id, chapterId, {
          routeOptions: CHAPTER_COMPLETION_ROUTE_OPTIONS,
        });
        canonProcessed = true;
        canonSucceeded = canonResult?.ok !== false;
      } catch (error) {
        console.warn('[ChapterCompletion] Canonicalize failed:', error);
        canonRuntimeError = error?.message || '';
        canonResult = {
          ok: false,
          runtime_error: canonRuntimeError,
        };
      }

      get().setChapterCompletionState(chapterId, {
        phase: 'finalize',
        progress: 90,
        message: 'Dang dong bo du lieu chuong...',
      });
      if (canonSucceeded) {
        await get().updateChapter(chapterId, { status: 'done' });
      } else {
        await get().updateChapter(chapterId, { status: 'draft' });
      }
      await useCodexStore.getState().applyCompletionDelta({
        projectId: currentProject.id,
        chapterId,
        createdEntries: extractionStats.createdEntries || {},
        refreshProjection: canonSucceeded,
      });
      await yieldToUi();

      const result = {
        ok: canonSucceeded,
        kind: canonProcessed
          ? (canonSucceeded ? 'success' : 'blocked')
          : 'runtime',
        message: canonSucceeded
          ? 'Da hoan thanh chuong.'
          : canonProcessed
            ? 'Phan tich su that phat hien mau thuan, chuong chua duoc danh dau hoan thanh.'
            : (canonRuntimeError
              ? `Khong the hoan thanh chuong vi loi canon hoa: ${canonRuntimeError}`
              : 'Khong the hoan thanh chuong vi loi runtime khi canon hoa.'),
        summary,
        extracted,
        extractionStats,
        canonResult,
      };

      get().setChapterCompletionState(chapterId, {
        running: false,
        phase: result.ok ? 'done' : 'error',
        progress: result.ok ? 100 : 0,
        message: result.message,
        error: result.ok ? '' : result.message,
        result,
      });
      return result;
    } catch (error) {
      const message = error?.message || 'Khong the hoan thanh chuong.';
      const result = {
        ok: false,
        kind: 'runtime',
        message,
      };
      get().setChapterCompletionState(chapterId, {
        running: false,
        phase: 'error',
        progress: 0,
        message,
        error: message,
        result,
      });
      throw error;
    }
  },

  autoCompleteChapter: async (chapterId) => {
    try {
      return await get().runChapterCompletion(chapterId, { mode: 'auto' });
    } catch (error) {
      console.warn('[AutoComplete] Failed:', error);
      return null;
    }
  },

  updateProjectTimestamp: async () => {
    const { currentProject } = get();
    if (currentProject) {
      await db.projects.update(currentProject.id, { updated_at: Date.now() });
    }
  },
}));

export default useProjectStore;
