/**
 * StoryForge - Codex Store (Phase 3 + Patch: Factions & Aliases)
 *
 * Zustand store for Characters, Locations, Objects, World Terms,
 * Factions, Taboos, ChapterMeta, CanonFacts.
 *
 * Changes from the older version:
 *  - Add `factions` state + CRUD support
 *  - Add `aliases` to Character, Location, WorldTerm, and Faction
 *  - Upgrade find*InText to support aliases + split names like "A - B"
 */

import { create } from 'zustand';
import db from '../services/db/database';
import { buildProseBuffer } from '../utils/proseBuffer';

// ---------------------------------------------
// Helper: check whether one entry appears in a block of text.
// Match primary name + aliases + auto-split names like "A - B".
// ---------------------------------------------
function matchesText(entry, cleanText) {
  if (!entry?.name) return false;

  const candidates = [
    entry.name,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    // auto-split "Thanh Van Tong - Tap Vat Vien" -> ["Thanh Van Tong", "Tap Vat Vien"]
    ...entry.name
      .split(' - ')
      .map(s => s.trim())
      .filter(s => s.length > 1),
  ];

  return candidates.some(n => n && cleanText.includes(n.toLowerCase()));
}

function cleanHtml(text) {
  return (text || '').replace(/<[^>]*>/g, ' ').toLowerCase();
}

function mergeByIdAndName(existingItems = [], nextItems = []) {
  if (!Array.isArray(nextItems) || nextItems.length === 0) return existingItems;

  const merged = [...existingItems];
  const seenIds = new Set(existingItems.map((item) => item?.id).filter((id) => id != null));
  const seenNames = new Set(
    existingItems
      .map((item) => String(item?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  for (const item of nextItems) {
    const normalizedName = String(item?.name || '').trim().toLowerCase();
    if ((item?.id != null && seenIds.has(item.id)) || (normalizedName && seenNames.has(normalizedName))) {
      continue;
    }
    if (item?.id != null) seenIds.add(item.id);
    if (normalizedName) seenNames.add(normalizedName);
    merged.push(item);
  }

  return merged;
}

// ---------------------------------------------

const useCodexStore = create((set, get) => ({
  // --- State ---
  characters: [],
  locations: [],
  objects: [],
  worldTerms: [],
  factions: [],       // New: factions / organizations
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
    const [
      characters,
      locations,
      objects,
      worldTerms,
      factions,      // new
      taboos,
      canonFacts,
      chapterMetas,
    ] = await Promise.all([
      db.characters.where('project_id').equals(projectId).toArray(),
      db.locations.where('project_id').equals(projectId).toArray(),
      db.objects.where('project_id').equals(projectId).toArray(),
      db.worldTerms.where('project_id').equals(projectId).toArray(),
      db.factions.where('project_id').equals(projectId).toArray(), // new
      db.taboos.where('project_id').equals(projectId).toArray(),
      db.canonFacts.where('project_id').equals(projectId).toArray(),
      db.chapterMeta.where('project_id').equals(projectId).toArray(),
    ]);
    set({
      characters,
      locations,
      objects,
      worldTerms,
      factions,      // new
      taboos,
      canonFacts,
      chapterMetas,
      loading: false,
    });
  },

  applyCompletionDelta: async ({
    projectId,
    chapterId = null,
    createdEntries = {},
    refreshProjection = false,
  }) => {
    if (!projectId) return;

    const updates = {};
    if (refreshProjection) {
      const [characters, objects, canonFacts] = await Promise.all([
        db.characters.where('project_id').equals(projectId).toArray(),
        db.objects.where('project_id').equals(projectId).toArray(),
        db.canonFacts.where('project_id').equals(projectId).toArray(),
      ]);
      updates.characters = characters;
      updates.objects = objects;
      updates.canonFacts = canonFacts;
    }

    if (chapterId) {
      const chapterMeta = await db.chapterMeta.where('chapter_id').equals(chapterId).first();
      updates.chapterMeta = chapterMeta || null;
    }

    set((state) => {
      const nextState = {
        locations: mergeByIdAndName(state.locations, createdEntries.locations || []),
        worldTerms: mergeByIdAndName(state.worldTerms, createdEntries.worldTerms || []),
      };

      nextState.characters = updates.characters
        || mergeByIdAndName(state.characters, createdEntries.characters || []);
      nextState.objects = updates.objects
        || mergeByIdAndName(state.objects, createdEntries.objects || []);

      if (updates.canonFacts) {
        nextState.canonFacts = updates.canonFacts;
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'chapterMeta')) {
        const remaining = state.chapterMetas.filter((item) => item.chapter_id !== chapterId);
        nextState.chapterMetas = updates.chapterMeta
          ? [...remaining, updates.chapterMeta]
          : remaining;
      }

      return nextState;
    });
  },

  // ---------------------------------------------
  // CHARACTERS
  // ---------------------------------------------
  createCharacter: async (data) => {
    const now = Date.now();
    const flawSuffixes = data.flaws
      ? [`\nDiem yeu: ${data.flaws}`]
      : [];
    let personality = data.personality || '';
    for (const suffix of flawSuffixes) {
      if (personality.endsWith(suffix)) {
        personality = personality.slice(0, -suffix.length);
        break;
      }
    }
    const id = await db.characters.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],          // new
      role: data.role || 'supporting',
      appearance: data.appearance || '',
      personality,
      flaws: data.flaws || '',
      personality_tags: data.personality_tags || '',
      pronouns_self: data.pronouns_self || '',
      pronouns_other: data.pronouns_other || '',
      speech_pattern: data.speech_pattern || '',
      current_status: data.current_status || '',
      goals: data.goals || '',
      secrets: data.secrets || '',
      notes: data.notes || '',
      story_function: data.story_function || '',
      source_chapter_id: data.source_chapter_id || null,
      source_kind: data.source_kind || '',
      created_at: now,
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateCharacter: async (id, data) => {
    await db.characters.update(id, data);
    set(state => ({
      characters: state.characters.map(c =>
        c.id === id ? { ...c, ...data } : c
      ),
    }));
  },

  deleteCharacter: async (id, projectId) => {
    await db.characters.delete(id);
    await db.taboos.where('character_id').equals(id).delete();
    if (projectId) await get().loadCodex(projectId);
  },

  // ---------------------------------------------
  // LOCATIONS
  // ---------------------------------------------
  createLocation: async (data) => {
    const id = await db.locations.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],          // new
      description: data.description || '',
      details: data.details || '',
      story_function: data.story_function || '',
      parent_location_id: data.parent_location_id || null,
      source_chapter_id: data.source_chapter_id || null,
      source_kind: data.source_kind || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateLocation: async (id, data) => {
    await db.locations.update(id, data);
    set(state => ({
      locations: state.locations.map(l =>
        l.id === id ? { ...l, ...data } : l
      ),
    }));
  },

  deleteLocation: async (id, projectId) => {
    await db.locations.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ---------------------------------------------
  // OBJECTS
  // ---------------------------------------------
  createObject: async (data) => {
    const id = await db.objects.add({
      project_id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      owner_character_id: data.owner_character_id || null,
      properties: data.properties || '',
      story_function: data.story_function || '',
      source_chapter_id: data.source_chapter_id || null,
      source_kind: data.source_kind || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateObject: async (id, data) => {
    await db.objects.update(id, data);
    set(state => ({
      objects: state.objects.map(o =>
        o.id === id ? { ...o, ...data } : o
      ),
    }));
  },

  deleteObject: async (id, projectId) => {
    await db.objects.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ---------------------------------------------
  // WORLD TERMS
  // ---------------------------------------------
  createWorldTerm: async (data) => {
    const id = await db.worldTerms.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],          // new
      definition: data.definition || '',
      category: data.category || 'other',
      story_function: data.story_function || '',
      source_chapter_id: data.source_chapter_id || null,
      source_kind: data.source_kind || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateWorldTerm: async (id, data) => {
    await db.worldTerms.update(id, data);
    set(state => ({
      worldTerms: state.worldTerms.map(t =>
        t.id === id ? { ...t, ...data } : t
      ),
    }));
  },

  deleteWorldTerm: async (id, projectId) => {
    await db.worldTerms.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ---------------------------------------------
  // FACTIONS - new in this store revision
  // ---------------------------------------------
  createFaction: async (data) => {
    const id = await db.factions.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],
      description: data.description || '',
      // sect | kingdom | organization | other
      faction_type: data.faction_type || 'sect',
      notes: data.notes || '',
      story_function: data.story_function || '',
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateFaction: async (id, data) => {
    await db.factions.update(id, data);
    set(state => ({
      factions: state.factions.map(f =>
        f.id === id ? { ...f, ...data } : f
      ),
    }));
  },

  deleteFaction: async (id, projectId) => {
    await db.factions.delete(id);
    if (projectId) await get().loadCodex(projectId);
  },

  // ---------------------------------------------
  // TABOOS
  // ---------------------------------------------
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
      taboos: state.taboos.map(t =>
        t.id === id ? { ...t, ...data } : t
      ),
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
        characterName:
          characters.find(c => c.id === t.character_id)?.name || 'Khong xac dinh',
      }));
  },

  // =============================================
  // CANON FACTS
  // =============================================
  createCanonFact: async (data) => {
    const id = await db.canonFacts.add({
      project_id: data.project_id,
      description: data.description || '',
      fact_type: data.fact_type || 'fact',   // fact | secret | rule
      status: data.status || 'active',       // active | deprecated
      source_chapter_id: data.source_chapter_id || null,
      created_at: Date.now(),
    });
    await get().loadCodex(data.project_id);
    return id;
  },

  updateCanonFact: async (id, data) => {
    await db.canonFacts.update(id, data);
    set(state => ({
      canonFacts: state.canonFacts.map(f =>
        f.id === id ? { ...f, ...data } : f
      ),
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
  // =============================================
  getChapterMeta: (chapterId) => {
    return get().chapterMetas.find(m => m.chapter_id === chapterId) || null;
  },

  saveChapterSummary: async (chapterId, projectId, summary, rawText = '') => {
    const existing = get().chapterMetas.find(m => m.chapter_id === chapterId);
    const now = Date.now();
    const lastProseBuffer = buildProseBuffer(rawText);
    if (existing) {
      const updates = { summary, updated_at: now };
      if (lastProseBuffer) updates.last_prose_buffer = lastProseBuffer;
      await db.chapterMeta.update(existing.id, updates);
      set(state => ({
        chapterMetas: state.chapterMetas.map(m =>
          m.id === existing.id ? { ...m, ...updates } : m
        ),
      }));
    } else {
      const id = await db.chapterMeta.add({
        chapter_id: chapterId,
        project_id: projectId,
        summary,
        last_prose_buffer: lastProseBuffer,
        created_at: now,
        updated_at: now,
      });
      set(state => ({
        chapterMetas: [
          ...state.chapterMetas,
          {
            id,
            chapter_id: chapterId,
            project_id: projectId,
            summary,
            last_prose_buffer: lastProseBuffer,
            created_at: now,
            updated_at: now,
          },
        ],
      }));
    }
  },

  // ---------------------------------------------
  // HELPERS for Context Engine
  //
  // All helpers below use matchesText(), which supports:
  //   1. Primary-name matching
  //   2. Alias matching
  //   3. Split-name matching for "A - B"
  // ---------------------------------------------

  /**
   * Find characters mentioned in text.
   */
  findCharactersInText: (text) => {
    if (!text) return [];
    const { characters } = get();
    const ct = cleanHtml(text);
    return characters.filter(c => matchesText(c, ct));
  },

  /**
   * Find locations mentioned in text.
   */
  findLocationsInText: (text) => {
    if (!text) return [];
    const { locations } = get();
    const ct = cleanHtml(text);
    return locations.filter(l => matchesText(l, ct));
  },

  /**
   * Find world terms and factions mentioned in text.
   * Factions are merged here so CodexPanel does not need another helper.
   */
  findTermsInText: (text) => {
    if (!text) return [];
    const { worldTerms, factions } = get();
    const ct = cleanHtml(text);
    return [
      ...worldTerms.filter(t => matchesText(t, ct)),
      ...factions.filter(f => matchesText(f, ct)),
    ];
  },

  /**
   * Find factions mentioned in text when a separate query is needed.
   */
  findFactionsInText: (text) => {
    if (!text) return [];
    const { factions } = get();
    const ct = cleanHtml(text);
    return factions.filter(f => matchesText(f, ct));
  },
}));

export default useCodexStore;
