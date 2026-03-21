/**
 * StoryForge — Context Engine v2 (Phase 4)
 * 
 * The "brain" of Memory. Before every AI call, this module automatically
 * gathers relevant context from the Codex and returns a structured object
 * to be injected into the 8-layer prompt.
 * 
 * Phase 4 additions:
 *   - Word boundary entity detection (fixes false positives)
 *   - Relationships loading for detected characters
 *   - Scene Contract data
 *   - Canon Facts loading
 *   - ai_guidelines & ai_strictness passthrough
 */

import db from '../db/database';

// Escape special regex characters in a string
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gather all relevant context for an AI call.
 * 
 * @param {object} params
 * @param {number} params.projectId
 * @param {number} params.chapterId - current chapter ID
 * @param {number} params.chapterIndex - current chapter order_index (0-based)
 * @param {number} params.sceneId - current scene ID
 * @param {string} params.sceneText - current scene text (HTML or plain)
 * @param {string} params.genre - project genre
 * @returns {Promise<object>} context object for promptBuilder
 */
export async function gatherContext({
  projectId,
  chapterId,
  chapterIndex = 0,
  sceneId,
  sceneText = '',
  genre = '',
}) {
  if (!projectId) {
    return {
      characters: [],
      locations: [],
      worldTerms: [],
      taboos: [],
      previousSummary: '',
      genre,
      relationships: [],
      sceneContract: {},
      canonFacts: [],
      aiGuidelines: '',
      aiStrictness: 'balanced',
    };
  }

  // Load all codex data in parallel
  const [project, allCharacters, allLocations, allObjects, allTerms, allTaboos, chapterMetas, chapters, allRelationships, allCanonFacts] =
    await Promise.all([
      db.projects.get(projectId),
      db.characters.where('project_id').equals(projectId).toArray(),
      db.locations.where('project_id').equals(projectId).toArray(),
      db.objects.where('project_id').equals(projectId).toArray(),
      db.worldTerms.where('project_id').equals(projectId).toArray(),
      db.taboos.where('project_id').equals(projectId).toArray(),
      db.chapterMeta.where('project_id').equals(projectId).toArray(),
      db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
      db.relationships.where('project_id').equals(projectId).toArray(),
      db.canonFacts.where('project_id').equals(projectId).toArray(),
    ]);

  // World Profile
  let worldRules = [];
  try { worldRules = JSON.parse(project?.world_rules || '[]'); } catch {}
  const worldProfile = {
    name: project?.world_name || '',
    type: project?.world_type || '',
    scale: project?.world_scale || '',
    era: project?.world_era || '',
    rules: worldRules,
    description: project?.world_description || '',
  };

  // AI settings from project
  const aiGuidelines = project?.ai_guidelines || '';
  const aiStrictness = project?.ai_strictness || 'balanced';

  // Clean text for matching
  const cleanText = (sceneText || '').replace(/<[^>]*>/g, ' ').toLowerCase();

  // --- Detect characters in current scene text (word boundary) ---
  const detectedCharacters = allCharacters.filter(c => {
    if (!c.name || c.name.length < 2) return false;
    try {
      const regex = new RegExp(`(?:^|\\s|[,."'!?;:()\\[\\]{}])${escapeRegex(c.name.toLowerCase())}(?:\\s|[,."'!?;:()\\[\\]{}]|$)`, 'i');
      return regex.test(cleanText);
    } catch {
      return cleanText.includes(c.name.toLowerCase());
    }
  });

  // --- Detect locations in current scene text ---
  const detectedLocations = allLocations.filter(l => {
    if (!l.name || l.name.length < 2) return false;
    try {
      const regex = new RegExp(`(?:^|\\s|[,."'!?;:()\\[\\]{}])${escapeRegex(l.name.toLowerCase())}(?:\\s|[,."'!?;:()\\[\\]{}]|$)`, 'i');
      return regex.test(cleanText);
    } catch {
      return cleanText.includes(l.name.toLowerCase());
    }
  });

  // --- Detect objects in current scene text ---
  const detectedObjects = allObjects.filter(o => {
    if (!o.name || o.name.length < 2) return false;
    try {
      const regex = new RegExp(`(?:^|\\s|[,."'!?;:()\\[\\]{}])${escapeRegex(o.name.toLowerCase())}(?:\\s|[,."'!?;:()\\[\\]{}]|$)`, 'i');
      return regex.test(cleanText);
    } catch {
      return cleanText.includes(o.name.toLowerCase());
    }
  });

  // --- Detect world terms in current scene text ---
  const detectedTerms = allTerms.filter(t => {
    if (!t.name || t.name.length < 2) return false;
    try {
      const regex = new RegExp(`(?:^|\\s|[,."'!?;:()\\[\\]{}])${escapeRegex(t.name.toLowerCase())}(?:\\s|[,."'!?;:()\\[\\]{}]|$)`, 'i');
      return regex.test(cleanText);
    } catch {
      return cleanText.includes(t.name.toLowerCase());
    }
  });

  // --- Get active taboos for current chapter ---
  const activeTaboos = allTaboos
    .filter(t => (chapterIndex + 1) < t.effective_before_chapter)
    .map(t => ({
      ...t,
      characterName: allCharacters.find(c => c.id === t.character_id)?.name || null,
    }));

  // --- Get previous chapter summary ---
  let previousSummary = '';
  if (chapterIndex > 0) {
    const prevChapter = chapters.find(c => c.order_index === chapterIndex - 1);
    if (prevChapter) {
      const prevMeta = chapterMetas.find(m => m.chapter_id === prevChapter.id);
      previousSummary = prevMeta?.summary || '';
    }
  }

  // --- Phase 4: Relationships for detected characters ---
  const detectedCharIds = new Set(detectedCharacters.map(c => c.id));
  const RELATION_LABELS = {
    ally: 'Đồng minh', enemy: 'Kẻ thù', lover: 'Người yêu',
    family: 'Gia đình', mentor: 'Sư phụ/Đồ đệ', rival: 'Đối thủ',
    friend: 'Bạn bè', subordinate: 'Cấp dưới/Cấp trên', other: 'Khác',
  };
  const relationships = allRelationships
    .filter(r => detectedCharIds.has(r.character_a_id) || detectedCharIds.has(r.character_b_id))
    .map(r => ({
      charA: allCharacters.find(c => c.id === r.character_a_id)?.name || '???',
      charB: allCharacters.find(c => c.id === r.character_b_id)?.name || '???',
      label: RELATION_LABELS[r.relation_type] || r.relation_type,
      description: r.description || '',
    }));

  // --- Phase 4: Scene Contract data ---
  let sceneContract = {};
  if (sceneId) {
    const scene = await db.scenes.get(sceneId);
    if (scene) {
      let mustHappen = [];
      let mustNotHappen = [];
      let charactersPresent = [];
      try { mustHappen = JSON.parse(scene.must_happen || '[]'); } catch {}
      try { mustNotHappen = JSON.parse(scene.must_not_happen || '[]'); } catch {}
      try { charactersPresent = JSON.parse(scene.characters_present || '[]'); } catch {}

      sceneContract = {
        goal: scene.goal || '',
        conflict: scene.conflict || '',
        emotional_start: scene.emotional_start || '',
        emotional_end: scene.emotional_end || '',
        pov_character: allCharacters.find(c => c.id === scene.pov_character_id)?.name || '',
        location: allLocations.find(l => l.id === scene.location_id)?.name || '',
        must_happen: mustHappen,
        must_not_happen: mustNotHappen,
        pacing: scene.pacing || '',
        characters_present: charactersPresent
          .map(id => allCharacters.find(c => c.id === id)?.name)
          .filter(Boolean),
      };
    }
  }

  // --- Phase 4: Canon Facts (filter secrets by chapter) ---
  const canonFacts = allCanonFacts.filter(f => {
    if (f.status !== 'active') return false;
    // Secrets that have been revealed before current chapter are just facts now
    if (f.fact_type === 'secret' && f.revealed_at_chapter && f.revealed_at_chapter <= chapterIndex + 1) {
      return false; // Already revealed, skip
    }
    return true;
  });

  return {
    characters: detectedCharacters,
    locations: detectedLocations,
    objects: detectedObjects,
    worldTerms: detectedTerms,
    taboos: activeTaboos,
    previousSummary,
    worldProfile,
    genre,
    allCharacters,
    // Phase 4 additions
    aiGuidelines,
    aiStrictness,
    relationships,
    sceneContract,
    canonFacts,
  };
}

export default { gatherContext };
