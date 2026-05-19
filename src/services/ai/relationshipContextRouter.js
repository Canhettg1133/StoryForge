const RELATION_LABELS = {
  ally: 'Đồng minh',
  enemy: 'Kẻ thù',
  lover: 'Người yêu',
  family: 'Gia đình',
  mentor: 'Sư phụ/Cố vấn',
  rival: 'Đối thủ',
  friend: 'Bạn bè',
  subordinate: 'Cấp dưới/Cấp trên',
  other: 'Khác',
};

const RELATIONSHIP_OP_TYPES = new Set([
  'RELATIONSHIP_STATUS_CHANGED',
  'RELATIONSHIP_SECRET_CHANGED',
  'INTIMACY_LEVEL_CHANGED',
]);

const CRITICAL_RELATION_TYPES = new Set(['enemy', 'rival', 'lover']);
const BASELINE_IMPORTANT_TYPES = new Set(['enemy', 'rival', 'lover', 'family', 'mentor']);
const WEAK_BASELINE_TYPES = new Set(['ally', 'friend', 'other', '']);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRelationshipPairKey(characterAId, characterBId) {
  const left = String(characterAId ?? '').trim();
  const right = String(characterBId ?? '').trim();
  const bothNumeric = left !== '' && right !== ''
    && Number.isFinite(Number(left))
    && Number.isFinite(Number(right));
  return [left, right]
    .sort((a, b) => (bothNumeric ? Number(a) - Number(b) : a.localeCompare(b, 'en')))
    .join(':');
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function addId(set, value) {
  if (value == null || value === '') return;
  const numeric = Number(value);
  set.add(Number.isFinite(numeric) ? numeric : value);
}

function collectCharacterIds(items = []) {
  const ids = new Set();
  (items || []).forEach((item) => {
    const character = item?.character || item;
    addId(ids, character?.id);
  });
  return ids;
}

function collectMentionText({
  userPrompt = '',
  currentChapterOutline = null,
  currentArc = null,
  currentMacroArc = null,
} = {}) {
  const outline = currentChapterOutline || {};
  const arc = currentArc || {};
  const macro = currentMacroArc || {};
  return [
    userPrompt,
    outline.title,
    outline.summary,
    outline.purpose,
    outline.conflict,
    outline.stateDelta,
    outline.state_delta,
    outline.decisionOrConsequence,
    outline.decision_or_consequence,
    ...parseList(outline.featuredCharacters),
    ...parseList(outline.featured_characters),
    ...parseList(outline.keyEvents),
    ...parseList(outline.key_events),
    arc.title,
    arc.goal,
    arc.description,
    macro.title,
    macro.goal,
    macro.description,
  ].filter(Boolean).join('\n');
}

function characterMentioned(character, normalizedMentionText) {
  const terms = [character?.name, ...(parseList(character?.aliases))]
    .map(normalizeText)
    .filter(Boolean);
  if (!normalizedMentionText || terms.length === 0) return false;
  return terms.some((term) => {
    try {
      return new RegExp(`(^|[^\\p{L}\\p{N}])${term}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalizedMentionText);
    } catch {
      return normalizedMentionText.includes(term);
    }
  });
}

function isDynamicState(state, pairEvents = []) {
  return Boolean(state?.last_event_id || state?.source_revision_id || pairEvents.length > 0);
}

function isCriticalState(state) {
  const intimacy = normalizeText(state?.intimacy_level);
  const secrecy = normalizeText(state?.secrecy_state || 'public');
  const consent = normalizeText(state?.consent_state || 'unknown');
  return ['medium', 'high'].includes(intimacy)
    || (secrecy && secrecy !== 'public')
    || (consent && consent !== 'unknown')
    || Boolean(cleanText(state?.emotional_aftermath));
}

function relationLabel(type) {
  return RELATION_LABELS[type] || type || 'Khác';
}

function makeEdge({
  pairKey,
  relationship = null,
  state = null,
  characterA = null,
  characterB = null,
  score = 0,
  reasons = [],
  mustIncludeReasons = [],
}) {
  const relationshipType = cleanText(state?.relationship_type || relationship?.relation_type || 'other') || 'other';
  const summary = cleanText(state?.summary || relationship?.description || '');
  return {
    pairKey,
    characterAId: state?.character_a_id ?? relationship?.character_a_id,
    characterBId: state?.character_b_id ?? relationship?.character_b_id,
    characterAName: characterA?.name || `#${state?.character_a_id ?? relationship?.character_a_id ?? '?'}`,
    characterBName: characterB?.name || `#${state?.character_b_id ?? relationship?.character_b_id ?? '?'}`,
    relationshipType,
    label: relationLabel(relationshipType),
    summary,
    intimacyLevel: cleanText(state?.intimacy_level || ''),
    secrecyState: cleanText(state?.secrecy_state || ''),
    consentState: cleanText(state?.consent_state || ''),
    emotionalAftermath: cleanText(state?.emotional_aftermath || ''),
    score,
    reasons,
    mustIncludeReasons,
    compact: false,
  };
}

function edgeTextLength(edge) {
  return [
    edge.characterAName,
    edge.characterBName,
    edge.label,
    edge.summary,
    edge.intimacyLevel,
    edge.secrecyState,
    edge.consentState,
    edge.emotionalAftermath,
  ].filter(Boolean).join(' ').length;
}

function compactEdge(edge) {
  const bits = [];
  bits.push(edge.label);
  if (edge.intimacyLevel && edge.intimacyLevel !== 'none') bits.push(`thân mật ${edge.intimacyLevel}`);
  if (edge.secrecyState && edge.secrecyState !== 'public') bits.push(`bí mật ${edge.secrecyState}`);
  return {
    ...edge,
    summary: bits.join(', '),
    compact: true,
  };
}

function buildTopReasons(omitted = []) {
  const counts = omitted.reduce((map, item) => {
    const key = item.omittedReason || 'điểm thấp hơn các quan hệ được chọn';
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))
    .slice(0, 3)
    .map(([reason, count]) => `${reason}: ${count}`);
}

export function buildRelationshipContextPacket({
  characters = [],
  relationships = [],
  relationshipStates = [],
  storyEvents = [],
  chapters = [],
  currentChapterIndex = null,
  characterContextGate = null,
  userPrompt = '',
  currentChapterOutline = null,
  currentArc = null,
  currentMacroArc = null,
  maxMustIncludeEdges = 6,
  maxSupportingEdges = 4,
  maxWarnings = 4,
  budgetChars = 3500,
} = {}) {
  const characterById = new Map((characters || []).map((character) => [character.id, character]));
  const relationshipsByPair = new Map();
  const statesByPair = new Map();
  const eventsByPair = new Map();
  const chapterOrderById = new Map((chapters || []).map((chapter) => [chapter.id, Number(chapter.order_index)]));

  (relationships || []).forEach((relationship) => {
    if (!relationship?.character_a_id || !relationship?.character_b_id) return;
    relationshipsByPair.set(
      buildRelationshipPairKey(relationship.character_a_id, relationship.character_b_id),
      relationship
    );
  });

  (relationshipStates || []).forEach((state) => {
    const a = state?.character_a_id;
    const b = state?.character_b_id;
    if (!a || !b) return;
    statesByPair.set(state.pair_key || buildRelationshipPairKey(a, b), state);
  });

  (storyEvents || []).forEach((event) => {
    if (event?.status && event.status !== 'committed') return;
    if (!RELATIONSHIP_OP_TYPES.has(event?.op_type) || !event.subject_id || !event.target_id) return;
    const pairKey = buildRelationshipPairKey(event.subject_id, event.target_id);
    if (!eventsByPair.has(pairKey)) eventsByPair.set(pairKey, []);
    eventsByPair.get(pairKey).push(event);
  });

  const sceneCastIds = collectCharacterIds(characterContextGate?.sceneCast || []);
  const chapterFocusIds = collectCharacterIds(characterContextGate?.chapterFocusCast || []);
  const referencedIds = collectCharacterIds(characterContextGate?.referencedCanonCast || []);
  const activeIds = new Set([...sceneCastIds, ...chapterFocusIds]);
  const normalizedMentionText = normalizeText(collectMentionText({
    userPrompt,
    currentChapterOutline,
    currentArc,
    currentMacroArc,
  }));

  const pairKeys = new Set([...relationshipsByPair.keys(), ...statesByPair.keys()]);
  const edgeRecords = [...pairKeys].map((pairKey) => {
    const relationship = relationshipsByPair.get(pairKey) || null;
    const state = statesByPair.get(pairKey) || null;
    const aId = state?.character_a_id ?? relationship?.character_a_id;
    const bId = state?.character_b_id ?? relationship?.character_b_id;
    const characterA = characterById.get(aId) || null;
    const characterB = characterById.get(bId) || null;
    const pairEvents = eventsByPair.get(pairKey) || [];
    const relationshipType = cleanText(state?.relationship_type || relationship?.relation_type || 'other') || 'other';
    const mustIncludeReasons = [];
    const reasons = [];
    let score = 0;

    const aInScene = sceneCastIds.has(aId);
    const bInScene = sceneCastIds.has(bId);
    if (aInScene && bInScene) {
      mustIncludeReasons.push('hai nhân vật cùng có mặt trong cảnh');
    }

    if (characterMentioned(characterA, normalizedMentionText) && characterMentioned(characterB, normalizedMentionText)) {
      mustIncludeReasons.push('cặp quan hệ được nhắc đích danh trong yêu cầu/dàn ý/arc');
    }

    const typeCritical = CRITICAL_RELATION_TYPES.has(normalizeText(relationshipType))
      && (aInScene || bInScene || isDynamicState(state, pairEvents));
    const critical = isCriticalState(state) || typeCritical;
    const dynamic = isDynamicState(state, pairEvents);
    const touchesActive = activeIds.has(aId) || activeIds.has(bId);
    const touchesReferenced = referencedIds.has(aId) || referencedIds.has(bId);

    if (critical) {
      score += 80;
      reasons.push('quan hệ có bí mật/thân mật/xung đột nhạy cảm');
    }

    const recentEvents = pairEvents.filter((event) => {
      if (!Number.isFinite(Number(currentChapterIndex))) return true;
      const order = chapterOrderById.get(event.chapter_id);
      return Number.isFinite(order) && order < currentChapterIndex && order >= currentChapterIndex - 3;
    });
    if (recentEvents.length > 0) {
      score += 65;
      reasons.push('có thay đổi quan hệ trong 3 chương gần nhất');
    }

    if (touchesActive && dynamic) {
      score += 55;
      reasons.push('liên quan POV/nhân vật trọng tâm và có state động');
    }

    if (BASELINE_IMPORTANT_TYPES.has(normalizeText(relationship?.relation_type))) {
      score += 40;
      reasons.push('quan hệ nền quan trọng');
    }

    if ((aInScene || bInScene) && !(aInScene && bInScene)) {
      score += 25;
      reasons.push('quan hệ một bước từ nhân vật trong cảnh');
    }

    if (!dynamic && WEAK_BASELINE_TYPES.has(normalizeText(relationship?.relation_type))) {
      score -= 30;
      reasons.push('quan hệ nền yếu, chưa có state động');
    }

    if (touchesReferenced) {
      score += 10;
      reasons.push('liên quan canon nền được nhắc tới');
    }

    const edge = makeEdge({
      pairKey,
      relationship,
      state,
      characterA,
      characterB,
      score,
      reasons,
      mustIncludeReasons,
    });

    return {
      pairKey,
      edge,
      mustInclude: mustIncludeReasons.length > 0,
      score,
      reasons,
      mustIncludeReasons,
      eligibleForSupport: critical || recentEvents.length > 0 || (touchesActive && dynamic) || touchesReferenced || aInScene || bInScene,
    };
  });

  const mustIncludeRecords = edgeRecords
    .filter((record) => record.mustInclude)
    .sort((a, b) => b.mustIncludeReasons.length - a.mustIncludeReasons.length || b.score - a.score || a.pairKey.localeCompare(b.pairKey));
  const scoredRecords = edgeRecords
    .filter((record) => !record.mustInclude && record.eligibleForSupport)
    .sort((a, b) => b.score - a.score || a.pairKey.localeCompare(b.pairKey));
  const ineligibleRecords = edgeRecords
    .filter((record) => !record.mustInclude && !record.eligibleForSupport);

  const mustIncludeEdges = mustIncludeRecords.map((record) => record.edge);
  const supportingEdges = scoredRecords.slice(0, maxSupportingEdges).map((record) => record.edge);
  const omitted = [
    ...scoredRecords.slice(maxSupportingEdges).map((record) => ({
      ...record,
      omittedReason: record.score < 30
        ? 'điểm thấp hoặc chỉ là quan hệ nền yếu'
        : 'hết ngân sách quan hệ hỗ trợ',
    })),
    ...ineligibleRecords.map((record) => ({
      ...record,
      omittedReason: 'không chạm scene/focus và chưa có state động liên quan',
    })),
  ];

  let selectedTextLength = [...mustIncludeEdges, ...supportingEdges]
    .reduce((sum, edge) => sum + edgeTextLength(edge), 0);
  let budgetPressure = mustIncludeEdges.length > maxMustIncludeEdges || selectedTextLength > budgetChars;
  const finalMustIncludeEdges = budgetPressure
    ? mustIncludeEdges.map(compactEdge)
    : mustIncludeEdges;
  selectedTextLength = [...finalMustIncludeEdges, ...supportingEdges]
    .reduce((sum, edge) => sum + edgeTextLength(edge), 0);
  if (selectedTextLength > budgetChars) budgetPressure = true;

  const selectedPairs = new Map([
    ...finalMustIncludeEdges.map((edge) => [edge.pairKey, 'mustInclude']),
    ...supportingEdges.map((edge) => [edge.pairKey, 'supporting']),
  ]);
  const omittedByPair = new Map(omitted.map((record) => [record.pairKey, record.omittedReason]));

  const relationshipRoutingDebug = edgeRecords
    .sort((a, b) => a.pairKey.localeCompare(b.pairKey))
    .map((record) => ({
      pairKey: record.pairKey,
      score: record.score,
      selectedAs: selectedPairs.get(record.pairKey) || 'omitted',
      reasons: record.reasons,
      mustIncludeReasons: record.mustIncludeReasons,
      omittedReason: omittedByPair.get(record.pairKey) || '',
    }));

  return {
    relationshipContextPacket: {
      mustIncludeEdges: finalMustIncludeEdges,
      supportingEdges,
      warnings: budgetPressure
        ? ['Ngân sách quan hệ đang căng; một số mô tả đã được nén để giữ context.'].slice(0, maxWarnings)
        : [],
      omittedSummary: {
        count: omitted.length,
        topReasons: buildTopReasons(omitted),
      },
      budgetPressure,
    },
    relationshipRoutingDebug,
  };
}

export default {
  buildRelationshipContextPacket,
  buildRelationshipPairKey,
};
