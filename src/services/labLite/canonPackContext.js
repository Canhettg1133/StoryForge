import { loadCanonPack } from './canonPackRepository.js';

const DEFAULT_CHAR_CAP = 9000;

function clean(value, maxLength = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'cua', 'cho', 'voi', 'mot', 'nhung', 'nhung', 'trong', 'ngoai', 'dang', 'duoc',
  'khong', 'nay', 'kia', 'vao', 'ra', 'len', 'xuong', 'canh', 'chuong', 'truyen',
]);

function includesAnyText(item, needles = []) {
  const haystack = ` ${normalizeSearchText(JSON.stringify(item || {}))} `;
  return needles.some((needle) => {
    const normalized = normalizeSearchText(needle);
    if (!normalized || STOP_WORDS.has(normalized)) return false;
    return haystack.includes(` ${normalized} `);
  });
}

function collectSceneNeedles({ sceneText = '', currentChapterOutline = null, characters = [] } = {}) {
  const names = characters.flatMap((character) => [
    character?.name,
    ...(Array.isArray(character?.aliases) ? character.aliases : []),
  ]).filter(Boolean);
  const outlineNames = [
    ...(currentChapterOutline?.featuredCharacters || []),
    currentChapterOutline?.primaryLocation,
    ...(currentChapterOutline?.requiredObjects || []),
    ...(currentChapterOutline?.requiredTerms || []),
  ].filter(Boolean);
  const sceneWords = String(sceneText || '')
    .split(/\s+/u)
    .map((word) => ({
      original: String(word || '').trim(),
      normalized: normalizeSearchText(word),
    }))
    .filter(({ original, normalized }) => (
      normalized
      && !STOP_WORDS.has(normalized)
      && (normalized.length >= 4 || /^[A-ZÀ-Ỵ]/u.test(original))
    ))
    .map(({ normalized }) => normalized)
    .slice(0, 80);
  return [...new Set([...names, ...outlineNames, ...sceneWords])];
}

function capContext(context, charCap = DEFAULT_CHAR_CAP) {
  let serialized = JSON.stringify(context);
  if (serialized.length <= charCap) return context;

  const next = { ...context };
  next.chapterCanon = next.chapterCanon.slice(0, 8);
  next.characterCanon = next.characterCanon.slice(0, 10);
  next.relationshipCanon = next.relationshipCanon.slice(0, 8);
  next.creativeGaps = next.creativeGaps.slice(0, 8);
  next.canonRestrictions = next.canonRestrictions.slice(0, 12);
  serialized = JSON.stringify(next);
  if (serialized.length <= charCap) return next;

  let compact = {
    ...next,
    globalCanon: clean(next.globalCanon, 1800),
    styleCanon: clean(next.styleCanon, 900),
    chapterCanon: next.chapterCanon.slice(0, 4),
    characterCanon: next.characterCanon.slice(0, 6),
    relationshipCanon: next.relationshipCanon.slice(0, 4),
    creativeGaps: next.creativeGaps.slice(0, 4),
    canonRestrictions: next.canonRestrictions.slice(0, 8),
  };

  serialized = JSON.stringify(compact);
  if (serialized.length <= charCap) return compact;

  compact = {
    ...compact,
    globalCanon: clean(compact.globalCanon, Math.max(160, Math.floor(charCap * 0.18))),
    styleCanon: clean(compact.styleCanon, Math.max(120, Math.floor(charCap * 0.12))),
    arcCanon: compact.arcCanon.slice(0, 3),
    chapterCanon: compact.chapterCanon.slice(0, 2).map((item) => ({
      chapterIndex: item.chapterIndex,
      summary: clean(item.summary, 160),
    })),
    characterCanon: compact.characterCanon.slice(0, 3).map((item) => ({
      name: item.name,
      role: clean(item.role, 80),
      status: clean(item.status, 120),
      voice: clean(item.voice, 120),
    })),
    relationshipCanon: compact.relationshipCanon.slice(0, 2).map((item) => ({
      characterA: item.characterA,
      characterB: item.characterB,
      relation: clean(item.relation, 80),
      change: clean(item.change, 140),
    })),
    creativeGaps: compact.creativeGaps.slice(0, 2).map((item) => clean(item, 180)),
    canonRestrictions: compact.canonRestrictions.slice(0, 4).map((item) => clean(item, 180)),
  };
  serialized = JSON.stringify(compact);
  if (serialized.length <= charCap) return compact;

  return {
    packId: compact.packId,
    packTitle: compact.packTitle,
    projectMode: compact.projectMode,
    adherenceLevel: compact.adherenceLevel,
    divergencePoint: clean(compact.divergencePoint, 160),
    globalCanon: clean(compact.globalCanon, 180),
    arcCanon: [],
    characterCanon: compact.characterCanon.slice(0, 1),
    relationshipCanon: [],
    chapterCanon: [],
    styleCanon: clean(compact.styleCanon, 120),
    canonRestrictions: compact.canonRestrictions.slice(0, 2).map((item) => clean(item, 120)),
    creativeGaps: compact.creativeGaps.slice(0, 1).map((item) => clean(item, 120)),
  };
}

export function selectCanonPackContext({
  canonPack,
  project = {},
  sceneText = '',
  currentChapterOutline = null,
  characters = [],
  charCap = DEFAULT_CHAR_CAP,
} = {}) {
  if (!canonPack) return null;
  const needles = collectSceneNeedles({ sceneText, currentChapterOutline, characters });
  const relevantCharacters = (canonPack.characterCanon || [])
    .filter((item) => needles.length === 0 || includesAnyText(item, needles))
    .slice(0, 16);
  const relevantRelationships = (canonPack.relationshipCanon || [])
    .filter((item) => needles.length === 0 || includesAnyText(item, needles))
    .slice(0, 12);
  const chapterNumber = Number(currentChapterOutline?.chapterIndex || currentChapterOutline?.orderIndex || 0);
  const relevantChapters = (canonPack.chapterCanon || [])
    .filter((item) => {
      if (chapterNumber > 0 && Math.abs(Number(item.chapterIndex || 0) - chapterNumber) <= 2) return true;
      return includesAnyText(item, needles);
    })
    .slice(0, 12);

  const context = {
    packId: canonPack.id,
    packTitle: canonPack.title || 'Canon Pack',
    projectMode: project.project_mode || 'original',
    adherenceLevel: project.canon_adherence_level || 'balanced',
    divergencePoint: project.divergence_point || '',
    globalCanon: clean(canonPack.globalCanon?.summary || ''),
    arcCanon: (canonPack.arcCanon || []).slice(0, 8).map((arc) => ({
      title: arc.title,
      chapterStart: arc.chapterStart,
      chapterEnd: arc.chapterEnd,
      summary: clean(arc.summary, 600),
      whyLoad: clean(arc.whyLoad, 360),
    })),
    characterCanon: relevantCharacters,
    relationshipCanon: relevantRelationships,
    chapterCanon: relevantChapters,
    styleCanon: clean([
      canonPack.styleCanon?.tone,
      canonPack.styleCanon?.pacing,
      canonPack.styleCanon?.voice,
      ...(canonPack.styleCanon?.observations || []),
    ].filter(Boolean).join('\n'), 2200),
    canonRestrictions: (canonPack.canonRestrictions || []).slice(0, 20),
    creativeGaps: (canonPack.creativeGaps || []).slice(0, 16),
  };

  return capContext(context, charCap);
}

export async function loadFanficCanonContext({
  project,
  sceneText = '',
  currentChapterOutline = null,
  characters = [],
  charCap = DEFAULT_CHAR_CAP,
} = {}) {
  if (!project?.source_canon_pack_id) return null;
  const canonPack = await loadCanonPack(project.source_canon_pack_id);
  return selectCanonPackContext({
    canonPack,
    project,
    sceneText,
    currentChapterOutline,
    characters,
    charCap,
  });
}
