/**
 * StoryForge — Codex Store (Phase 3 + Patch: Factions & Aliases)
 *
 * Zustand store for Characters, Locations, Objects, World Terms,
 * Factions, Taboos, ChapterMeta, CanonFacts.
 *
 * Thay đổi so với bản cũ:
 *  - Thêm `factions` state + CRUD (Thế lực / Tông môn)
 *  - Thêm field `aliases` vào Character, Location, WorldTerm, Faction
 *  - Nâng cấp find*InText: hỗ trợ aliases + auto-split tên dạng "A - B"
 */

import { create } from 'zustand';
import db from '../services/db/database';
import { buildProseBuffer } from '../utils/proseBuffer';

// ─────────────────────────────────────────────
// Helper: kiểm tra 1 entry có xuất hiện trong text không
// Kiểm tra: name chính + aliases + auto-split "A - B"
// ─────────────────────────────────────────────
function matchesText(entry, cleanText) {
  if (!entry?.name) return false;

  const candidates = [
    entry.name,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    // auto-split "Thanh Vân Tông - Tạp Vật Viện" → ["Thanh Vân Tông", "Tạp Vật Viện"]
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

// ─────────────────────────────────────────────

const useCodexStore = create((set, get) => ({
  // --- State ---
  characters: [],
  locations: [],
  objects: [],
  worldTerms: [],
  factions: [],       // [MỚI] Thế lực / Tông môn
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
      factions,      // [MỚI]
      taboos,
      canonFacts,
      chapterMetas,
    ] = await Promise.all([
      db.characters.where('project_id').equals(projectId).toArray(),
      db.locations.where('project_id').equals(projectId).toArray(),
      db.objects.where('project_id').equals(projectId).toArray(),
      db.worldTerms.where('project_id').equals(projectId).toArray(),
      db.factions.where('project_id').equals(projectId).toArray(), // [MỚI]
      db.taboos.where('project_id').equals(projectId).toArray(),
      db.canonFacts.where('project_id').equals(projectId).toArray(),
      db.chapterMeta.where('project_id').equals(projectId).toArray(),
    ]);
    set({
      characters,
      locations,
      objects,
      worldTerms,
      factions,      // [MỚI]
      taboos,
      canonFacts,
      chapterMetas,
      loading: false,
    });
  },

  // ═══════════════════════════════════════════
  // CHARACTERS
  // ═══════════════════════════════════════════
  createCharacter: async (data) => {
    const now = Date.now();
    const flawSuffixes = data.flaws
      ? [`\nĐiểm yếu: ${data.flaws}`]
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
      aliases: data.aliases || [],          // [MỚI]
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

  // ═══════════════════════════════════════════
  // LOCATIONS
  // ═══════════════════════════════════════════
  createLocation: async (data) => {
    const id = await db.locations.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],          // [MỚI]
      description: data.description || '',
      details: data.details || '',
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

  // ═══════════════════════════════════════════
  // WORLD TERMS (Thuật ngữ)
  // ═══════════════════════════════════════════
  createWorldTerm: async (data) => {
    const id = await db.worldTerms.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],          // [MỚI]
      definition: data.definition || '',
      category: data.category || 'other',
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

  // ═══════════════════════════════════════════
  // FACTIONS (Thế lực / Tông môn) — [MỚI]
  // ═══════════════════════════════════════════
  createFaction: async (data) => {
    const id = await db.factions.add({
      project_id: data.project_id,
      name: data.name || '',
      aliases: data.aliases || [],
      description: data.description || '',
      // sect | kingdom | organization | other
      faction_type: data.faction_type || 'sect',
      notes: data.notes || '',
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
          characters.find(c => c.id === t.character_id)?.name || 'Không xác định',
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

  // ═══════════════════════════════════════════
  // HELPERS for Context Engine
  //
  // Tất cả đều dùng matchesText() — hỗ trợ:
  //   1. Khớp tên chính xác
  //   2. Khớp aliases (biệt danh / cách gọi khác)
  //   3. Auto-split "A - B" → khớp "A" hoặc "B" riêng lẻ
  // ═══════════════════════════════════════════

  /**
   * Tìm nhân vật xuất hiện trong văn bản.
   */
  findCharactersInText: (text) => {
    if (!text) return [];
    const { characters } = get();
    const ct = cleanHtml(text);
    return characters.filter(c => matchesText(c, ct));
  },

  /**
   * Tìm địa điểm xuất hiện trong văn bản.
   */
  findLocationsInText: (text) => {
    if (!text) return [];
    const { locations } = get();
    const ct = cleanHtml(text);
    return locations.filter(l => matchesText(l, ct));
  },

  /**
   * Tìm thuật ngữ VÀ thế lực xuất hiện trong văn bản.
   * Factions được gộp vào đây để CodexPanel không cần gọi thêm hàm mới.
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
   * Tìm thế lực xuất hiện trong văn bản (nếu cần tách riêng).
   */
  findFactionsInText: (text) => {
    if (!text) return [];
    const { factions } = get();
    const ct = cleanHtml(text);
    return factions.filter(f => matchesText(f, ct));
  },
}));

export default useCodexStore;
