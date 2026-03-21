/**
 * StoryForge — Codex Store (Phase 3)
 * 
 * Zustand store for Characters, Locations, Objects, World Terms, Taboos, ChapterMeta.
 * Provides CRUD operations and helper queries for the Context Engine.
 */

import { create } from 'zustand';
import db from '../services/db/database';

const useCodexStore = create((set, get) => ({
  // --- State ---
  characters: [],
  locations: [],
  objects: [],
  worldTerms: [],
  taboos: [],
  canonFacts: [],
  chapterMetas: [],
  loading: false,

  // =============================================
  // LOAD ALL codex data for a project
  // =============================================
  loadCodex: async (projectId) => {
    if (!projectId) return;
    set({ loading: true });
    const [characters, locations, objects, worldTerms, taboos, canonFacts, chapterMetas] = await Promise.all([
      db.characters.where('project_id').equals(projectId).toArray(),
      db.locations.where('project_id').equals(projectId).toArray(),
      db.objects.where('project_id').equals(projectId).toArray(),
      db.worldTerms.where('project_id').equals(projectId).toArray(),
      db.taboos.where('project_id').equals(projectId).toArray(),
      db.canonFacts.where('project_id').equals(projectId).toArray(),
      db.chapterMeta.where('project_id').equals(projectId).toArray(),
    ]);
    set({ characters, locations, objects, worldTerms, taboos, canonFacts, chapterMetas, loading: false });
  },

  // ═══════════════════════════════════════════
  // CHARACTERS
  // ═══════════════════════════════════════════
  createCharacter: async (data) => {
    const id = await db.characters.add({
      project_id: data.project_id,
      name: data.name || '',
      role: data.role || 'supporting',
      appearance: data.appearance || '',
      personality: data.personality || '',
      pronouns_self: data.pronouns_self || '',
      pronouns_other: data.pronouns_other || '',
      goals: data.goals || '',
      secrets: data.secrets || '',
      notes: data.notes || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateCharacter: async (id, data) => {
    await db.characters.update(id, data);
    // Update local state immediately
    set(state => ({
      characters: state.characters.map(c => c.id === id ? { ...c, ...data } : c),
    }));
  },

  deleteCharacter: async (id, projectId) => {
    await db.characters.delete(id);
    // Also delete associated taboos
    await db.taboos.where('character_id').equals(id).delete();
    if (projectId) await get().loadCodex(projectId);
  },

  // ═══════════════════════════════════════════
  // LOCATIONS
  // ═══════════════════════════════════════════
  createLocation: async (data) => {
    const id = await db.locations.add({
      project_id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      details: data.details || '',
      parent_location_id: data.parent_location_id || null,
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateLocation: async (id, data) => {
    await db.locations.update(id, data);
    set(state => ({
      locations: state.locations.map(l => l.id === id ? { ...l, ...data } : l),
    }));
  },

  deleteLocation: async (id, projectId) => {
    await db.locations.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ═══════════════════════════════════════════
  // OBJECTS (Vật phẩm)
  // ═══════════════════════════════════════════
  createObject: async (data) => {
    const id = await db.objects.add({
      project_id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      owner_character_id: data.owner_character_id || null,
      properties: data.properties || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateObject: async (id, data) => {
    await db.objects.update(id, data);
    set(state => ({
      objects: state.objects.map(o => o.id === id ? { ...o, ...data } : o),
    }));
  },

  deleteObject: async (id, projectId) => {
    await db.objects.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ═══════════════════════════════════════════
  // WORLD TERMS (Thuật ngữ)
  // ═══════════════════════════════════════════
  createWorldTerm: async (data) => {
    const id = await db.worldTerms.add({
      project_id: data.project_id,
      name: data.name || '',
      definition: data.definition || '',
      category: data.category || 'other',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateWorldTerm: async (id, data) => {
    await db.worldTerms.update(id, data);
    set(state => ({
      worldTerms: state.worldTerms.map(t => t.id === id ? { ...t, ...data } : t),
    }));
  },

  deleteWorldTerm: async (id, projectId) => {
    await db.worldTerms.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ═══════════════════════════════════════════
  // TABOOS (Cấm kỵ theo chương)
  // ═══════════════════════════════════════════
  createTaboo: async (data) => {
    const id = await db.taboos.add({
      project_id: data.project_id,
      character_id: data.character_id || null,
      description: data.description || '',
      effective_before_chapter: data.effective_before_chapter || 999,
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateTaboo: async (id, data) => {
    await db.taboos.update(id, data);
    set(state => ({
      taboos: state.taboos.map(t => t.id === id ? { ...t, ...data } : t),
    }));
  },

  deleteTaboo: async (id, projectId) => {
    await db.taboos.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  /**
   * Get active taboos for a given chapter index.
   * A taboo is active if currentChapter < effective_before_chapter.
   */
  getActiveTaboos: (currentChapterIndex) => {
    const { taboos, characters } = get();
    return taboos
      .filter(t => currentChapterIndex < t.effective_before_chapter)
      .map(t => ({
        ...t,
        characterName: characters.find(c => c.id === t.character_id)?.name || 'Không xác định',
      }));
  },

  // =============================================
  // CANON FACTS (Phase 4)
  // =============================================
  createCanonFact: async (data) => {
    const id = await db.canonFacts.add({
      project_id: data.project_id,
      description: data.description || '',
      fact_type: data.fact_type || 'fact', // fact | secret | rule
      status: data.status || 'active', // active | deprecated
      source_chapter_id: data.source_chapter_id || null,
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateCanonFact: async (id, data) => {
    await db.canonFacts.update(id, data);
    set(state => ({
      canonFacts: state.canonFacts.map(f => f.id === id ? { ...f, ...data } : f),
    }));
  },

  deleteCanonFact: async (id, projectId) => {
    await db.canonFacts.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  getActiveCanonFacts: () => {
    return get().canonFacts.filter(f => f.status === 'active');
  },

  // =============================================
  // CHAPTER META (Summary, etc.)
  // ═══════════════════════════════════════════
  getChapterMeta: (chapterId) => {
    return get().chapterMetas.find(m => m.chapter_id === chapterId) || null;
  },

  saveChapterSummary: async (chapterId, projectId, summary) => {
    const existing = get().chapterMetas.find(m => m.chapter_id === chapterId);
    if (existing) {
      await db.chapterMeta.update(existing.id, { summary, updated_at: Date.now() });
    } else {
      await db.chapterMeta.add({
        chapter_id: chapterId,
        project_id: projectId,
        summary,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
    await get().loadCodex(projectId);
  },

  // ═══════════════════════════════════════════
  // HELPERS for Context Engine
  // ═══════════════════════════════════════════

  /**
   * Find characters whose names appear in the given text.
   */
  findCharactersInText: (text) => {
    if (!text) return [];
    const { characters } = get();
    const cleanText = text.replace(/<[^>]*>/g, ' ').toLowerCase();
    return characters.filter(c => c.name && cleanText.includes(c.name.toLowerCase()));
  },

  /**
   * Find locations whose names appear in the given text.
   */
  findLocationsInText: (text) => {
    if (!text) return [];
    const { locations } = get();
    const cleanText = text.replace(/<[^>]*>/g, ' ').toLowerCase();
    return locations.filter(l => l.name && cleanText.includes(l.name.toLowerCase()));
  },

  /**
   * Find world terms whose names appear in the given text.
   */
  findTermsInText: (text) => {
    if (!text) return [];
    const { worldTerms } = get();
    const cleanText = text.replace(/<[^>]*>/g, ' ').toLowerCase();
    return worldTerms.filter(t => t.name && cleanText.includes(t.name.toLowerCase()));
  },
}));

export default useCodexStore;
