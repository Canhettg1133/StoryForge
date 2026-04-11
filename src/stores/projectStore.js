import { create } from 'zustand';
import db from '../services/db/database';
import { countWords } from '../utils/constants';
import { GENRE_TEMPLATES } from '../utils/genreTemplates';
import { buildProseBuffer } from '../utils/proseBuffer';
import { canonicalizeChapter as canonicalizeChapterEngine } from '../services/canon/engine';

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

  loadProjects: async () => {
    const projects = await db.projects.orderBy('updated_at').reverse().toArray();
    set({ projects });
  },

  createProject: async (data) => {
    const now = Date.now();

    // ─── Tự động nạp DNA Văn phong từ template thể loại ───
    // Lấy genre_primary người dùng vừa chọn, tra GENRE_TEMPLATES,
    // bơm constitution + style_dna + anti_ai_blacklist vào prompt_templates.
    const genreKey = data.genre_primary || 'fantasy';
    const initialPromptTemplates = buildInitialPromptTemplates(
      genreKey,
      data.prompt_templates, // nếu caller đã truyền vào thì merge thay vì ghi đè
    );

    const id = await db.projects.add({
      title: data.title || 'Truyện chưa đặt tên',
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
      prompt_templates: initialPromptTemplates, // ← DNA văn phong đã được bơm vào đây
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
    const chapterId = await db.chapters.add({
      project_id: pid,
      arc_id: chapterData.arc_id ?? null,
      order_index: order,
      title: title || chapterData.title || `Chương ${order + 1}`,
      summary: chapterData.summary || '',
      purpose: chapterData.purpose || '',
      status: chapterData.status || 'draft',
      word_count_target: chapterData.word_count_target ?? 3000,
      actual_word_count: chapterData.actual_word_count ?? 0,
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
      await get().loadProject(currentProject.id);
    }
  },

  deleteChapter: async (id) => {
    const chapter = get().chapters.find((item) => item.id === id) || await db.chapters.get(id);
    if (!chapter) return;

    await db.chapters.delete(id);
    await db.scenes.where('chapter_id').equals(id).delete();
    await reindexProjectChapters(chapter.project_id);
    const { currentProject } = get();
    if (currentProject?.id === chapter.project_id) {
      await get().loadProject(currentProject.id);
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
   * Non-blocking — errors are silently handled.
   */
  autoCompleteChapter: async (chapterId) => {
    const { completingChapterId, currentProject, chapters, scenes } = get();
    if (completingChapterId === chapterId) return;
    if (!currentProject || !chapterId) return;

    const chapter = chapters.find(c => c.id === chapterId);
    if (!chapter || chapter.status === 'done') return;

    set({ completingChapterId: chapterId });

    try {
      const chapterScenes = scenes.filter(s => s.chapter_id === chapterId);
      const chapterText = chapterScenes
        .map(s => s.draft_text || '')
        .join('\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim();

      if (!chapterText) {
        set({ completingChapterId: null });
        return;
      }

      const context = {
        sceneText: chapterText,
        chapterTitle: chapter.title,
        projectTitle: currentProject.title,
        genre: currentProject.genre_primary || '',
        projectId: currentProject.id,
      };

      // Step 1: Summarize chapter + persist prose tail for continuity
      const lastProseBuffer = buildProseBuffer(chapterText);
      const existingMeta = await db.chapterMeta
        .where('chapter_id').equals(chapterId)
        .first();
      let summary = '';
      try {
        const { summarizeChapter } = await import('./aiStore').then(m => m.default.getState());
        summary = await summarizeChapter(context);
      } catch (e) {
        console.warn('[AutoComplete] Summarize failed (non-fatal):', e);
      }

      const metaData = {
        chapter_id: chapterId,
        project_id: currentProject.id,
        last_prose_buffer: lastProseBuffer,
        emotional_state: existingMeta?.emotional_state || null,
        tension_level: existingMeta?.tension_level || null,
      };

      if (existingMeta) {
        const updates = {};
        if (summary?.trim()) updates.summary = summary;
        if (lastProseBuffer) updates.last_prose_buffer = lastProseBuffer;
        if (Object.keys(updates).length > 0) {
          await db.chapterMeta.update(existingMeta.id, updates);
        }
      } else {
        await db.chapterMeta.add({
          ...metaData,
          summary: summary?.trim() || '',
        });
      }

      // Step 2: Extract Codex entries
      try {
        const { extractFromChapter } = await import('./aiStore').then(m => m.default.getState());
        await extractFromChapter(context);
      } catch (e) {
        console.warn('[AutoComplete] Extract failed (non-fatal):', e);
      }

      // Step 3: Canonicalize chapter before marking done
      let canonResult = null;
      try {
        canonResult = await canonicalizeChapterEngine(currentProject.id, chapterId);
      } catch (e) {
        console.warn('[AutoComplete] Canonicalize failed:', e);
      }

      if (canonResult?.ok) {
        await get().updateChapter(chapterId, { status: 'done' });
      } else if (canonResult && !canonResult.ok) {
        await get().updateChapter(chapterId, { status: 'draft' });
      }
    } catch (e) {
      console.warn('[AutoComplete] Failed:', e);
    } finally {
      set({ completingChapterId: null });
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
