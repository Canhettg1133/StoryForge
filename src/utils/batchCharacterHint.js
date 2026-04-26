import {
  findCharacterIdentityMatch,
  normalizeCharacterIdentityKey,
} from './characterIdentity.js';

export const BATCH_CHARACTER_MIN_COUNT = 1;
export const BATCH_CHARACTER_MAX_COUNT = 20;

const LIST_MARKER_RE = /^\s*(?:[-*+•]|\d+[.)]|[a-z][.)])\s*/i;
const DESCRIPTOR_RE = /\b(?:nhan\s*vat|vai\s*tro|chinh|phu|phan\s*dien|ho\s*tro|mentor|protagonist|antagonist|supporting|minor|cast|character)\b/gi;
const MARKDOWN_WRAPPER_RE = /[*_`~#>]+/g;

const STOP_NAME_KEYS = new Set([
  'chuong',
  'chuong i',
  'chuong ii',
  'chuong iii',
  'chuong iv',
  'chuong v',
  'chuong mot',
  'chuong hai',
  'chuong ba',
  'canh',
  'hoi',
  'arc',
  'phan',
  'phan 1',
  'phan 2',
  'phan 3',
  'phan 4',
  'phan 5',
  'mo dau',
  'ket thuc',
  'cao trao',
  'dan y',
  'tom tat',
  'yeu cau',
  'nhan vat',
  'nhan vat chinh',
  'nhan vat phu',
  'phan dien',
  'vai tro',
]);

function cleanText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdown(value = '') {
  return cleanText(value)
    .replace(MARKDOWN_WRAPPER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looseSearchKey(value = '') {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasCharacterKeyword(value = '') {
  const key = looseSearchKey(value);
  return key.includes('nhan vat') || /\b(?:characters?|cast)\b/i.test(key);
}

function uniqueByKey(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const name = cleanText(item?.name || item);
    const key = normalizeCharacterIdentityKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(typeof item === 'object' ? { ...item, name, key } : { name, key });
  }
  return result;
}

function splitAliases(aliases) {
  if (Array.isArray(aliases)) return aliases;
  if (typeof aliases === 'string') {
    return aliases.split(/[,;|/]+/).map((alias) => alias.trim()).filter(Boolean);
  }
  return [];
}

function normalizeCandidateName(value = '') {
  let name = stripMarkdown(value)
    .replace(LIST_MARKER_RE, '')
    .replace(/^[([{"'“”‘’\s]+|[)\]}"'“”‘’\s.,;:]+$/g, '')
    .replace(DESCRIPTOR_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  name = name
    .replace(/^(?:la|là|as|is)\s+/i, '')
    .replace(/\s+(?:la|là|as|is)$/i, '')
    .trim();

  const key = normalizeCharacterIdentityKey(name);
  if (!key || STOP_NAME_KEYS.has(key)) return '';
  if (/^(?:phan|chuong|canh|hoi)\s*\d*$/i.test(key)) return '';
  if (key.length < 2) return '';
  if (key.split(' ').length > 4) return '';
  return name;
}

function addCandidate(target, rawName, source) {
  const name = normalizeCandidateName(rawName);
  if (!name) return;
  const key = normalizeCharacterIdentityKey(name);
  if (!key || STOP_NAME_KEYS.has(key)) return;
  target.push({ name, key, source });
}

function splitCandidateList(text = '') {
  return String(text || '')
    .replace(/\s+(?:va|và|voi|với|and)\s+/gi, ',')
    .split(/[,;|/]+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractFromExplicitCharacterLine(line, candidates) {
  const stripped = stripMarkdown(line);
  const markerIndex = stripped.search(/[:：-]/);
  if (markerIndex < 0) return false;

  const beforeMarker = stripped.slice(0, markerIndex);
  const beforeKey = looseSearchKey(beforeMarker);
  const isListLabel = (
    /^(?:(?:cac|\d+)\s+)?nhan\s*vat\b/i.test(beforeKey)
    || /^(?:danh\s*sach|he\s*thong)\s+(?:cac\s+)?nhan\s*vat\b/i.test(beforeKey)
    || /^(?:characters?|cast)\b/i.test(beforeKey)
  );
  if (!isListLabel) return false;

  const afterMarker = stripped.slice(markerIndex + 1);
  const parts = splitCandidateList(afterMarker);
  for (const part of parts) {
    const head = part.split(/\s[-–—:]\s|[()]/)[0];
    addCandidate(candidates, head, 'explicit');
  }
  return parts.length > 0;
}

function extractFromSectionBullet(line, candidates) {
  if (!LIST_MARKER_RE.test(line)) return;
  const body = stripMarkdown(line.replace(LIST_MARKER_RE, '').trim());
  const head = body.split(/\s[-–—:]\s|[:：]|[()]/)[0];
  addCandidate(candidates, head, 'section');
}

function isMajorHeading(line = '') {
  const stripped = stripMarkdown(line);
  return (
    /^\s*#{1,6}\s+/.test(line)
    || /^\s*(?:[IVXLCDM]+|\d+)\.\s+/i.test(stripped)
    || /^\s*[-=]{3,}\s*$/.test(stripped)
  );
}

function isCharacterSectionHeading(line = '') {
  const stripped = stripMarkdown(line);
  const normalized = looseSearchKey(stripped);
  if (!hasCharacterKeyword(normalized)) return false;
  return (
    isMajorHeading(line)
    || /^\s*(?:he\s*thong|danh\s*sach|cast|characters?)\b/i.test(normalized)
    || normalized.length <= 48
  );
}

function extractStandaloneStructuredName(line, candidates) {
  const stripped = stripMarkdown(line);
  if (!LIST_MARKER_RE.test(stripped)) return;
  const body = stripped.replace(LIST_MARKER_RE, '').trim();
  if (!/[:：()]/.test(body)) return;
  const head = body.split(/\s[-–—:]\s|[:：]|[()]/)[0];
  const headKey = normalizeCharacterIdentityKey(head);
  if (!headKey || headKey.split(' ').length > 4) return;
  if (/^(?:phan|chuong|canh|hoi)\s*\d*$/i.test(headKey)) return;
  addCandidate(candidates, head, 'structured');
}

export function clampBatchCount(value, min = BATCH_CHARACTER_MIN_COUNT, max = BATCH_CHARACTER_MAX_COUNT) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

export function analyzeCharacterHint(hint = '', existingCharacters = []) {
  const text = cleanText(hint);
  if (!text) {
    return {
      detectedCharacters: [],
      existingCharacters: [],
      missingCharacters: [],
      clearList: false,
    };
  }

  const candidates = [];
  let inCharacterSection = false;
  let sectionLineCount = 0;
  let explicitListFound = false;

  for (const rawLine of String(hint).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      sectionLineCount = 0;
      continue;
    }

    if (extractFromExplicitCharacterLine(line, candidates)) {
      explicitListFound = true;
      inCharacterSection = true;
      sectionLineCount = 0;
      continue;
    }

    const normalizedLine = looseSearchKey(line);
    if (inCharacterSection && isMajorHeading(line) && !isCharacterSectionHeading(line)) {
      inCharacterSection = false;
      sectionLineCount = 0;
    }

    if (isCharacterSectionHeading(line)) {
      inCharacterSection = true;
      sectionLineCount = 0;
      continue;
    }

    if (inCharacterSection && sectionLineCount < 12) {
      extractFromSectionBullet(line, candidates);
      sectionLineCount += 1;
      continue;
    }

    extractStandaloneStructuredName(line, candidates);
  }

  const detectedCharacters = uniqueByKey(candidates);
  const existingMatches = [];
  const missingCharacters = [];

  for (const candidate of detectedCharacters) {
    const match = findCharacterIdentityMatch(existingCharactersInput(existingMatches), candidate);
    if (match) {
      existingMatches.push({
        name: candidate.name,
        matchedName: match.character.name,
        character: match.character,
      });
    } else {
      missingCharacters.push(candidate);
    }
  }

  return {
    detectedCharacters,
    existingCharacters: existingMatches,
    missingCharacters,
    clearList: explicitListFound
      || detectedCharacters.some((candidate) => candidate.source === 'section')
      || detectedCharacters.filter((candidate) => candidate.source === 'structured').length >= 2,
  };

  function existingCharactersInput(alreadyMatched = []) {
    const matchedIds = new Set(alreadyMatched.map((item) => item.character?.id).filter(Boolean));
    return (existingCharacters || []).map((character) => ({
      ...character,
      aliases: splitAliases(character.aliases),
      _alreadyMatched: matchedIds.has(character.id),
    }));
  }
}

export function buildCharacterBatchPlan({
  selectedCount,
  hint = '',
  existingCharacters = [],
  minCount = BATCH_CHARACTER_MIN_COUNT,
  maxCount = BATCH_CHARACTER_MAX_COUNT,
} = {}) {
  const clampedCount = clampBatchCount(selectedCount, minCount, maxCount);
  const hintAnalysis = analyzeCharacterHint(hint, existingCharacters);
  const missingCount = hintAnalysis.missingCharacters.length;
  const hasClearMissingList = hintAnalysis.clearList && missingCount > 0;
  const effectiveCount = hasClearMissingList
    ? Math.min(clampedCount, missingCount)
    : clampedCount;

  return {
    count: clampedCount,
    effectiveCount,
    suggestedCount: hasClearMissingList ? missingCount : clampedCount,
    hasClearMissingList,
    hintAnalysis,
    warning: hasClearMissingList && clampedCount < missingCount
      ? `Phát hiện ${hintAnalysis.detectedCharacters.length} nhân vật trong dàn ý, đã có ${hintAnalysis.existingCharacters.length}, còn thiếu ${missingCount}. Bạn đang chọn ${clampedCount}.`
      : '',
  };
}
