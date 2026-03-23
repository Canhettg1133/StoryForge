/**
 * StoryForge — Context Engine v2 (Phase 4)
 * 
 * Phase 4:  Word boundary detection, relationships, scene contract, canon facts
 * Phase 7:  bridgeBuffer, previousEmotionalState
 * Phase 8:  currentChapterOutline, upcomingChapters
 *           → AI biết nhiệm vụ chương đang viết
 *           → AI biết KHÔNG được viết trước nội dung 3 chương tiếp theo
 * Phase 9:  currentArc, currentMacroArc
 *           → AI biết đang ở hồi nào, cột mốc lớn nào của đại cục
 *           → Ngăn AI cho nhân vật "lên cấp" vượt ngoài kế hoạch tổng thể
 */

import db from '../db/database';

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
}) {
  if (!projectId) {
    return {
      characters: [],
      locations: [],
      worldTerms: [],
      taboos: [],
      previousSummary: '',
      bridgeBuffer: '',
      previousEmotionalState: null,
      currentChapterOutline: null,
      upcomingChapters: [],
      currentArc: null,
      currentMacroArc: null,
      genre,
      relationships: [],
      sceneContract: {},
      canonFacts: [],
      aiGuidelines: '',
      aiStrictness: 'balanced',
    };
  }

  // Tất cả data load song song — chapters đã có sẵn, dùng lại cho outline, không tốn query thêm
  const [
    project, allCharacters, allLocations, allObjects, allTerms,
    allTaboos, chapterMetas, chapters, allRelationships, allCanonFacts,
  ] = await Promise.all([
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

  const aiGuidelines = project?.ai_guidelines || '';
  const aiStrictness = project?.ai_strictness || 'balanced';

  const cleanText = (sceneText || '').replace(/<[^>]*>/g, ' ').toLowerCase();

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

  const detectedCharacters = detectByName(allCharacters);
  const detectedLocations = detectByName(allLocations);
  const detectedObjects = detectByName(allObjects);
  const detectedTerms = detectByName(allTerms);

  // --- Active taboos ---
  const activeTaboos = allTaboos
    .filter(t => (chapterIndex + 1) < t.effective_before_chapter)
    .map(t => ({
      ...t,
      characterName: allCharacters.find(c => c.id === t.character_id)?.name || null,
    }));

  // --- Previous chapter: summary + Bridge Memory (Phase 7) ---
  let previousSummary = '';
  let bridgeBuffer = '';
  let previousEmotionalState = null;

  if (chapterIndex > 0) {
    const prevChapter = chapters.find(c => c.order_index === chapterIndex - 1);
    if (prevChapter) {
      const prevMeta = chapterMetas.find(m => m.chapter_id === prevChapter.id);
      if (prevMeta) {
        previousSummary = prevMeta.summary || '';
        bridgeBuffer = prevMeta.last_prose_buffer || '';
        previousEmotionalState = prevMeta.emotional_state || null;
      }
    }
  }

  // --- Phase 8: Chapter Outline Context ---
  //
  // Vấn đề cần giải quyết:
  //   Khi AI viết Chương N, nó không biết outline chương đó yêu cầu gì.
  //   Kết quả: AI tự bịa nội dung, hoặc "xài trước" nội dung của chương sau.
  //
  // Giải pháp:
  //   1. currentChapterOutline — outline của chương đang viết
  //      AI biết phạm vi nhiệm vụ: viết CÁI GÌ, không được vượt ra ngoài.
  //
  //   2. upcomingChapters — outline 3 chương tiếp theo (chỉ title + summary)
  //      AI biết những gì SẼ xảy ra ở chương sau → không viết trước.
  //      Giới hạn 3 chương để không tốn token thừa.
  //
  // Zero DB query thêm — chapters đã load ở Promise.all trên.

  const currentRaw = chapters.find(c => c.order_index === chapterIndex);
  const currentChapterOutline = currentRaw
    ? {
      title: currentRaw.title || '',
      summary: currentRaw.summary || '',
      keyEvents: (() => {
        try { return JSON.parse(currentRaw.key_events || '[]'); } catch { return []; }
      })(),
    }
    : null;

  const upcomingChapters = chapters
    .filter(c => c.order_index > chapterIndex && c.order_index <= chapterIndex + 3)
    .map(c => ({ title: c.title || '', summary: c.summary || '' }))
    .filter(c => c.title || c.summary); // bỏ chương trống hoàn toàn

  // --- Phase 9: Arc & Macro Arc Context ---
  //
  // Mục đích:
  //   Từ chương hiện tại → tìm arc_id → load arc → tìm macro_arc_id → load macro arc.
  //   Chuỗi: chapter.arc_id → arcs → macro_arc_id → macro_arcs.
  //
  // Kết quả được inject vào Layer 0 của promptBuilder (Grand Strategy).
  // AI sẽ biết:
  //   - Đang ở hồi nào (currentArc.title, currentArc.goal)
  //   - Cột mốc lớn nào của đại cục (currentMacroArc.title, emotional_peak)
  //   - Không được vượt qua ranh giới power level của arc này
  //
  // 2 query nhỏ (get by id), non-blocking nếu bảng chưa có dữ liệu.

  let currentArc = null;
  let currentMacroArc = null;

  if (currentRaw?.arc_id) {
    try {
      currentArc = await db.arcs.get(currentRaw.arc_id);
      if (currentArc?.macro_arc_id) {
        currentMacroArc = await db.macro_arcs.get(currentArc.macro_arc_id);
      }
    } catch (e) {
      // Non-fatal: tables có thể chưa có data nếu tác giả chưa tạo đại cục
      console.warn('[Context] Failed to load arc/macro arc (non-fatal):', e);
    }
  }

  // --- Relationships for detected characters ---
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

  // --- Scene Contract ---
  let sceneContract = {};
  if (sceneId) {
    const scene = await db.scenes.get(sceneId);
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
  const canonFacts = allCanonFacts.filter(f => {
    if (f.status !== 'active') return false;
    if (f.fact_type === 'secret' && f.revealed_at_chapter && f.revealed_at_chapter <= chapterIndex + 1) {
      return false;
    }
    return true;
  });

  // --- Plot Threads ---
  let activePlotThreads = [];
  try {
    const allThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
    activePlotThreads = allThreads.filter(pt => pt.state === 'active');

    if (sceneId) {
      const beats = await db.threadBeats.where('scene_id').equals(sceneId).toArray();
      const beatThreadIds = beats.map(b => b.plot_thread_id);
      activePlotThreads = activePlotThreads.map(pt => ({
        ...pt,
        is_focus_in_scene: beatThreadIds.includes(pt.id),
      }));
    }
  } catch (e) {
    console.error('Error loading plot threads in context engine:', e);
  }

  return {
    characters: detectedCharacters,
    locations: detectedLocations,
    objects: detectedObjects,
    worldTerms: detectedTerms,
    taboos: activeTaboos,
    previousSummary,
    // Phase 7
    bridgeBuffer,
    previousEmotionalState,
    // Phase 8
    currentChapterOutline,
    upcomingChapters,
    // Phase 9
    currentArc,
    currentMacroArc,
    worldProfile,
    genre,
    allCharacters,
    aiGuidelines,
    aiStrictness,
    relationships,
    sceneContract,
    canonFacts,
    plotThreads: activePlotThreads,
    targetLength,
    targetLengthType,
    ultimateGoal,
    milestones,
    currentChapterIndex: chapterIndex,
  };
}

export default { gatherContext };