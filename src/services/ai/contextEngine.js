/**
 * StoryForge - Context Engine v2 (Phase 4)
 * 
 * Phase 4:  Word boundary detection, relationships, scene contract, canon facts
 * Phase 7:  bridgeBuffer, previousEmotionalState
 * Phase 8:  currentChapterOutline, upcomingChapters
 *           - AI knows the current chapter objective
 *           - AI must not write ahead into the next 3 chapters
 * Phase 9:  currentArc, currentMacroArc
 *           - AI knows the current arc and macro arc
 *           - Prevents premature power jumps outside the overall plan
 */

import db from '../db/database';
import { detectWritingStyle } from '../../utils/constants';
import { buildProseBuffer } from '../../utils/proseBuffer';
import { buildRetrievalPacket, buildCharacterStateSummary } from '../canon/engine';
import { TASK_TYPES } from './router';
import {
  buildChapterBlueprintContext,
  normalizeChapterListField,
  validateChapterWritingReadiness,
} from './blueprintGuardrails';

function resolveRetrievalMode(taskType, explicitMode) {
  if (explicitMode) return explicitMode;
  if (!taskType) return 'standard';
  if ([
    TASK_TYPES.CONTINUE,
    TASK_TYPES.SCENE_DRAFT,
    TASK_TYPES.ARC_CHAPTER_DRAFT,
    TASK_TYPES.REWRITE,
    TASK_TYPES.EXPAND,
    TASK_TYPES.FREE_PROMPT,
  ].includes(taskType)) {
    return 'near_memory_3';
  }
  if ([
    TASK_TYPES.CHAPTER_SUMMARY,
    TASK_TYPES.FEEDBACK_EXTRACT,
    TASK_TYPES.EXTRACT_TERMS,
  ].includes(taskType)) {
    return 'compact';
  }
  return 'standard';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function gatherContext({
  projectId,
  chapterId,
  chapterIndex = 0,
  sceneId,
  sceneText = '',
  genre = '',
  taskType = null,
  retrievalMode = '',
}) {
  if (!projectId) {
    return {
      characters: [],
      locations: [],
      factions: [],
      worldTerms: [],
      taboos: [],
      previousSummary: '',
      bridgeBuffer: '',
      previousEmotionalState: null,
      currentChapterOutline: null,
      chapterBlueprintContext: null,
      preWriteValidation: { blockingIssues: [], warnings: [] },
      upcomingChapters: [],
      currentArc: null,
      currentMacroArc: null,
      writingStyle: 'thuan_viet',
      genre,
      relationships: [],
      sceneContract: {},
      canonFacts: [],
      aiGuidelines: '',
      aiStrictness: 'balanced',
    };
  }

  // Load all context in parallel and reuse chapter data for outline/context work.
  const [
    project, allCharacters, allLocations, allObjects, allTerms, allFactions,
    allTaboos, chapterMetas, chapters, allRelationships, allCanonFacts, allThreads,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.worldTerms.where('project_id').equals(projectId).toArray(),
    db.factions.where('project_id').equals(projectId).toArray(),
    db.taboos.where('project_id').equals(projectId).toArray(),
    db.chapterMeta.where('project_id').equals(projectId).toArray(),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.relationships.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
  ]);

  const requestedChapter = chapterId
    ? chapters.find((chapter) => chapter.id === chapterId) || null
    : null;
  const resolvedChapter = requestedChapter
    || chapters.find((chapter) => chapter.order_index === chapterIndex)
    || chapters[0]
    || null;
  const resolvedChapterIndex = Number.isFinite(resolvedChapter?.order_index)
    ? resolvedChapter.order_index
    : (Number.isFinite(chapterIndex) ? chapterIndex : 0);

  // World Profile
  let worldRules = [];
  try { worldRules = JSON.parse(project?.world_rules || '[]'); } catch { }
  const worldProfile = {
    name: project?.world_name || '',
    type: project?.world_type || '',
    scale: project?.world_scale || '',
    era: project?.world_era || '',
    rules: worldRules,
    description: project?.world_description || '',
  };

  const targetLength = project?.target_length || 0;
  const targetLengthType = project?.target_length_type || 'unset';
  const ultimateGoal = project?.ultimate_goal || '';
  let milestones = [];
  try { milestones = JSON.parse(project?.milestones || '[]'); } catch { }
  let promptTemplates = {};
  if (project?.prompt_templates) {
    try { promptTemplates = JSON.parse(project.prompt_templates); } catch { }
  }

  const aiGuidelines = project?.ai_guidelines || '';
  const aiStrictness = project?.ai_strictness || 'balanced';
  const nsfwMode = project?.nsfw_mode || false;
  const superNsfwMode = project?.super_nsfw_mode || false;
  const genreKey = (genre || '').toLowerCase().replace(/\s+/g, '_');

  const cleanText = (sceneText || '').replace(/<[^>]*>/g, ' ').toLowerCase();

  // Cache scene once for reuse in bootstrap and scene contract
  const cachedScene = sceneId ? await db.scenes.get(sceneId).catch(() => null) : null;

  // --- Entity detection (word boundary) ---
  function detectByName(list) {
    return list.filter(item => {
      if (!item.name || item.name.length < 2) return false;
      try {
        const rx = new RegExp(
          `(?:^|\\s|[,."'!?;:()\\[\\]{}])${escapeRegex(item.name.toLowerCase())}(?:\\s|[,."'!?;:()\\[\\]{}]|$)`,
          'i'
        );
        return rx.test(cleanText);
      } catch {
        return cleanText.includes(item.name.toLowerCase());
      }
    });
  }

  function mergeById(primary = [], secondary = []) {
    const seen = new Set();
    return [...primary, ...secondary].filter((item) => {
      const key = item?.id ?? item?.name;
      if (key == null || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const detectedCharacters = detectByName(allCharacters);

  // [FIX] Bootstrap character context for an empty new scene.
  // If the scene is blank, seed POV/characters_present from stored chapter data.
  if (sceneId && detectedCharacters.length === 0) {
    try {
      // Find scene manually since we only have ID at this point, but actually we do load it below.
      // However doing it quickly via memory is fine if we loaded them, but we don't have allScenes.
      // We will just do a quick DB fetch.
      const scene = cachedScene;
      if (scene) {
        const povChar = allCharacters.find(c => c.id === scene.pov_character_id);
        if (povChar && !detectedCharacters.some(c => c.id === povChar.id)) {
          detectedCharacters.push(povChar);
        }
        const presentIds = JSON.parse(scene.characters_present || '[]');
        presentIds.forEach(id => {
          const c = allCharacters.find(char => char.id === id);
          if (c && !detectedCharacters.some(extC => extC.id === c.id)) {
            detectedCharacters.push(c);
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  const detectedLocations = detectByName(allLocations);
  const detectedObjects = detectByName(allObjects);
  const detectedTerms = detectByName(allTerms);
  const detectedFactions = detectByName(allFactions);

  // --- Active taboos ---
  const activeTaboos = allTaboos
    .filter(t => (resolvedChapterIndex + 1) < t.effective_before_chapter)
    .map(t => ({
      ...t,
      characterName: allCharacters.find(c => c.id === t.character_id)?.name || null,
    }));

  // --- Previous chapter: summary + Bridge Memory (Phase 7) ---
  let previousSummary = '';
  let bridgeBuffer = '';
  let previousEmotionalState = null;

  if (resolvedChapterIndex > 0) {
    const prevChapter = chapters.find(c => c.order_index === resolvedChapterIndex - 1);
    if (prevChapter) {
      const prevMeta = chapterMetas.find(m => m.chapter_id === prevChapter.id);
      if (prevMeta) {
        previousSummary = prevMeta.summary || '';
        bridgeBuffer = prevMeta.last_prose_buffer || '';
        previousEmotionalState = prevMeta.emotional_state || null;
      }

      // Fallback for chapters that only have outline data or were imported/generated
      // before chapterMeta existed.
      if (!previousSummary && prevChapter.summary) {
        previousSummary = prevChapter.summary;
      }

      if (!bridgeBuffer) {
        try {
          const prevScenes = await db.scenes.where('chapter_id').equals(prevChapter.id).sortBy('order_index');
          const prevChapterText = prevScenes
            .map((scene) => scene.draft_text || scene.final_text || '')
            .join('\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .trim();
          if (prevChapterText) {
            bridgeBuffer = buildProseBuffer(prevChapterText);
          }
        } catch (e) {
          console.warn('[Context] Failed to build fallback bridge buffer (non-fatal):', e);
        }
      }
    }
  }

  // --- Phase 8: Chapter Outline Context ---
  //
  // Phase 8 rationale:
  // 1. currentChapterOutline defines what this chapter is allowed to do.
  // 2. upcomingChapters fences off near-future beats so the AI does not write ahead.
  // Reuses the chapter list already loaded above, so no extra DB query is needed.

  const currentRaw = resolvedChapter;
  const chapterBlueprintContext = buildChapterBlueprintContext({
    chapter: currentRaw,
    allCharacters,
    allLocations,
    allObjects,
    allFactions,
    allTerms,
    plotThreads: allThreads,
  });
  const currentChapterOutline = currentRaw
    ? {
      title: currentRaw.title || '',
      summary: currentRaw.summary || '',
      purpose: currentRaw.purpose || '',
      featuredCharacters: normalizeChapterListField(currentRaw.featured_characters),
      primaryLocation: currentRaw.primary_location || '',
      threadTitles: normalizeChapterListField(currentRaw.thread_titles),
      requiredFactions: normalizeChapterListField(currentRaw.required_factions),
      requiredObjects: normalizeChapterListField(currentRaw.required_objects),
      keyEvents: (() => {
        try {
          const raw = currentRaw.key_events || '[]';
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return normalizeChapterListField(currentRaw.key_events);
        }
      })(),
    }
    : null;

  const upcomingChapters = chapters
    .filter(c => c.order_index > resolvedChapterIndex && c.order_index <= resolvedChapterIndex + 3)
    .map(c => ({ title: c.title || '', summary: c.summary || '' }))
    .filter(c => c.title || c.summary); // Skip completely empty chapter stubs.

  const blueprintCharacters = chapterBlueprintContext?.relatedCharacters || [];
  const blueprintLocations = chapterBlueprintContext?.relatedLocations || [];
  const blueprintObjects = chapterBlueprintContext?.relatedObjects || [];
  const blueprintTerms = chapterBlueprintContext?.relatedTerms || [];
  const blueprintFactions = chapterBlueprintContext?.relatedFactions || [];

  const effectiveCharacters = mergeById(detectedCharacters, blueprintCharacters);
  const effectiveLocations = mergeById(detectedLocations, blueprintLocations);
  const effectiveObjects = mergeById(detectedObjects, blueprintObjects);
  const effectiveTerms = mergeById(detectedTerms, blueprintTerms);
  const effectiveFactions = mergeById(detectedFactions, blueprintFactions);

  // --- Phase 9: Arc & Macro Arc Context ---
  //
  // Phase 9 rationale:
  // Resolve chapter -> arc -> macro arc and inject that into Grand Strategy.
  // This gives the prompt the current arc boundary without blocking if tables are empty.

  let currentArc = null;
  let currentMacroArc = null;

  if (currentRaw?.arc_id) {
    try {
      currentArc = await db.arcs.get(currentRaw.arc_id);
      if (currentArc?.macro_arc_id) {
        currentMacroArc = await db.macro_arcs.get(currentArc.macro_arc_id);
      }
    } catch (e) {
      // Non-fatal: these tables may still be empty in older projects.
      console.warn('[Context] Failed to load arc/macro arc (non-fatal):', e);
    }
  }

  // --- Relationships for detected characters ---
  const detectedCharIds = new Set(effectiveCharacters.map(c => c.id));
  const RELATION_LABELS = {
    ally: 'Đồng minh', enemy: 'Kẻ thù', lover: 'Người yêu',
    family: 'Gia đình', mentor: 'Sư phụ/Cố vấn', rival: 'Đối thủ',
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

  // --- Scene Contract ---
  let sceneContract = {};
  if (sceneId) {
    const scene = cachedScene;
    if (scene) {
      let mustHappen = [], mustNotHappen = [], charactersPresent = [];
      try { mustHappen = JSON.parse(scene.must_happen || '[]'); } catch { }
      try { mustNotHappen = JSON.parse(scene.must_not_happen || '[]'); } catch { }
      try { charactersPresent = JSON.parse(scene.characters_present || '[]'); } catch { }

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

  // --- Canon Facts ---
  const canonFacts = allCanonFacts
    .filter(f => f.status === 'active')
    .map((fact) => {
      if (fact.fact_type !== 'secret' || !fact.revealed_at_chapter) {
        return fact;
      }

      // Once a secret has been revealed by the current chapter, treat it as an
      // established fact in the prompt instead of hiding it completely.
      if (fact.revealed_at_chapter <= resolvedChapterIndex + 1) {
        return { ...fact, fact_type: 'fact' };
      }

      return fact;
    });

  // --- Plot Threads ---
  let activePlotThreads = [];
  activePlotThreads = allThreads.filter(pt => pt.state === 'active');

  if (sceneId) {
    try {
      const beats = await db.threadBeats.where('scene_id').equals(sceneId).toArray();
      const beatThreadIds = beats.map(b => b.plot_thread_id);
      activePlotThreads = activePlotThreads.map(pt => ({
        ...pt,
        is_focus_in_scene: beatThreadIds.includes(pt.id),
      }));
    } catch (e) {
      console.error('Error loading plot thread beats in context engine:', e);
    }
  }

  let retrievalPacket = null;
  try {
    retrievalPacket = await buildRetrievalPacket({
      projectId,
      chapterId,
      sceneId,
      detectedCharacterIds: effectiveCharacters.map((character) => character.id),
      detectedObjectIds: effectiveObjects.map((object) => object.id),
      mode: resolveRetrievalMode(taskType, retrievalMode),
    });
  } catch (e) {
    console.warn('[Context] Failed to build retrieval packet (non-fatal):', e);
  }

  const canonStateByCharacterId = new Map(
    (retrievalPacket?.relevantEntityStates || []).map((state) => [state.entity_id, state])
  );
  const hydratedCharacters = effectiveCharacters.map((character) => {
    const canonState = canonStateByCharacterId.get(character.id);
    if (!canonState) return character;
    return {
      ...character,
      canon_state: canonState,
      current_status: buildCharacterStateSummary(canonState, character.current_status || ''),
      goals: Array.isArray(canonState.goals_active) && canonState.goals_active.length > 0
        ? canonState.goals_active.join(', ')
        : character.goals,
      allegiance: canonState.allegiance || character.allegiance || '',
    };
  });

  if (retrievalPacket?.activeThreadStates?.length > 0) {
    const threadStateMap = new Map(retrievalPacket.activeThreadStates.map((state) => [state.thread_id, state]));
    activePlotThreads = activePlotThreads.map((thread) => {
      const canonThreadState = threadStateMap.get(thread.id);
      return canonThreadState
        ? {
          ...thread,
          state: canonThreadState.state,
          description: canonThreadState.summary || thread.description || '',
          canon_state: canonThreadState,
        }
        : thread;
    });
  }

  const effectiveCanonFacts = retrievalPacket?.factStates?.length > 0
    ? retrievalPacket.factStates
    : canonFacts;

  const preWriteValidation = validateChapterWritingReadiness({
    chapterBlueprintContext,
    sceneContract,
    sceneText,
  });

  return {
    characters: hydratedCharacters,
    locations: effectiveLocations,
    objects: effectiveObjects,
    factions: effectiveFactions,
    worldTerms: effectiveTerms,
    taboos: activeTaboos,
    previousSummary,
    // Phase 7
    bridgeBuffer,
    previousEmotionalState,
    // Phase 8
    currentChapterOutline,
    chapterBlueprintContext,
    preWriteValidation,
    upcomingChapters,
    // Phase 9
    currentArc,
    currentMacroArc,
    // Soul injection: auto-detect writing style from genre.
    writingStyle: detectWritingStyle(genreKey || genre?.toLowerCase().replace(/\s+/g, '_') || ''),
    worldProfile,
    genre,
    allCharacters,
    aiGuidelines,
    aiStrictness,
    relationships,
    sceneContract,
    canonFacts: effectiveCanonFacts,
    plotThreads: activePlotThreads,
    targetLength,
    targetLengthType,
    ultimateGoal,
    milestones,
    promptTemplates,
    nsfwMode,
    superNsfwMode,
    currentChapterIndex: resolvedChapterIndex,
    retrievalPacket,
  };
}

export default { gatherContext };
