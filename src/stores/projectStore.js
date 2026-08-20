import { create } from 'zustand';
import db from '../services/db/database';
import { CHAPTER_COMMIT_STATUS } from '../services/canon/constants';
import { isRevisionFreshForCanonText } from '../services/canon/utils';
import {
  normalizePromptProfileVersion,
  PROMPT_PROFILE_VERSIONS,
} from '../services/ai/promptProfiles.js';
import { toVietnameseErrorMessage } from '../utils/errorMessages';
import { enqueueSceneMirror } from '../services/storyMirror/outbox.js';
import {
  WORD_COUNT_CACHE_VERSION,
  applyWordCountDelta,
  buildSceneWordCountChange,
  countSceneWords,
  getStoredSceneWordCount,
  hasCurrentWordCountVersion,
  normalizeProjectWordCountsInSlices,
} from '../services/projects/sceneWordCounts.js';
import { reconcileProjectWordCounts } from '../services/projects/wordCountReconciliation.js';

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
function buildInitialPromptTemplates(genreKey, existingTemplates, genreTemplates = {}) {
  const template = genreTemplates[genreKey];

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

const RETRYABLE_CANON_REPORT_CODES = new Set([
  'CANON_EXTRACT_FALLBACK',
  'CANON_PROJECTION_REBUILD_FAILED',
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
  const { buildProseBuffer } = await import('../utils/proseBuffer');
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
const wordCountReconciliationByProject = new Map();

function cancelProjectWordCountReconciliation(projectId) {
  const normalizedProjectId = Number(projectId);
  const token = wordCountReconciliationByProject.get(normalizedProjectId);
  if (!token) return false;
  token.cancelled = true;
  wordCountReconciliationByProject.delete(normalizedProjectId);
  return true;
}

async function getVerifiedChapterWordCount(chapter, expectedChapter = null) {
  const stored = Number(chapter?.actual_word_count);
  const expectedStored = Number(expectedChapter?.actual_word_count);
  const matchesLoadedState = !expectedChapter || (
    hasCurrentWordCountVersion(expectedChapter)
    && Number.isFinite(expectedStored)
    && expectedStored >= 0
    && expectedStored === stored
  );
  if (
    matchesLoadedState
    && hasCurrentWordCountVersion(chapter)
    && Number.isFinite(stored)
    && stored >= 0
  ) {
    return stored;
  }

  const chapterScenes = await db.scenes.where('chapter_id').equals(chapter.id).toArray();
  return chapterScenes.reduce(
    (total, scene) => total + getStoredSceneWordCount(scene),
    0,
  );
}

function scheduleProjectWordCountReconciliation(projectId, chapters, scenes, setState) {
  if (import.meta.env.MODE === 'test') return;
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) return;

  cancelProjectWordCountReconciliation(normalizedProjectId);
  const token = { cancelled: false };
  wordCountReconciliationByProject.set(normalizedProjectId, token);

  void reconcileProjectWordCounts({
    db,
    projectId: normalizedProjectId,
    chapters,
    scenes,
    isCancelled: () => token.cancelled,
  }).then((result) => {
    if (token.cancelled || result.cancelled || result.chapterWordCounts.size === 0) return;
    setState((state) => {
      if (state.currentProject?.id !== normalizedProjectId) return {};
      return {
        chapters: state.chapters.map((chapter) => (
          result.chapterWordCounts.has(chapter.id)
            ? {
              ...chapter,
              actual_word_count: result.chapterWordCounts.get(chapter.id),
              word_count_version: WORD_COUNT_CACHE_VERSION,
            }
            : chapter
        )),
      };
    });
  }).catch((error) => {
    console.warn('[ProjectStore] Background word-count reconciliation failed:', error);
  }).finally(() => {
    if (wordCountReconciliationByProject.get(normalizedProjectId) === token) {
      wordCountReconciliationByProject.delete(normalizedProjectId);
    }
  });
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
    const { GENRE_TEMPLATES } = await import('../utils/genreTemplates');
    const genreKey = data.genre_primary || 'fantasy';
    const initialPromptTemplates = buildInitialPromptTemplates(
      genreKey,
      data.prompt_templates, // Merge caller-provided templates instead of overwriting.
      GENRE_TEMPLATES,
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
        word_count_version: WORD_COUNT_CACHE_VERSION,
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
        word_count: 0,
        word_count_version: WORD_COUNT_CACHE_VERSION,
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
    const { deleteProjectCascade } = await import('../services/db/projectDataService.js');
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
      if (currentProject?.id != null) {
        cancelProjectWordCountReconciliation(currentProject.id);
      }
      const projectPromise = db.projects.get(numericId);
      const chaptersPromise = (async () => {
        try {
          return await db.chapters.where('project_id').equals(numericId).sortBy('order_index');
        } catch (error) {
          console.warn('[ProjectStore] Indexed chapter load failed, falling back to raw scan:', error);
          return (await db.chapters.toArray())
            .filter((chapter) => Number(chapter?.project_id) === numericId)
            .sort((left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0));
        }
      })();
      const scenesPromise = (async () => {
        try {
          return await db.scenes.where('project_id').equals(numericId).sortBy('order_index');
        } catch (error) {
          console.warn('[ProjectStore] Indexed scene load failed, falling back to raw scan:', error);
          return (await db.scenes.toArray())
            .filter((scene) => Number(scene?.project_id) === numericId)
            .sort((left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0));
        }
      })();
      const [project, chapters, scenes] = await Promise.all([
        projectPromise,
        chaptersPromise,
        scenesPromise,
      ]);
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

      const wordCounts = await normalizeProjectWordCountsInSlices(chapters, scenes);
      const shouldPreserveSelection = options.preserveSelection !== false && currentProject?.id === numericId;
      const requestedChapterId = options.activeChapterId ?? (shouldPreserveSelection ? activeChapterId : null);
      const requestedSceneId = options.activeSceneId ?? (shouldPreserveSelection ? activeSceneId : null);
      const selection = resolveActiveSelection(
        wordCounts.chapters,
        wordCounts.scenes,
        requestedChapterId,
        requestedSceneId,
      );

      if (requestId === latestProjectLoadRequestId) {
        set({
          currentProject: project,
          chapters: wordCounts.chapters,
          scenes: wordCounts.scenes,
          ...selection,
        });
        if (wordCounts.needsPersistence) {
          scheduleProjectWordCountReconciliation(
            numericId,
            wordCounts.chapters,
            wordCounts.scenes,
            set,
          );
        }
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
      actual_word_count: 0,
      word_count_version: WORD_COUNT_CACHE_VERSION,
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
      word_count: 0,
      word_count_version: WORD_COUNT_CACHE_VERSION,
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
    const [
      {
        purgeChapterCanonState,
        rebuildCanonFromChapter: rebuildCanonFromChapterEngine,
      },
      { default: useCodexStore },
    ] = await Promise.all([
      import('../services/canon/projection'),
      import('./codexStore'),
    ]);
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
      word_count: 0,
      word_count_version: WORD_COUNT_CACHE_VERSION,
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
    const fallbackScene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!fallbackScene) return;
    const loadedChapters = get().chapters;

    const updatesWordCount = 'draft_text' in data || 'final_text' in data || 'chapter_id' in data;
    const restartReconciliation = updatesWordCount
      ? cancelProjectWordCountReconciliation(fallbackScene.project_id)
      : false;
    let committed = null;

    try {
      await db.transaction('rw', db.scenes, db.chapters, db.projects, async () => {
        const scene = await db.scenes.get(id);
        if (!scene) return;

        const projectPatch = {
          updated_at: Date.now(),
          cloud_pending_local_fork_until_change: 0,
        };
        const scenePatch = { ...data };
        delete scenePatch.word_count;
        delete scenePatch.word_count_version;
        const chapterWordCounts = new Map();

        if (updatesWordCount) {
          const wordCountChange = buildSceneWordCountChange(scene, data);
          scenePatch.word_count = wordCountChange.nextWordCount;
          scenePatch.word_count_version = wordCountChange.wordCountVersion;
          const previousChapterId = scene.chapter_id;
          const nextChapterId = wordCountChange.nextScene.chapter_id;

          if (previousChapterId === nextChapterId) {
            const chapter = await db.chapters.get(previousChapterId);
            if (chapter) {
              const currentChapterWordCount = await getVerifiedChapterWordCount(
                chapter,
                loadedChapters.find((item) => item.id === previousChapterId),
              );
              chapterWordCounts.set(
                previousChapterId,
                applyWordCountDelta(currentChapterWordCount, wordCountChange.delta),
              );
            }
          } else {
            const [previousChapter, nextChapter] = await Promise.all([
              db.chapters.get(previousChapterId),
              db.chapters.get(nextChapterId),
            ]);
            const [previousChapterWordCount, nextChapterWordCount] = await Promise.all([
              previousChapter
                ? getVerifiedChapterWordCount(
                  previousChapter,
                  loadedChapters.find((item) => item.id === previousChapterId),
                )
                : null,
              nextChapter
                ? getVerifiedChapterWordCount(
                  nextChapter,
                  loadedChapters.find((item) => item.id === nextChapterId),
                )
                : null,
            ]);
            if (previousChapter) {
              chapterWordCounts.set(
                previousChapterId,
                applyWordCountDelta(previousChapterWordCount, -wordCountChange.previousWordCount),
              );
            }
            if (nextChapter) {
              chapterWordCounts.set(
                nextChapterId,
                applyWordCountDelta(nextChapterWordCount, wordCountChange.nextWordCount),
              );
            }
          }
        }

        await db.scenes.update(id, scenePatch);
        for (const [chapterId, actualWordCount] of chapterWordCounts) {
          await db.chapters.update(chapterId, {
            actual_word_count: actualWordCount,
            word_count_version: WORD_COUNT_CACHE_VERSION,
          });
        }
        await db.projects.update(scene.project_id, projectPatch);

        committed = {
          id,
          projectId: scene.project_id,
          scenePatch,
          projectPatch,
          chapterWordCounts,
        };
      });
    } catch (error) {
      if (restartReconciliation) {
        scheduleProjectWordCountReconciliation(
          fallbackScene.project_id,
          get().chapters,
          get().scenes,
          set,
        );
      }
      throw error;
    }

    if (!committed) return;
    set((state) => {
      if (state.currentProject?.id !== committed.projectId) return {};
      return {
        currentProject: { ...state.currentProject, ...committed.projectPatch },
        scenes: state.scenes.map((item) => (
          item.id === committed.id ? { ...item, ...committed.scenePatch } : item
        )),
        chapters: committed.chapterWordCounts.size > 0
          ? state.chapters.map((item) => (
            committed.chapterWordCounts.has(item.id)
              ? {
                ...item,
                actual_word_count: committed.chapterWordCounts.get(item.id),
                word_count_version: WORD_COUNT_CACHE_VERSION,
              }
              : item
          ))
          : state.chapters,
      };
    });

    if (updatesWordCount) {
      void enqueueSceneMirror(id).catch(() => {});
    }
    if (restartReconciliation) {
      scheduleProjectWordCountReconciliation(
        committed.projectId,
        get().chapters,
        get().scenes,
        set,
      );
    }
  },

  deleteScene: async (id) => {
    const fallbackScene = get().scenes.find((item) => item.id === id) || await db.scenes.get(id);
    if (!fallbackScene) return;
    const loadedChapters = get().chapters;
    cancelProjectWordCountReconciliation(fallbackScene.project_id);

    await db.transaction('rw', db.scenes, db.chapters, db.projects, async () => {
      const scene = await db.scenes.get(id);
      if (!scene) return;
      const chapter = await db.chapters.get(scene.chapter_id);
      const currentChapterWordCount = chapter
        ? await getVerifiedChapterWordCount(
          chapter,
          loadedChapters.find((item) => item.id === scene.chapter_id),
        )
        : 0;
      const projectPatch = {
        updated_at: Date.now(),
        cloud_pending_local_fork_until_change: 0,
      };

      await db.scenes.delete(id);
      await reindexChapterScenes(scene.chapter_id);
      if (chapter) {
        await db.chapters.update(scene.chapter_id, {
          actual_word_count: applyWordCountDelta(
            currentChapterWordCount,
            -getStoredSceneWordCount(scene),
          ),
          word_count_version: WORD_COUNT_CACHE_VERSION,
        });
      }
      await db.projects.update(scene.project_id, projectPatch);
    });

    const { currentProject } = get();
    if (currentProject?.id === fallbackScene.project_id) {
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

    const sceneWordCounts = new Map();
    const actualWordCount = await db.transaction('rw', db.scenes, db.chapters, async () => {
      const chapterScenes = await db.scenes.where('chapter_id').equals(chapterId).toArray();
      let total = 0;
      for (const scene of chapterScenes) {
        const wordCount = countSceneWords(scene);
        total += wordCount;
        sceneWordCounts.set(scene.id, wordCount);
        if (
          Number(scene.word_count) !== wordCount
          || !hasCurrentWordCountVersion(scene)
        ) {
          await db.scenes.update(scene.id, {
            word_count: wordCount,
            word_count_version: WORD_COUNT_CACHE_VERSION,
          });
        }
      }

      await db.chapters.update(chapterId, {
        actual_word_count: total,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      });
      return total;
    });

    const { currentProject } = get();
    if (currentProject?.id === chapter.project_id) {
      set((state) => ({
        chapters: state.chapters.map((item) => (
          item.id === chapterId
            ? {
              ...item,
              actual_word_count: actualWordCount,
              word_count_version: WORD_COUNT_CACHE_VERSION,
            }
            : item
        )),
        scenes: state.scenes.map((scene) => (
          sceneWordCounts.has(scene.id)
            ? {
              ...scene,
              word_count: sceneWordCounts.get(scene.id),
              word_count_version: WORD_COUNT_CACHE_VERSION,
            }
            : scene
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
      const [
        { default: useAIStore },
        { default: useCodexStore },
        { default: useSuggestionStore },
        {
          finalizePreparedEntityCandidates,
          prepareEntityCandidatesForCanon,
          rollbackPreparedEntityCandidates,
          stageExtractedEntityCandidates,
        },
        { canonicalizeChapter: canonicalizeChapterEngine },
        { purgeChapterCanonState },
        { getChapterCanonState },
      ] = await Promise.all([
        import('./aiStore'),
        import('./codexStore'),
        import('./suggestionStore'),
        import('../services/entityIdentity/index.js'),
        import('../services/canon/workflow'),
        import('../services/canon/projection'),
        import('../services/canon/queries'),
      ]);
      const { summarizeChapter, extractFromChapter } = useAIStore.getState();

      const readCachedCanonOutcome = async () => {
        let existingCanonState = null;
        try {
          existingCanonState = await getChapterCanonState(currentProject.id, chapterId);
        } catch (error) {
          console.warn('[ChapterCompletion] Read canon state failed, falling back to canonicalize:', error);
          return null;
        }

        const reusableRevision = existingCanonState?.canonicalRevision || existingCanonState?.revision || null;
        const canonFreshForCurrentText = isRevisionFreshForCanonText(reusableRevision, chapterText);
        const canonStatus = existingCanonState?.status || CHAPTER_COMMIT_STATUS.DRAFT;
        const canonHasBlockingErrors = canonStatus === CHAPTER_COMMIT_STATUS.BLOCKED
          || (existingCanonState?.errorCount || 0) > 0;
        const canonHasRetryableFailure = (existingCanonState?.reports || [])
          .some((report) => RETRYABLE_CANON_REPORT_CODES.has(report?.rule_code));
        const canonCanCompleteFromCache = canonFreshForCurrentText
          && COMPLETION_SUCCESS_CANON_STATUSES.has(canonStatus)
          && !canonHasBlockingErrors
          && !canonHasRetryableFailure;
        const canonStillBlockedFromCache = canonFreshForCurrentText
          && canonHasBlockingErrors
          && !canonHasRetryableFailure;

        if (!canonCanCompleteFromCache && !canonStillBlockedFromCache) return null;
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
            extractionStatus: existingCanonState?.extractionStatus || 'succeeded',
            extractedCount: existingCanonState?.extractedCount || 0,
            committedCount: existingCanonState?.committedCount || 0,
            filteredCount: existingCanonState?.filteredCount || 0,
            extractionRetried: !!existingCanonState?.extractionRetried,
            extractionAttemptCount: existingCanonState?.extractionAttemptCount || 0,
            invalidatedChapterCount: 0,
          },
        };
      };

      const runCanonWork = async ({ force = false } = {}) => {
        if (!force) {
          const cachedOutcome = await readCachedCanonOutcome();
          if (cachedOutcome) return cachedOutcome;
        }

        try {
          const nextCanonResult = await canonicalizeChapterEngine(currentProject.id, chapterId, {
            allowConcurrent: true,
            routeOptions: CHAPTER_COMPLETION_ROUTE_OPTIONS,
          });
          const hasExplicitCanonResult = nextCanonResult
            && typeof nextCanonResult === 'object';
          return {
            canonProcessed: true,
            canonReused: false,
            canonSucceeded: nextCanonResult?.ok === true,
            canonRuntimeError: '',
            canonResult: hasExplicitCanonResult
              ? nextCanonResult
              : {
                ok: false,
                extractionStatus: 'failed',
                reports: [],
                extractedCount: 0,
                committedCount: 0,
                filteredCount: 0,
              },
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

      const cachedCanonOutcome = await readCachedCanonOutcome();
      const canFinishDirectlyFromCache = cachedCanonOutcome
        && (!cachedCanonOutcome.canonSucceeded || chapter.status === 'done');
      if (canFinishDirectlyFromCache) {
        canonResult = cachedCanonOutcome.canonResult;
        canonProcessed = cachedCanonOutcome.canonProcessed;
        canonSucceeded = cachedCanonOutcome.canonSucceeded;
        canonReused = true;
        await get().updateChapter(chapterId, { status: canonSucceeded ? 'done' : 'draft' });
        await useCodexStore.getState().applyCompletionDelta({
          projectId: currentProject.id,
          chapterId,
          createdEntries: {},
          refreshProjection: canonSucceeded,
        });
        if (canonSucceeded) {
          await useSuggestionStore.getState().loadSuggestions(currentProject.id);
        }

        const filteredCanonCount = Number(canonResult?.filteredCount || 0);
        const cachedMessage = canonSucceeded
          ? [
            'Đã hoàn thành chương. Phân tích sự thật đã có sẵn và vẫn khớp nội dung.',
            filteredCanonCount > 0
              ? `${filteredCanonCount} thay đổi bị lọc vì không đủ độ tin cậy hoặc chưa hợp lệ.`
              : '',
          ].filter(Boolean).join(' ')
          : 'Phân tích sự thật hiện tại vẫn đang có lỗi chặn, chương chưa được đánh dấu hoàn thành.';
        const cachedResult = {
          ok: canonSucceeded,
          kind: canonProcessed ? (canonSucceeded ? 'success' : 'blocked') : 'runtime',
          message: cachedMessage,
          summary: '',
          extracted: null,
          extractionWarning: '',
          extractionStats,
          canonResult,
        };
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: cachedResult.ok ? 'done' : 'error',
          progress: cachedResult.ok ? 100 : 0,
          message: cachedResult.message,
          error: cachedResult.ok ? '' : cachedResult.message,
          result: cachedResult,
        });
        return cachedResult;
      }

      get().setChapterCompletionState(chapterId, {
        phase: 'summarize_extract',
        progress: 20,
        message: 'Đang tóm tắt và trích xuất dữ liệu codex...',
      });
      const summaryPromise = summarizeChapter(context);
      const extractPromise = extractFromChapter(context);
      await yieldToUi();
      const [summaryResult, extractResult] = await Promise.allSettled([
        summaryPromise,
        extractPromise,
      ]);

      const summaryFailed = summaryResult.status !== 'fulfilled'
        || !String(summaryResult.value || '').trim();
      if (!summaryFailed) {
        summary = summaryResult.value;
      } else if (summaryResult.status === 'rejected') {
        console.warn('[ChapterCompletion] Summarize failed:', summaryResult.reason);
      }

      if (extractResult.status === 'fulfilled') {
        extracted = extractResult.value || null;
        if (!extracted) {
          extractionWarning = 'AI không trả về dữ liệu Codex hợp lệ ở lần hoàn thành này.';
        }
      } else {
        console.warn('[ChapterCompletion] Extraction failed:', extractResult.reason);
        extractionWarning = 'Không thể trích xuất Codex ở lần hoàn thành này.';
      }

      if (summaryFailed) {
        await get().updateChapter(chapterId, { status: 'draft' });
        const summaryFailure = {
          ok: false,
          kind: 'blocked',
          message: 'Không thể tóm tắt chương ở lần hoàn thành này. Chương vẫn ở trạng thái bản nháp; hãy thử lại.',
          summary: '',
          extracted,
          extractionWarning: 'AI không trả về bản tóm tắt chương hợp lệ.',
          extractionStats,
          canonResult: null,
        };
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'error',
          progress: 0,
          message: summaryFailure.message,
          error: summaryFailure.message,
          result: summaryFailure,
        });
        return summaryFailure;
      }

      if (!extracted) {
        await get().updateChapter(chapterId, { status: 'draft' });
        const extractionFailure = {
          ok: false,
          kind: 'blocked',
          message: `${extractionWarning} Chương vẫn ở trạng thái bản nháp; hãy thử lại.`,
          summary,
          extracted: null,
          extractionWarning,
          extractionStats,
          canonResult: null,
        };
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'error',
          progress: 0,
          message: extractionFailure.message,
          error: extractionFailure.message,
          result: extractionFailure,
        });
        return extractionFailure;
      }

      let preparedEntities;
      try {
        const staged = await stageExtractedEntityCandidates({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
          sourceType: 'chapter_extract',
          sourceRef: `chapter:${chapterId}`,
          extracted,
        });
        preparedEntities = await prepareEntityCandidatesForCanon({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
        });
        extractionStats = {
          ...preparedEntities,
          created: {
            ...(preparedEntities.created || {}),
            staged: staged.stagedCount || 0,
          },
        };
      } catch (error) {
        console.warn('[ChapterCompletion] Prepare entity extraction failed:', error);
        extractionWarning = 'Không thể chuẩn bị dữ liệu nhân vật, địa điểm, vật phẩm hoặc thuật ngữ cho canon.';
      }

      if (!preparedEntities?.ok) {
        await rollbackPreparedEntityCandidates({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
          discard: true,
        });
        await get().updateChapter(chapterId, { status: 'draft' });
        const invalidIdentityCount = Number(
          preparedEntities?.stats?.rejected || preparedEntities?.stats?.ambiguous_review || 0,
        );
        const extractionFailure = {
          ok: false,
          kind: 'blocked',
          message: extractionWarning
            || `AI trả về ${invalidIdentityCount || 'một số'} thực thể không thể nhận diện chắc chắn. Chương vẫn ở trạng thái bản nháp; hãy thử lại.`,
          summary,
          extracted,
          extractionWarning: extractionWarning || 'Dữ liệu Codex có thực thể không hợp lệ hoặc mơ hồ.',
          extractionStats,
          canonResult: null,
        };
        get().setChapterCompletionState(chapterId, {
          running: false,
          phase: 'error',
          progress: 0,
          message: extractionFailure.message,
          error: extractionFailure.message,
          result: extractionFailure,
        });
        return extractionFailure;
      }

      const snapshotBeforeCanon = await loadCompletionChapterText(chapterId);
      if (snapshotBeforeCanon.chapterText !== chapterText) {
        await rollbackPreparedEntityCandidates({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
          discard: true,
        });
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
      const canonOutcome = await runCanonWork({
        force: Number(preparedEntities.createdCount || 0) > 0,
      });
      canonResult = canonOutcome.canonResult;
      canonProcessed = canonOutcome.canonProcessed;
      canonSucceeded = canonOutcome.canonSucceeded;
      canonReused = canonOutcome.canonReused;
      canonRuntimeError = canonOutcome.canonRuntimeError;

      if (!canonSucceeded) {
        await rollbackPreparedEntityCandidates({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
        });
        extractionStats = {
          ...extractionStats,
          createdCount: 0,
          createdEntries: { characters: [], locations: [], objects: [], worldTerms: [] },
        };
      }

      const snapshotAfterCanon = await loadCompletionChapterText(chapterId);
      if (snapshotAfterCanon.chapterText !== chapterText) {
        if (!canonReused) {
          try {
            await purgeChapterCanonState(currentProject.id, chapterId);
          } catch (error) {
            console.warn('[ChapterCompletion] Failed to purge stale canon state:', error);
          }
        }
        await rollbackPreparedEntityCandidates({
          projectId: currentProject.id,
          chapterId,
          sessionKey: completionSessionKey,
          discard: true,
        });
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
      if (canonSucceeded) {
        try {
          extractionStats = await finalizePreparedEntityCandidates({
            projectId: currentProject.id,
            chapterId,
            revisionId: canonResult?.revisionId || null,
            sessionKey: completionSessionKey,
          });
        } catch (error) {
          console.warn('[ChapterCompletion] Entity finalization failed:', error);
          await rollbackPreparedEntityCandidates({
            projectId: currentProject.id,
            chapterId,
            sessionKey: completionSessionKey,
          });
          if (!canonReused) {
            try {
              await purgeChapterCanonState(currentProject.id, chapterId);
            } catch (purgeError) {
              console.warn('[ChapterCompletion] Failed to purge canon after entity finalization error:', purgeError);
            }
          }
          canonSucceeded = false;
          canonProcessed = false;
          canonRuntimeError = 'Không thể hoàn tất dữ liệu Codex sau khi phân tích canon.';
          extractionStats = {
            ...extractionStats,
            createdCount: 0,
            createdEntries: { characters: [], locations: [], objects: [], worldTerms: [] },
          };
        }
      }
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
      if (canonSucceeded) {
        await useSuggestionStore.getState().loadSuggestions(currentProject.id);
      }
      await yieldToUi();

      const committedCanonCount = Number(canonResult?.committedCount || 0);
      const filteredCanonCount = Number(canonResult?.filteredCount || 0);
      const canonExtractionRetried = !!canonResult?.extractionRetried;
      const invalidatedChapterCount = Number(
        canonResult?.invalidatedChapterCount
        ?? canonResult?.invalidatedChapterIds?.length
        ?? 0,
      );
      const baseCompletionMessage = canonReused
        ? 'Đã hoàn thành chương. Phân tích sự thật đã có sẵn và vẫn khớp nội dung.'
        : committedCanonCount > 0
          ? `Đã hoàn thành chương và áp dụng ${committedCanonCount} thay đổi canon.`
          : 'Đã hoàn thành chương; không phát hiện thay đổi canon mới.';
      const skippedIdentityCount = Number(extractionStats?.stats?.skipped_ai_identity || 0);
      const ambiguousIdentityCount = Number(extractionStats?.stats?.ambiguous_review || 0);
      const completionSuccessMessage = [
        baseCompletionMessage,
        filteredCanonCount > 0
          ? `${filteredCanonCount} thay đổi bị lọc vì không đủ độ tin cậy hoặc chưa hợp lệ.`
          : '',
        canonExtractionRetried
          ? 'Phản hồi canon ban đầu đã được AI tự sửa và kiểm chứng lại trước khi áp dụng.'
          : '',
        invalidatedChapterCount > 0
          ? `${invalidatedChapterCount} chương phía sau đã được đánh dấu cần phân tích lại.`
          : '',
        skippedIdentityCount > 0
          ? `Bỏ qua ${skippedIdentityCount} mục trích xuất vì nhận diện AI không hợp lệ.`
          : '',
        ambiguousIdentityCount > 0
          ? `${ambiguousIdentityCount} thực thể mơ hồ đã được đưa vào Hộp đề xuất.`
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
            ? (canonResult?.extractionStatus === 'failed'
              ? 'AI không trích xuất được canon hợp lệ, chương vẫn ở trạng thái bản nháp. Hãy thử phân tích lại.'
              : canonReused
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

}));

export default useProjectStore;
