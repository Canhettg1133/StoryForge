import { create } from 'zustand';
import db from '../services/db/database';
import { countWords } from '../utils/constants';
import { GENRE_TEMPLATES } from '../utils/genreTemplates';
import { buildProseBuffer } from '../utils/proseBuffer';
import {
  resolveAndMaterializeEntityCandidates,
  stageExtractedEntityCandidates,
} from '../services/entityIdentity/index.js';
import {
  canonicalizeChapter as canonicalizeChapterEngine,
} from '../services/canon/workflow';
import {
  purgeChapterCanonState,
  rebuildCanonFromChapter as rebuildCanonFromChapterEngine,
} from '../services/canon/projection';
import { getChapterCanonState } from '../services/canon/queries';
import { CHAPTER_COMMIT_STATUS } from '../services/canon/constants';
import { isRevisionFreshForCanonText } from '../services/canon/utils';
import { deleteProjectCascade } from '../services/db/projectDataService.js';
import {
  normalizePromptProfileVersion,
  PROMPT_PROFILE_VERSIONS,
} from '../services/ai/promptProfiles.js';
import { toVietnameseErrorMessage } from '../utils/errorMessages';
import { enqueueSceneMirror } from '../services/storyMirror/outbox.js';
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

function resolveSelectionAfterChapterDeletion(chapters, scenes, deletedChapterId) {
  const deletedIndex = chapters.findIndex((chapter) => chapter.id === deletedChapterId);
  const remainingChapters = chapters.filter((chapter) => chapter.id !== deletedChapterId);

  if (remainingChapters.length === 0) {
    return {
      activeChapterId: null,
      activeSceneId: null,
    };
  }

  const fallbackChapter = chapters[deletedIndex + 1]?.id !== deletedChapterId
    ? chapters[deletedIndex + 1]
    : chapters[deletedIndex - 1];
  const targetChapter = fallbackChapter && fallbackChapter.id !== deletedChapterId
    ? fallbackChapter
    : remainingChapters[Math.min(deletedIndex, remainingChapters.length - 1)];
  const targetScene = getFirstSceneForChapter(scenes, targetChapter?.id);

  return {
    activeChapterId: targetChapter?.id || null,
    activeSceneId: targetScene?.id || null,
  };
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

async function syncChapterWordCounts(chapters, scenes, options = {}) {
  const { persist = true, awaitPersist = false } = options;
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

  if (persist && updates.length > 0) {
    const persistPromise = Promise.allSettled(updates).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        console.warn('[ProjectStore] Failed to persist some chapter word counts:', failures.map((item) => item.reason));
      }
    });

    if (awaitPersist) {
      await persistPromise;
    }
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

const CHAPTER_COMPLETION_ROUTE_OPTIONS = {};

const COMPLETION_SUCCESS_CANON_STATUSES = new Set([
  CHAPTER_COMMIT_STATUS.CANONICAL,
  CHAPTER_COMMIT_STATUS.HAS_WARNINGS,
]);

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

async function touchProjectUpdatedAt(projectId, setState) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) {
    return 0;
  }

  const nextUpdatedAt = Date.now();
  await db.projects.update(normalizedProjectId, {
    updated_at: nextUpdatedAt,
    cloud_pending_local_fork_until_change: 0,
  });

  if (typeof setState === 'function') {
    setState((state) => {
      if (state.currentProject?.id !== normalizedProjectId) {
        return {};
      }

      return {
        currentProject: {
          ...state.currentProject,
          updated_at: nextUpdatedAt,
          cloud_pending_local_fork_until_change: 0,
        },
      };
    });
  }

  return nextUpdatedAt;
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

function buildCompletionSessionKey(projectId, chapterId) {
  return `complete:${projectId}:${chapterId}:${Date.now()}`;
}

async function loadCompletionChapterText(chapterId) {
  let chapterScenes = [];
  try {
    chapterScenes = await db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index');
  } catch (error) {
    console.warn('[ChapterCompletion] Indexed scene load failed, falling back to raw scan:', error);
    const allScenes = await db.scenes.toArray();
    chapterScenes = allScenes
      .filter((scene) => scene.chapter_id === chapterId)
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left?.order_index) ? left.order_index : 0;
        const rightOrder = Number.isFinite(right?.order_index) ? right.order_index : 0;
        return leftOrder - rightOrder;
      });
  }

  return {
    chapterScenes,
    chapterText: sanitizeChapterText(chapterScenes),
  };
}

function buildChapterCompletionResult(kind, message, extra = {}) {
  return {
    ok: false,
    kind,
    message,
    ...extra,
  };
}

let latestProjectLoadRequestId = 0;

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
    let projects = [];
    try {
      projects = await db.projects.orderBy('updated_at').reverse().toArray();
    } catch (error) {
      console.warn('[ProjectStore] Indexed loadProjects failed, falling back to raw table scan:', error);
    }

    if (!Array.isArray(projects) || projects.length === 0) {
      const rawProjects = await db.projects.toArray();
      projects = [...rawProjects].sort((left, right) => {
        const updatedDiff = Number(right?.updated_at || 0) - Number(left?.updated_at || 0);
        if (updatedDiff !== 0) return updatedDiff;
        return Number(right?.id || 0) - Number(left?.id || 0);
      });
    }

    set({ projects });
    return projects;
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
    const promptProfileVersion = normalizePromptProfileVersion(
      data.prompt_profile_version,
      PROMPT_PROFILE_VERSIONS.TAG_FIRST_V2,
    );

    const id = await db.projects.add({
      title: data.title || 'Truyện chưa đặt tên',
      description: data.description || '',
      genre_primary: data.genre_primary || 'fantasy',
      genre_secondary: data.genre_secondary || '',
      tone: data.tone || '',
      project_tags: data.project_tags || '',
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
      nsfw_mode: !!data.nsfw_mode,
      super_nsfw_mode: !!data.super_nsfw_mode,
      project_mode: data.project_mode || 'original',
      source_canon_pack_id: data.source_canon_pack_id || '',
      fanfic_setup: data.fanfic_setup || '',
      canon_adherence_level: data.canon_adherence_level || '',
      divergence_point: data.divergence_point || '',
      prompt_profile_version: promptProfileVersion,
      prompt_templates: initialPromptTemplates, // Writing DNA is injected here at project creation.
      created_at: now,
      updated_at: now,
    });

    if (!data.skipFirstChapter) {
      const chapterId = await db.chapters.add({
        project_id: id,
        arc_id: null,
        order_index: 0,
        title: 'Chương 1',
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
      });
    }

    await get().loadProjects();
    return id;
  },

  deleteProject: async (id) => {
    await deleteProjectCascade(id);
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
    const requestId = ++latestProjectLoadRequestId;
    set({ loading: true });
    try {
      const numericId = Number(id);
      const { currentProject, activeChapterId, activeSceneId } = get();
      const project = await db.projects.get(numericId);
      if (!project) {
        if (requestId === latestProjectLoadRequestId) {
          set({
            currentProject: null,
            chapters: [],
            scenes: [],
            activeChapterId: null,
            activeSceneId: null,
          });
        }
        return null;
      }

      let chapters = [];
      let scenes = [];

      try {
        chapters = await db.chapters.where('project_id').equals(numericId).sortBy('order_index');
      } catch (error) {
        console.warn('[ProjectStore] Indexed chapter load failed, falling back to raw scan:', error);
        chapters = (await db.chapters.toArray())
          .filter((chapter) => Number(chapter?.project_id) === numericId)
          .sort((left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0));
      }

      try {
        scenes = await db.scenes.where('project_id').equals(numericId).sortBy('order_index');
      } catch (error) {
        console.warn('[ProjectStore] Indexed scene load failed, falling back to raw scan:', error);
        scenes = (await db.scenes.toArray())
          .filter((scene) => Number(scene?.project_id) === numericId)
          .sort((left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0));
      }

      const syncedChapters = await syncChapterWordCounts(chapters, scenes, {
        persist: true,
        awaitPersist: false,
      });
      const shouldPreserveSelection = options.preserveSelection !== false && currentProject?.id === numericId;
      const requestedChapterId = options.activeChapterId ?? (shouldPreserveSelection ? activeChapterId : null);
      const requestedSceneId = options.activeSceneId ?? (shouldPreserveSelection ? activeSceneId : null);
      const selection = resolveActiveSelection(
        syncedChapters,
        scenes,
        requestedChapterId,
        requestedSceneId,
      );

      if (requestId === latestProjectLoadRequestId) {
        set({
          currentProject: project,
          chapters: syncedChapters,
          scenes,
          ...selection,
        });
      }
      return project;
    } catch (error) {
      console.error('[ProjectStore] loadProject failed:', error);
      if (requestId === latestProjectLoadRequestId) {
        set({
          currentProject: null,
          chapters: [],
          scenes: [],
          activeChapterId: null,
          activeSceneId: null,
        });
      }
      throw error;
    } finally {
      if (requestId === latestProjectLoadRequestId) {
        set({ loading: false });
      }
    }
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
      opening_state = '',
      handoff_from_previous = '',
      ending_state = '',
      state_delta = '',
      ...chapterCore
    } = chapterData || {};
    const chapterId = await db.chapters.add({
      project_id: pid,
      arc_id: chapterCore.arc_id ?? null,
      order_index: order,
      title: title || chapterData.title || `Chương ${order + 1}`,
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
      opening_state,
      handoff_from_previous,
      ending_state,
      state_delta,
    });

    const sceneId = await db.scenes.add({
      project_id: pid,
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
    });

    await touchProjectUpdatedAt(pid, set);

    if (currentProject?.id === pid) {
      await get().loadProject(pid, { activeChapterId: chapterId, activeSceneId: sceneId });
    }

    return { chapterId, sceneId };
  },

  updateChapter: async (id, data) => {
    const chapter = get().chapters.find((item) => item.id === id) || await db.chapters.get(id);
    if (!chapter) return;

    await db.chapters.update(id, data);
    await touchProjectUpdatedAt(chapter.project_id, set);
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
    const {
      currentProject,
      chapters,
      scenes,
      activeChapterId,
      activeSceneId,
    } = get();
    const nextSelection = currentProject?.id === chapter.project_id
      ? (
        activeChapterId === id
          ? resolveSelectionAfterChapterDeletion(chapters, scenes, id)
          : { activeChapterId, activeSceneId }
      )
      : { activeChapterId: null, activeSceneId: null };

    await purgeChapterCanonState(chapter.project_id, id);
    await db.chapters.delete(id);
    await db.scenes.where('chapter_id').equals(id).delete();
    await db.chapterMeta.where('chapter_id').equals(id).delete();
    const relatedSuggestions = await db.suggestions.where('source_chapter_id').equals(id).toArray();
    if (relatedSuggestions.length > 0) {
      await db.suggestions.bulkDelete(relatedSuggestions.map((item) => item.id));
    }
    const stagedCandidates = await db.entity_resolution_candidates.where('chapter_id').equals(id).toArray();
    if (stagedCandidates.length > 0) {
      await db.entity_resolution_candidates.bulkDelete(stagedCandidates.map((item) => item.id));
    }
    await reindexProjectChapters(chapter.project_id);
    await rebuildCanonFromChapterEngine(chapter.project_id);
    await touchProjectUpdatedAt(chapter.project_id, set);
    if (currentProject?.id === chapter.project_id) {
      await get().loadProject(currentProject.id, nextSelection);
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
      title: `Cảnh ${order + 1}`,
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

    await touchProjectUpdatedAt(currentProject.id, set);
    await get().loadProject(currentProject.id, { activeChapterId: chapterId, activeSceneId: sceneId });
    return sceneId;
  },

  updateScene: async (id, data) => {
    const scene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!scene) return;

    await db.scenes.update(id, data);
    await touchProjectUpdatedAt(scene.project_id, set);

    const { currentProject } = get();
    if (currentProject?.id === scene.project_id) {
      set((state) => ({
        scenes: state.scenes.map((item) => (item.id === id ? { ...item, ...data } : item)),
      }));
    }

    if ('draft_text' in data || 'final_text' in data) {
      await get().refreshChapterWordCount(scene.chapter_id);
      void enqueueSceneMirror(id).catch(() => {});
    }
  },

  deleteScene: async (id) => {
    const scene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!scene) return;

    await db.scenes.delete(id);
    await reindexChapterScenes(scene.chapter_id);
    await get().refreshChapterWordCount(scene.chapter_id);
    await touchProjectUpdatedAt(scene.project_id, set);
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
    const { currentProject, chapters, chapterCompletionById } = get();
    if (!currentProject || !chapterId) return null;
    if (chapterCompletionById[chapterId]?.running) {
      const result = buildChapterCompletionResult(
        'busy',
        'Chương đang được hoàn thành. Hãy chờ tiến trình hiện tại kết thúc.',
      );
      return result;
    }

    const chapter = chapters.find((item) => item.id === chapterId) || await db.chapters.get(chapterId);
    if (!chapter) return null;

    get().setChapterCompletionState(chapterId, {
      running: true,
      phase: 'prepare',
      progress: 5,
      message: 'Đang chuẩn bị hoàn thành chương...',
      error: '',
      result: null,
      mode: options.mode || 'manual',
    });

    try {
      const initialSnapshot = await loadCompletionChapterText(chapterId);
      const chapterText = initialSnapshot.chapterText;
      if (!chapterText) {
        const emptyResult = buildChapterCompletionResult(
          'empty',
          'Chương chưa có nội dung để hoàn thành.',
        );
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
        chapterId,
        promptTemplates: parsePromptTemplates(currentProject.prompt_templates),
        nsfwMode: !!currentProject.nsfw_mode,
        superNsfwMode: !!currentProject.super_nsfw_mode,
        allowConcurrent: true,
        routeOptions: CHAPTER_COMPLETION_ROUTE_OPTIONS,
      };

      let summary = '';
      let extracted = null;
      let extractionWarning = '';
      let extractionStats = {
        createdCount: 0,
        created: {},
        createdEntries: {},
        stats: { skipped_ai_identity: 0 },
      };
      const completionSessionKey = buildCompletionSessionKey(currentProject.id, chapterId);
      let canonResult = null;
      let canonProcessed = false;
      let canonSucceeded = false;
      let canonReused = false;
      let canonRuntimeError = '';
      const { summarizeChapter, extractFromChapter } = useAIStore.getState();

      const runCanonWork = async () => {
        let existingCanonState = null;
        try {
          existingCanonState = await getChapterCanonState(currentProject.id, chapterId);
        } catch (error) {
          console.warn('[ChapterCompletion] Read canon state failed, falling back to canonicalize:', error);
        }

        const reusableRevision = existingCanonState?.canonicalRevision || existingCanonState?.revision || null;
        const canonFreshForCurrentText = isRevisionFreshForCanonText(reusableRevision, chapterText);
        const canonStatus = existingCanonState?.status || CHAPTER_COMMIT_STATUS.DRAFT;
        const canonHasBlockingErrors = canonStatus === CHAPTER_COMMIT_STATUS.BLOCKED
          || (existingCanonState?.errorCount || 0) > 0;
        const canonCanCompleteFromCache = canonFreshForCurrentText
          && COMPLETION_SUCCESS_CANON_STATUSES.has(canonStatus)
          && !canonHasBlockingErrors;
        const canonStillBlockedFromCache = canonFreshForCurrentText && canonHasBlockingErrors;

        try {
          if (canonCanCompleteFromCache || canonStillBlockedFromCache) {
            return {
              canonProcessed: true,
              canonReused: true,
              canonSucceeded: canonCanCompleteFromCache,
              canonRuntimeError: '',
              canonResult: {
                ok: canonCanCompleteFromCache,
                reused: true,
                status: canonStatus,
                revisionId: reusableRevision?.id || existingCanonState?.commit?.current_revision_id || null,
                reports: existingCanonState?.reports || [],
              },
            };
          }

          const nextCanonResult = await canonicalizeChapterEngine(currentProject.id, chapterId, {
            allowConcurrent: true,
            routeOptions: CHAPTER_COMPLETION_ROUTE_OPTIONS,
          });
          return {
            canonProcessed: true,
            canonReused: false,
            canonSucceeded: nextCanonResult?.ok !== false,
            canonRuntimeError: '',
            canonResult: nextCanonResult,
          };
        } catch (error) {
          console.warn('[ChapterCompletion] Canonicalize failed:', error);
          const nextCanonRuntimeError = toVietnameseErrorMessage(error, 'Khong the canon hoa chuong.');
          return {
            canonProcessed: false,
            canonReused: false,
            canonSucceeded: false,
            canonRuntimeError: nextCanonRuntimeError,
            canonResult: {
              ok: false,
              runtime_error: nextCanonRuntimeError,
            },
          };
        }
      };

      get().setChapterCompletionState(chapterId, {
        phase: 'summarize_extract',
        progress: 20,
        message: 'Đang tóm tắt và trích xuất dữ liệu codex...',
      });
      const summaryPromise = summarizeChapter(context);
      const extractPromise = extractFromChapter(context);
      const canonWorkPromise = runCanonWork();
      await yieldToUi();
      const [summaryResult, extractResult] = await Promise.allSettled([
        summaryPromise,
        extractPromise,
      ]);

      if (summaryResult.status === 'fulfilled') {
        summary = summaryResult.value || '';
      } else {
        console.warn('[ChapterCompletion] Summarize failed (non-fatal):', summaryResult.reason);
      }

      if (extractResult.status === 'fulfilled') {
        extracted = extractResult.value || null;
        if (!extracted) {
          extractionWarning = 'AI không trả về dữ liệu Codex hợp lệ ở lần hoàn thành này.';
        }
      } else {
        console.warn('[ChapterCompletion] Extraction failed (non-fatal):', extractResult.reason);
        extractionWarning = 'Không thể trích xuất Codex ở lần hoàn thành này.';
      }

      const snapshotBeforeCanon = await loadCompletionChapterText(chapterId);
      if (snapshotBeforeCanon.chapterText !== chapterText) {
        const earlyCanonOutcome = await canonWorkPromise;
        if (!earlyCanonOutcome.canonReused) {
          try {
            await purgeChapterCanonState(currentProject.id, chapterId);
          } catch (error) {
            console.warn('[ChapterCompletion] Failed to purge stale canon state:', error);
          }
        }
        const staleResult = buildChapterCompletionResult(
          'stale',
          'Nội dung chương đã thay đổi trong lúc hoàn thành. Hãy chạy lại để tránh ghi đè dữ liệu cũ.',
        );
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'error',
          progress: 0,
          message: staleResult.message,
          error: staleResult.message,
          result: staleResult,
        });
        return staleResult;
      }

      get().setChapterCompletionState(chapterId, {
        phase: 'canon',
        progress: 72,
        message: 'Đang kiểm tra trạng thái phân tích sự thật...',
      });
      await yieldToUi();
      const canonOutcome = await canonWorkPromise;
      canonResult = canonOutcome.canonResult;
      canonProcessed = canonOutcome.canonProcessed;
      canonSucceeded = canonOutcome.canonSucceeded;
      canonReused = canonOutcome.canonReused;
      canonRuntimeError = canonOutcome.canonRuntimeError;

      const snapshotAfterCanon = await loadCompletionChapterText(chapterId);
      if (snapshotAfterCanon.chapterText !== chapterText) {
        if (!canonReused) {
          try {
            await purgeChapterCanonState(currentProject.id, chapterId);
          } catch (error) {
            console.warn('[ChapterCompletion] Failed to purge stale canon state:', error);
          }
        }
        const staleResult = buildChapterCompletionResult(
          'stale',
          'Nội dung chương đã thay đổi trong lúc hoàn thành. Hãy chạy lại để tránh ghi đè dữ liệu cũ.',
        );
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'error',
          progress: 0,
          message: staleResult.message,
          error: staleResult.message,
          result: staleResult,
        });
        return staleResult;
      }

      get().setChapterCompletionState(chapterId, {
        phase: 'finalize',
        progress: 90,
        message: 'Đang đồng bộ dữ liệu chương...',
      });
      if (summary?.trim()) {
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
      }
      if (extracted) {
        try {
          const staged = await stageExtractedEntityCandidates({
            projectId: currentProject.id,
            chapterId,
            sessionKey: completionSessionKey,
            sourceType: 'chapter_extract',
            sourceRef: `chapter:${chapterId}`,
            extracted,
          });
          extractionStats = {
            createdCount: 0,
            created: {
              staged: staged.stagedCount || 0,
            },
            createdEntries: {
              characters: [],
              locations: [],
              worldTerms: [],
              objects: [],
            },
          };
        } catch (error) {
          console.warn('[ChapterCompletion] Stage extraction failed (non-fatal):', error);
        }
      }
      if (canonSucceeded) {
        await get().updateChapter(chapterId, { status: 'done' });
      } else {
        await get().updateChapter(chapterId, { status: 'draft' });
      }
      if (canonSucceeded) {
        try {
          extractionStats = await resolveAndMaterializeEntityCandidates({
            projectId: currentProject.id,
            chapterId,
            revisionId: canonResult?.revisionId || null,
            sessionKey: completionSessionKey,
          });
        } catch (error) {
          console.warn('[ChapterCompletion] Entity materialization failed after canon pass:', error);
        }
      }
      await useCodexStore.getState().applyCompletionDelta({
        projectId: currentProject.id,
        chapterId,
        createdEntries: extractionStats.createdEntries || {},
        refreshProjection: canonSucceeded,
      });
      await yieldToUi();

      const deferredCanonCount = Number(canonResult?.deferredCount || 0);
      const baseCompletionMessage = deferredCanonCount > 0
        ? `Đã hoàn thành chương. Có ${deferredCanonCount} thay đổi canon lớn đang chờ duyệt.`
        : canonReused
          ? 'Đã hoàn thành chương. Phân tích sự thật đã có sẵn và vẫn khớp nội dung.'
          : 'Đã hoàn thành chương.';
      const skippedIdentityCount = Number(extractionStats?.stats?.skipped_ai_identity || 0);
      const completionSuccessMessage = [
        baseCompletionMessage,
        skippedIdentityCount > 0
          ? `Bỏ qua ${skippedIdentityCount} mục trích xuất vì nhận diện AI không hợp lệ.`
          : '',
        extractionWarning,
      ].filter(Boolean).join(' ');
      const result = {
        ok: canonSucceeded,
        kind: canonProcessed
          ? (canonSucceeded ? 'success' : 'blocked')
          : 'runtime',
        message: canonSucceeded
          ? completionSuccessMessage
          : canonProcessed
            ? (canonReused
              ? 'Phân tích sự thật hiện tại vẫn đang có lỗi chặn, chương chưa được đánh dấu hoàn thành.'
              : 'Phân tích sự thật phát hiện mâu thuẫn, chương chưa được đánh dấu hoàn thành.')
            : (canonRuntimeError
              ? `Không thể hoàn thành chương vì lỗi canon hóa: ${canonRuntimeError}`
              : 'Không thể hoàn thành chương vì lỗi runtime khi canon hóa.'),
        summary,
        extracted,
        extractionWarning,
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
      const message = toVietnameseErrorMessage(error, 'Không thể hoàn thành chương.');
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
      await touchProjectUpdatedAt(currentProject.id, set);
    }
  },
}));

export default useProjectStore;
