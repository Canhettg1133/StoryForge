const DEFAULT_REFERENCE_LIMIT = 8;
const AMBIGUOUS_SHORT_NAMES = new Set(['an', 'mai', 'nam', 'long']);

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeGateText(value) {
  return String(value || '')
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

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function characterAliases(character) {
  return parseList(character?.aliases)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function characterTerms(character) {
  return [character?.name, ...characterAliases(character)]
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 2);
}

function termWordCount(term) {
  return normalizeGateText(term).split(' ').filter(Boolean).length;
}

function isShortOrAmbiguous(term) {
  const normalized = normalizeGateText(term);
  return AMBIGUOUS_SHORT_NAMES.has(normalized)
    || (termWordCount(term) <= 1 && normalized.length <= 3);
}

function hasOriginalBoundaryMatch(haystack, term) {
  if (!haystack || !term) return false;
  try {
    const rx = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(term)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    return rx.test(haystack);
  } catch {
    return haystack.toLowerCase().includes(String(term || '').toLowerCase());
  }
}

function hasNormalizedBoundaryMatch(normalizedHaystack, normalizedTerm) {
  if (!normalizedHaystack || !normalizedTerm) return false;
  try {
    const rx = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(normalizedTerm)}(?=$|[^\\p{L}\\p{N}])`, 'u');
    return rx.test(normalizedHaystack);
  } catch {
    return normalizedHaystack.includes(normalizedTerm);
  }
}

function makeCollisionSet(lists = []) {
  const set = new Set();
  lists.flat().forEach((item) => {
    if (!item?.name) return;
    set.add(normalizeGateText(item.name));
    parseList(item.aliases).forEach((alias) => set.add(normalizeGateText(alias)));
  });
  return set;
}

function makeDuplicateTermSet(characters = []) {
  const ownerIdsByTerm = new Map();
  characters.forEach((character) => {
    characterTerms(character).forEach((term) => {
      const normalized = normalizeGateText(term);
      if (!normalized) return;
      if (!ownerIdsByTerm.has(normalized)) ownerIdsByTerm.set(normalized, new Set());
      ownerIdsByTerm.get(normalized).add(character.id);
    });
  });
  return new Set(
    [...ownerIdsByTerm.entries()]
      .filter(([, ownerIds]) => ownerIds.size > 1)
      .map(([term]) => term)
  );
}

function buildItem(character, metadata) {
  return {
    character,
    source: metadata.source,
    confidence: metadata.confidence,
    matchedBy: metadata.matchedBy || '',
    permission: metadata.permission,
  };
}

function getCharacterId(item) {
  return item?.character?.id ?? item?.id ?? item?.character?.name ?? item?.name;
}

function addUnique(target, item) {
  const id = getCharacterId(item);
  if (id == null || target.some((existing) => getCharacterId(existing) === id)) return;
  target.push(item);
}

function findById(characters, id) {
  return characters.find((character) => String(character.id) === String(id));
}

function findByNameOrAlias(characters, value) {
  const normalized = normalizeGateText(value);
  if (!normalized) return null;
  return characters.find((character) => characterTerms(character).some((term) => normalizeGateText(term) === normalized)) || null;
}

function scoreMatch(character, haystacks, collisionTerms, duplicateTerms) {
  let best = null;
  const originalHaystacks = haystacks.map((item) => String(item || '')).filter(Boolean);
  const normalizedHaystacks = originalHaystacks.map((item) => normalizeGateText(item));

  characterTerms(character).forEach((term) => {
    const normalizedTerm = normalizeGateText(term);
    if (!normalizedTerm) return;
    const exact = originalHaystacks.some((haystack) => hasOriginalBoundaryMatch(haystack, term));
    const normalized = !exact && normalizedHaystacks.some((haystack) => hasNormalizedBoundaryMatch(haystack, normalizedTerm));
    if (!exact && !normalized) return;

    const collidesWithLongerTerm = [...collisionTerms].some((collisionTerm) => (
      collisionTerm.startsWith(`${normalizedTerm} `)
      && normalizedHaystacks.some((haystack) => hasNormalizedBoundaryMatch(haystack, collisionTerm))
    ));
    const weak = isShortOrAmbiguous(term)
      || collisionTerms.has(normalizedTerm)
      || collidesWithLongerTerm
      || duplicateTerms.has(normalizedTerm);
    const confidence = weak ? 0.35 : (exact ? 0.9 : 0.65);
    const candidate = {
      confidence,
      matchedBy: term,
      weak,
      matchKind: exact ? 'exact' : 'normalized',
    };
    if (!best || candidate.confidence > best.confidence) best = candidate;
  });

  return best;
}

function addTextMatches({
  target,
  blocked,
  characters,
  excludedIds,
  haystacks,
  source,
  permission,
  collisionTerms,
  duplicateTerms,
  minConfidence = 0.55,
}) {
  characters.forEach((character) => {
    if (excludedIds.has(character.id)) return;
    const match = scoreMatch(character, haystacks, collisionTerms, duplicateTerms);
    if (!match) return;
    const item = buildItem(character, {
      source,
      confidence: match.confidence,
      matchedBy: match.matchedBy,
      permission,
    });
    if (match.confidence >= minConfidence && !match.weak) {
      addUnique(target, item);
      excludedIds.add(character.id);
      return;
    }
    addUnique(blocked, {
      ...item,
      permission: 'blocked_or_weak',
    });
  });
}

function factMentionsCharacter(fact, character) {
  const text = `${fact?.description || ''} ${fact?.summary || ''} ${fact?.payload || ''}`;
  return characterTerms(character).some((term) => hasNormalizedBoundaryMatch(normalizeGateText(text), normalizeGateText(term)));
}

export function buildCharacterContextGate({
  allCharacters = [],
  allLocations = [],
  allObjects = [],
  allTerms = [],
  allFactions = [],
  allRelationships = [],
  canonFacts = [],
  taboos = [],
  scene = null,
  sceneText = '',
  userPrompt = '',
  currentChapterOutline = null,
  chapterBlueprintContext = null,
  referencedLimit = DEFAULT_REFERENCE_LIMIT,
} = {}) {
  const sceneCast = [];
  const chapterFocusCast = [];
  const referencedCanonCast = [];
  const blockedOrWeakCast = [];
  const matchDebug = [];
  const collisionTerms = makeCollisionSet([allLocations, allObjects, allTerms, allFactions]);
  const duplicateTerms = makeDuplicateTermSet(allCharacters);

  const presentIds = parseList(scene?.characters_present);
  const sceneIds = [scene?.pov_character_id, ...presentIds].filter((id) => id != null && id !== '');
  sceneIds.forEach((id, index) => {
    const character = findById(allCharacters, id);
    if (!character) return;
    addUnique(sceneCast, buildItem(character, {
      source: index === 0 && String(id) === String(scene?.pov_character_id) ? 'scene_pov' : 'scene_characters_present',
      confidence: 1,
      matchedBy: String(id),
      permission: 'direct_scene',
    }));
  });

  const sceneCastIds = new Set(sceneCast.map((item) => item.character.id));
  const excludedFromFocus = new Set(sceneCastIds);
  const featuredCharacters = [
    ...parseList(currentChapterOutline?.featuredCharacters),
    ...parseList(currentChapterOutline?.featured_characters),
    ...parseList(chapterBlueprintContext?.featured_characters),
  ];
  featuredCharacters.forEach((name) => {
    const character = findByNameOrAlias(allCharacters, name);
    if (!character || excludedFromFocus.has(character.id)) return;
    addUnique(chapterFocusCast, buildItem(character, {
      source: 'chapter_featured_characters',
      confidence: 0.85,
      matchedBy: name,
      permission: 'chapter_focus_only',
    }));
    excludedFromFocus.add(character.id);
  });

  addTextMatches({
    target: chapterFocusCast,
    blocked: blockedOrWeakCast,
    characters: allCharacters,
    excludedIds: excludedFromFocus,
    haystacks: [
      currentChapterOutline?.summary,
      currentChapterOutline?.purpose,
      ...(parseList(currentChapterOutline?.keyEvents)),
      ...(parseList(currentChapterOutline?.key_events)),
      chapterBlueprintContext?.summary,
      chapterBlueprintContext?.purpose,
      ...(parseList(chapterBlueprintContext?.key_events)),
    ],
    source: 'chapter_outline_text',
    permission: 'chapter_focus_only',
    collisionTerms,
    duplicateTerms,
    minConfidence: 0.8,
  });

  const excludedFromReference = new Set([
    ...sceneCast.map((item) => item.character.id),
    ...chapterFocusCast.map((item) => item.character.id),
  ]);
  addTextMatches({
    target: referencedCanonCast,
    blocked: blockedOrWeakCast,
    characters: allCharacters,
    excludedIds: excludedFromReference,
    haystacks: [sceneText, userPrompt],
    source: 'scene_or_user_text',
    permission: 'canon_reference_only',
    collisionTerms,
    duplicateTerms,
    minConfidence: 0.55,
  });

  const sceneIdsForRelationships = new Set(sceneCast.map((item) => item.character.id));
  allRelationships.forEach((relationship) => {
    const aInScene = sceneIdsForRelationships.has(relationship.character_a_id);
    const bInScene = sceneIdsForRelationships.has(relationship.character_b_id);
    if (!aInScene && !bInScene) return;
    const relatedId = aInScene ? relationship.character_b_id : relationship.character_a_id;
    if (excludedFromReference.has(relatedId)) return;
    const character = findById(allCharacters, relatedId);
    if (!character) return;
    addUnique(referencedCanonCast, buildItem(character, {
      source: 'scene_cast_relationship_1hop',
      confidence: 0.6,
      matchedBy: String(scene?.id || ''),
      permission: 'canon_reference_only',
    }));
    excludedFromReference.add(relatedId);
  });

  allCharacters.forEach((character) => {
    if (excludedFromReference.has(character.id) || referencedCanonCast.length >= referencedLimit) return;
    const hasFact = (canonFacts || []).some((fact) => factMentionsCharacter(fact, character));
    const hasTaboo = (taboos || []).some((taboo) => String(taboo.character_id) === String(character.id));
    if (!hasFact && !hasTaboo) return;
    addUnique(referencedCanonCast, buildItem(character, {
      source: hasTaboo ? 'taboo' : 'canon_fact',
      confidence: 0.6,
      matchedBy: hasTaboo ? 'taboo.character_id' : 'canon_fact.description',
      permission: 'canon_reference_only',
    }));
    excludedFromReference.add(character.id);
  });

  const limitedReferenced = referencedCanonCast.slice(0, referencedLimit);
  matchDebug.push(
    ...sceneCast.map((item) => ({ character_id: item.character.id, bucket: 'sceneCast', source: item.source, confidence: item.confidence, matchedBy: item.matchedBy })),
    ...chapterFocusCast.map((item) => ({ character_id: item.character.id, bucket: 'chapterFocusCast', source: item.source, confidence: item.confidence, matchedBy: item.matchedBy })),
    ...limitedReferenced.map((item) => ({ character_id: item.character.id, bucket: 'referencedCanonCast', source: item.source, confidence: item.confidence, matchedBy: item.matchedBy })),
    ...blockedOrWeakCast.map((item) => ({ character_id: item.character.id, bucket: 'blockedOrWeakCast', source: item.source, confidence: item.confidence, matchedBy: item.matchedBy }))
  );

  return {
    sceneCast,
    chapterFocusCast,
    referencedCanonCast: limitedReferenced,
    blockedOrWeakCast,
    matchDebug,
  };
}

export function flattenGateCharacters(characterContextGate) {
  const buckets = [
    ...(characterContextGate?.sceneCast || []),
    ...(characterContextGate?.chapterFocusCast || []),
    ...(characterContextGate?.referencedCanonCast || []),
  ];
  const seen = new Set();
  return buckets
    .map((item) => item.character || item)
    .filter((character) => {
      const id = character?.id ?? character?.name;
      if (id == null || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export default { buildCharacterContextGate, flattenGateCharacters, normalizeGateText };
