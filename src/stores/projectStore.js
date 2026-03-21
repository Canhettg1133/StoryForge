import { create } from 'zustand';
import db from '../services/db/database';

const useProjectStore = create((set, get) => ({
  // --- State ---
  projects: [],
  currentProject: null,
  chapters: [],
  scenes: [],
  activeChapterId: null,
  activeSceneId: null,
  loading: false,

  // --- Projects ---
  loadProjects: async () => {
    const projects = await db.projects.orderBy('updated_at').reverse().toArray();
    set({ projects });
  },

  createProject: async (data) => {
    const now = Date.now();
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
      // World Profile
      world_name: data.world_name || '',
      world_type: data.world_type || '',
      world_scale: data.world_scale || '',
      world_era: data.world_era || '',
      world_rules: data.world_rules || '[]',
      world_description: data.world_description || '',
      // Phase 4 — AI Flexibility
      ai_guidelines: data.ai_guidelines || '',
      ai_strictness: data.ai_strictness || 'balanced',
      // Phase 4 — POV, Synopsis, Structure, Pronouns
      pov_mode: data.pov_mode || 'third_limited',
      synopsis: data.synopsis || '',
      story_structure: data.story_structure || '',
      pronoun_style: data.pronoun_style || '',
      created_at: now,
      updated_at: now,
    });

    // Skip auto-creating first chapter if AI Wizard will create chapters
    if (!data.skipFirstChapter) {
      const chapterId = await db.chapters.add({
        project_id: id,
        arc_id: null,
        order_index: 0,
        title: 'Chương 1',
        summary: '',
        purpose: '',
        status: 'draft',
        word_count_target: 3000,
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
        // Phase 4 — Scene Contract
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
    // Delete all related data
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
    ]);
    set({ currentProject: null, chapters: [], scenes: [], activeChapterId: null, activeSceneId: null });
    await get().loadProjects();
  },

  // --- World Profile ---
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

  // --- Phase 4: Project Settings (general) ---
  updateProjectSettings: async (data) => {
    const { currentProject } = get();
    if (!currentProject) return;
    const updates = { ...data, updated_at: Date.now() };
    // Remove fields that shouldn't be directly set
    delete updates.id;
    delete updates.created_at;
    await db.projects.update(currentProject.id, updates);
    const updated = await db.projects.get(currentProject.id);
    set({ currentProject: updated });
  },

  // --- Load Project (open) ---
  loadProject: async (id) => {
    set({ loading: true });
    const project = await db.projects.get(id);
    const chapters = await db.chapters
      .where('project_id').equals(id)
      .sortBy('order_index');
    const scenes = await db.scenes
      .where('project_id').equals(id)
      .sortBy('order_index');

    const firstChapter = chapters[0] || null;
    const firstScene = firstChapter
      ? scenes.find(s => s.chapter_id === firstChapter.id) || null
      : null;

    set({
      currentProject: project,
      chapters,
      scenes,
      activeChapterId: firstChapter?.id || null,
      activeSceneId: firstScene?.id || null,
      loading: false,
    });
  },

  // --- Chapters ---
  createChapter: async (projectId, title) => {
    const { currentProject, chapters } = get();
    const pid = projectId || currentProject?.id;
    if (!pid) return;

    const existingChapters = projectId
      ? await db.chapters.where('project_id').equals(pid).sortBy('order_index')
      : chapters;
    const order = existingChapters.length;
    const chapterId = await db.chapters.add({
      project_id: pid,
      arc_id: null,
      order_index: order,
      title: title || `Chương ${order + 1}`,
      summary: '',
      purpose: '',
      status: 'draft',
      word_count_target: 3000,
      actual_word_count: 0,
    });

    // Auto-create first scene
    await db.scenes.add({
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
    });

    // Only reload state if this is the current project
    if (currentProject && currentProject.id === pid) {
      await get().loadProject(pid);
      set({ activeChapterId: chapterId });
    }
  },

  updateChapter: async (id, data) => {
    await db.chapters.update(id, data);
    const { currentProject } = get();
    if (currentProject) await get().loadProject(currentProject.id);
  },

  deleteChapter: async (id) => {
    await db.chapters.delete(id);
    await db.scenes.where('chapter_id').equals(id).delete();
    const { currentProject } = get();
    if (currentProject) await get().loadProject(currentProject.id);
  },

  // --- Scenes ---
  createScene: async (chapterId) => {
    const { currentProject, scenes } = get();
    if (!currentProject) return;

    const chapterScenes = scenes.filter(s => s.chapter_id === chapterId);
    const sceneId = await db.scenes.add({
      project_id: currentProject.id,
      chapter_id: chapterId,
      order_index: chapterScenes.length,
      title: `Cảnh ${chapterScenes.length + 1}`,
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
      // Phase 4 — Scene Contract
      must_happen: '[]',
      must_not_happen: '[]',
      pacing: '',
      characters_present: '[]',
    });

    await get().loadProject(currentProject.id);
    set({ activeSceneId: sceneId, activeChapterId: chapterId });
  },

  updateScene: async (id, data) => {
    await db.scenes.update(id, data);
    // Update local state without full reload for performance
    set(state => ({
      scenes: state.scenes.map(s => s.id === id ? { ...s, ...data } : s),
    }));
  },

  deleteScene: async (id) => {
    await db.scenes.delete(id);
    const { currentProject } = get();
    if (currentProject) await get().loadProject(currentProject.id);
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),
  setActiveScene: (id) => set({ activeSceneId: id }),

  // --- Helpers ---
  getActiveScene: () => {
    const { scenes, activeSceneId } = get();
    return scenes.find(s => s.id === activeSceneId) || null;
  },

  updateProjectTimestamp: async () => {
    const { currentProject } = get();
    if (currentProject) {
      await db.projects.update(currentProject.id, { updated_at: Date.now() });
    }
  },
}));

export default useProjectStore;
