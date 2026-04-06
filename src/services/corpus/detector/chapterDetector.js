import {
  cleanTitle,
  countWords,
  normalizeForSearch,
  sanitizeWhitespace,
} from '../utils/textUtils.js';

const CHAPTER_HEADING_REGEX = /^(chuong|chương|chapter|chap)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/iu;
const SHORT_CHAPTER_HEADING_REGEX = /^ch(?:\s+|[.:#\-]\s*)(\d+|[ivxlcdm]+)\b/iu;
const PART_HEADING_REGEX = /^(phan|phần|part|pt|quyen|quyển|hoi|hồi|tap|tập)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/iu;
const BRACKET_HEADING_REGEX = /^\s*[\[【]\s*(\d+|[ivxlcdm]+)\s*[\]】]\s*[-–—:]?\s*.+$/iu;
const INLINE_EQUALS_HEADING_REGEX = /^\s*={3,}\s*[^\s=].*[^\s=]\s*={3,}\s*$/u;
const DECORATIVE_SEPARATOR_REGEX = /^[\s\-_=~*#\u2013\u2014\u2015\u2500-\u257f\u23af\u30fc]{3,}$/u;
const GENERIC_FALLBACK_TITLE_REGEX = /^chapter\s+\d+$/i;
const FRONT_MATTER_HINT_REGEX = /(bản quyền|ban quyen|tác giả|tac gia|reader|app reader|have fun|nguồn|nguon|convert|dịch giả|dich gia|editor|sắc hiệp viện|sachiepvien|truyện bạn đang theo dõi|theo dõi được thực hiện)/iu;
const WRITTEN_NUMBER_HEADING_PREFIX_REGEX = /^(chuong|chapter|phan|part|quyen|hoi|tap)\s+(.+)$/iu;
const WRITTEN_NUMBER_TOKEN_SET = new Set([
  'khong', 'linh', 'le',
  'mot', 'hai', 'ba', 'bon', 'tu', 'nam', 'lam', 'sau', 'bay', 'tam', 'chin',
  'muoi', 'tram', 'nghin', 'ngan', 'trieu', 'ty',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'thousand',
]);
const FULLWIDTH_PUNCTUATION_MAP = new Map([
  ['：', ':'],
  ['（', '('],
  ['）', ')'],
  ['【', '['],
  ['】', ']'],
  ['［', '['],
  ['］', ']'],
  ['｛', '{'],
  ['｝', '}'],
  ['，', ','],
  ['。', '.'],
  ['！', '!'],
  ['？', '?'],
  ['　', ' '],
]);

function normalizeRawText(rawText = '') {
  let text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  try {
    text = text.normalize('NFKC');
  } catch {
    // Ignore invalid unicode sequences and continue with the raw text.
  }

  text = Array.from(text, (char) => FULLWIDTH_PUNCTUATION_MAP.get(char) || char).join('');
  text = text
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, '  ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');

  return text
    .split('\n')
    .map((line) => line.replace(/[ ]{2,}/g, ' ').trimEnd())
    .join('\n');
}

function looksLikeHeading(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (trimmed.length > 120) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 20) return false;

  const alphaCount = (trimmed.match(/[\p{L}]/gu) || []).length;
  return alphaCount >= 2;
}

function isDecorativeSeparator(line = '') {
  const trimmed = String(line || '').trim();
  return Boolean(trimmed) && DECORATIVE_SEPARATOR_REGEX.test(trimmed);
}

function isIgnorablePreambleLine(line = '') {
  const trimmed = String(line || '').trim();
  return !trimmed || isDecorativeSeparator(trimmed);
}

function isFrontMatterLine(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  return FRONT_MATTER_HINT_REGEX.test(trimmed);
}

function extractHeadingMatch(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  if (CHAPTER_HEADING_REGEX.test(trimmed)) {
    const match = trimmed.match(CHAPTER_HEADING_REGEX);
    return {
      matched: true,
      strong: true,
      explicit: true,
      type: 'chapter',
      number: match?.[2] || null,
      source: 'chapter_keyword',
    };
  }

  if (SHORT_CHAPTER_HEADING_REGEX.test(trimmed)) {
    const match = trimmed.match(SHORT_CHAPTER_HEADING_REGEX);
    return {
      matched: true,
      strong: true,
      explicit: true,
      type: 'chapter',
      number: match?.[1] || null,
      source: 'short_chapter_keyword',
    };
  }

  if (PART_HEADING_REGEX.test(trimmed)) {
    const match = trimmed.match(PART_HEADING_REGEX);
    return {
      matched: true,
      strong: true,
      explicit: true,
      type: 'part',
      number: match?.[2] || null,
      source: 'part_keyword',
    };
  }

  if (BRACKET_HEADING_REGEX.test(trimmed)) {
    const match = trimmed.match(BRACKET_HEADING_REGEX);
    return {
      matched: true,
      strong: true,
      explicit: false,
      type: 'numbered_bracket',
      number: match?.[1] || null,
      source: 'bracket_heading',
    };
  }

  if (INLINE_EQUALS_HEADING_REGEX.test(trimmed)) {
    return {
      matched: true,
      strong: true,
      explicit: false,
      type: 'inline_equals',
      number: null,
      source: 'inline_equals',
    };
  }

  return null;
}

function looksLikeWrittenNumberSequence(text = '') {
  const normalized = normalizeForSearch(text);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) {
    return false;
  }

  return tokens.every((token) => WRITTEN_NUMBER_TOKEN_SET.has(token));
}

function extractWrittenNumberHeading(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeForSearch(trimmed);
  const match = normalized.match(WRITTEN_NUMBER_HEADING_PREFIX_REGEX);
  if (!match?.[2]) {
    return null;
  }

  const remainder = match[2].trim();
  if (!remainder) {
    return null;
  }

  const separatorMatch = remainder.match(/^(.+?)(?:\s*[:.)\-]\s+)(.+)$/u);
  const numberPhrase = separatorMatch?.[1]?.trim() || remainder;

  if (!looksLikeWrittenNumberSequence(numberPhrase)) {
    return null;
  }

  return {
    matched: true,
    strong: true,
    explicit: true,
    type: 'written_number_heading',
    number: numberPhrase,
    source: 'written_number_heading',
  };
}

function isNumberedHeading(line, normalizedLine) {
  if (!looksLikeHeading(line)) {
    return false;
  }

  return /^\d{1,4}\s*[.)\-:]\s+[\p{L}\p{N}]/u.test(line.trim())
    || /^tap\s*\d+\b/i.test(normalizedLine);
}

function detectChapterMarker(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return { matched: false, strong: false, explicit: false, type: null, number: null, source: null };
  }

  const rawMatch = extractHeadingMatch(trimmed);
  if (rawMatch) {
    return rawMatch;
  }

  const writtenMatch = extractWrittenNumberHeading(trimmed);
  if (writtenMatch) {
    return writtenMatch;
  }

  const normalized = normalizeForSearch(trimmed);
  const normalizedMatch = extractHeadingMatch(normalized);
  if (normalizedMatch) {
    return normalizedMatch;
  }

  if (isNumberedHeading(trimmed, normalized)) {
    return {
      matched: true,
      strong: false,
      explicit: false,
      type: 'numbered_heading',
      number: (trimmed.match(/^(\d{1,4}|[ivxlcdm]+)/iu) || [])[1] || null,
      source: 'numbered_heading',
    };
  }

  return { matched: false, strong: false, explicit: false, type: null, number: null, source: null };
}

export function isChapterMarker(line = '') {
  return detectChapterMarker(line).matched;
}

function getNearbyLines(lines, startIndex, direction, limit = 4) {
  const results = [];

  for (
    let index = startIndex + direction;
    index >= 0 && index < lines.length && results.length < limit;
    index += direction
  ) {
    results.push({
      index,
      text: lines[index],
    });
  }

  return results;
}

function collectBlockWordCount(lines = [], startIndex = 0, direction = 1, maxLines = 6) {
  const collected = [];

  for (
    let index = startIndex;
    index >= 0 && index < lines.length && collected.length < maxLines;
    index += direction
  ) {
    const line = String(lines[index] || '').trim();
    if (!line || isDecorativeSeparator(line)) {
      continue;
    }

    collected.push(line);
  }

  return countWords(collected.join(' '));
}

function extractFrontMatterCandidates(lines = []) {
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '').trim();
    if (!line) {
      continue;
    }

    if (detectChapterMarker(line).strong) {
      break;
    }

    if (isDecorativeSeparator(line) || isFrontMatterLine(line)) {
      candidates.push({
        lineIndex: index,
        lineNumber: index + 1,
        text: line,
        kind: isDecorativeSeparator(line) ? 'separator' : 'front_matter',
      });
    }
  }

  return candidates;
}

function detectChapterHeadingCandidates(lines = []) {
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed || isDecorativeSeparator(trimmed)) {
      continue;
    }

    const markerInfo = detectChapterMarker(trimmed);
    const normalized = normalizeForSearch(trimmed);
    const weakHeading = !markerInfo.matched && looksLikeHeading(trimmed);
    if (!markerInfo.matched && !weakHeading) {
      continue;
    }

    const prevNonEmpty = getNearbyLines(lines, index, -1, 3).find((item) => item.text.trim());
    const nextNonEmpty = getNearbyLines(lines, index, 1, 3).find((item) => item.text.trim());

    candidates.push({
      lineIndex: index,
      lineNumber: index + 1,
      text: trimmed,
      normalizedText: normalized,
      markerInfo,
      hasSeparatorAbove: Boolean(prevNonEmpty?.text && isDecorativeSeparator(prevNonEmpty.text)),
      hasSeparatorBelow: Boolean(nextNonEmpty?.text && isDecorativeSeparator(nextNonEmpty.text)),
      previousLine: prevNonEmpty?.text?.trim() || '',
      nextLine: nextNonEmpty?.text?.trim() || '',
      previousBlockWords: collectBlockWordCount(lines, index - 1, -1),
      nextBlockWords: collectBlockWordCount(lines, index + 1, 1),
    });
  }

  return candidates;
}

function looksLikeSentenceTitle(title = '') {
  const trimmed = String(title || '').trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 10) {
    return true;
  }

  return /[,.;!?:"'“”‘’]/u.test(trimmed);
}

function scoreHeadingCandidates(candidates = []) {
  return candidates.map((candidate) => {
    let score = 0;
    const reasons = [];

    if (candidate.markerInfo.strong) {
      score += 8;
      reasons.push('strong_marker');
    }

    if (candidate.markerInfo.explicit) {
      score += 3;
      reasons.push('explicit_keyword');
    }

    if (candidate.markerInfo.number) {
      score += 3;
      reasons.push('has_number');
    }

    if (candidate.hasSeparatorAbove || candidate.hasSeparatorBelow) {
      score += 2;
      reasons.push('separator_context');
    }

    const words = countWords(candidate.text);
    if (words > 0 && words <= 10) {
      score += 2;
      reasons.push('short_heading');
    } else if (words > 18) {
      score -= 4;
      reasons.push('too_long');
    }

    if (!candidate.previousLine || isDecorativeSeparator(candidate.previousLine)) {
      score += 1;
      reasons.push('isolated_above');
    }

    if (candidate.nextBlockWords >= 20) {
      score += 2;
      reasons.push('followed_by_content');
    } else if (candidate.nextBlockWords <= 3) {
      score -= 2;
      reasons.push('weak_follow_content');
    }

    if (looksLikeSentenceTitle(candidate.text)) {
      score -= 5;
      reasons.push('sentence_like');
    }

    if (/^["'“”‘’]/u.test(candidate.text)) {
      score -= 4;
      reasons.push('dialogue_like');
    }

    if (isFrontMatterLine(candidate.text)) {
      score -= 6;
      reasons.push('front_matter_like');
    }

    if ((candidate.text.match(/[,.;!?]/g) || []).length >= 2) {
      score -= 3;
      reasons.push('punctuation_heavy');
    }

    const accepted = score >= 8 || (candidate.markerInfo.strong && score >= 6);
    return {
      ...candidate,
      score,
      reasons,
      accepted,
    };
  });
}

function normalizeHeadingIdentity(text = '') {
  return normalizeForSearch(String(text || ''))
    .replace(/^(chuong|chapter|chap|phan|part|quyen|hoi|tap|ch)\s+/i, '')
    .replace(/^(\d+|[ivxlcdm]+)\s*/i, '')
    .trim();
}

function validateAcceptedBoundaries(candidates = [], lines = [], options = {}) {
  const accepted = [];
  const rejected = [];
  const minWordsBeforeSplit = Number(options.minWordsBeforeSplit || 20);

  for (const candidate of candidates) {
    if (!candidate.accepted) {
      rejected.push({ ...candidate, rejectedReason: 'low_score' });
      continue;
    }

    const previous = accepted[accepted.length - 1];
    if (previous) {
      const distance = candidate.lineIndex - previous.lineIndex;
      const sameHeading = normalizeHeadingIdentity(candidate.text) === normalizeHeadingIdentity(previous.text);
      if (sameHeading && distance <= 4) {
        rejected.push({ ...candidate, rejectedReason: 'duplicate_heading' });
        continue;
      }

      const betweenWords = countWords(
        lines
          .slice(previous.lineIndex + 1, candidate.lineIndex)
          .filter((line) => !isIgnorablePreambleLine(line))
          .join(' '),
      );

      if (betweenWords < minWordsBeforeSplit && !candidate.markerInfo.strong) {
        rejected.push({ ...candidate, rejectedReason: 'too_close_to_previous' });
        continue;
      }
    }

    accepted.push(candidate);
  }

  return { accepted, rejected };
}

function trimLeadingChapterBoilerplate(lines = [], headingText = '') {
  const result = [...lines];
  const normalizedHeading = normalizeForSearch(headingText);

  while (result.length > 0 && isIgnorablePreambleLine(result[0])) {
    result.shift();
  }

  if (result.length > 0 && normalizeForSearch(result[0]) === normalizedHeading) {
    result.shift();
  }

  while (result.length > 0 && isIgnorablePreambleLine(result[0])) {
    result.shift();
  }

  return result;
}

function cleanChapterTitle(title = '', fallback = 'Chapter 1') {
  let normalized = cleanTitle(title, fallback);

  for (let guard = 0; guard < 3; guard += 1) {
    const next = normalized
      .replace(/^(chương|chuong|chapter|chap|ch\.?)\s*/iu, (match) => match)
      .trim();

    if (next === normalized) {
      break;
    }

    normalized = next;
  }

  const duplicatedPrefix = normalized.match(/^(chương|chuong|chapter)\s+(\d+|[ivxlcdm]+)\s*[:.)\-]?\s*(.*)$/iu);
  if (duplicatedPrefix?.[3]) {
    const tail = duplicatedPrefix[3].trim();
    const tailNormalized = normalizeForSearch(tail);
    const prefixNormalized = normalizeForSearch(`${duplicatedPrefix[1]} ${duplicatedPrefix[2]}`);
    if (tailNormalized.startsWith(prefixNormalized)) {
      normalized = tail;
    }
  }

  return cleanTitle(normalized, fallback);
}

function splitByAcceptedBoundaries(lines = [], accepted = [], options = {}) {
  const fallbackTitlePrefix = options.fallbackTitlePrefix || 'Chapter';
  const chapters = [];

  if (accepted.length === 0) {
    const content = sanitizeWhitespace(lines.join('\n'));
    if (!content) {
      return {
        frontMatter: null,
        chapters: [],
      };
    }

    return {
      frontMatter: null,
      chapters: [{
        title: `${fallbackTitlePrefix} 1`,
        content,
        startLine: 1,
        endLine: lines.length,
        wordCount: countWords(content),
      }],
    };
  }

  const firstBoundary = accepted[0];
  const frontMatterLines = lines.slice(0, firstBoundary.lineIndex);
  const frontMatterContent = sanitizeWhitespace(frontMatterLines.join('\n'));
  const frontMatter = frontMatterContent
    ? {
      content: frontMatterContent,
      startLine: 1,
      endLine: Math.max(1, firstBoundary.lineIndex),
      wordCount: countWords(frontMatterContent),
    }
    : null;

  for (let index = 0; index < accepted.length; index += 1) {
    const boundary = accepted[index];
    const nextBoundary = accepted[index + 1];
    const chapterStart = boundary.lineIndex;
    const chapterEnd = nextBoundary ? nextBoundary.lineIndex - 1 : lines.length - 1;
    const contentLines = trimLeadingChapterBoilerplate(
      lines.slice(chapterStart + 1, chapterEnd + 1),
      boundary.text,
    );
    const content = sanitizeWhitespace(contentLines.join('\n'));

    if (!content) {
      continue;
    }

    chapters.push({
      title: cleanChapterTitle(boundary.text, `${fallbackTitlePrefix} ${chapters.length + 1}`),
      content,
      startLine: chapterStart + 1,
      endLine: chapterEnd + 1,
      wordCount: countWords(content),
    });
  }

  return { frontMatter, chapters };
}

function mergeChapterBodies(target, source, mode = 'append') {
  const targetContent = sanitizeWhitespace(target?.content || '');
  const sourceContent = sanitizeWhitespace(source?.content || '');
  const content = mode === 'prepend'
    ? sanitizeWhitespace([sourceContent, targetContent].filter(Boolean).join('\n\n'))
    : sanitizeWhitespace([targetContent, sourceContent].filter(Boolean).join('\n\n'));

  return {
    ...target,
    content,
    wordCount: countWords(content),
    startLine: mode === 'prepend' ? (source?.startLine ?? target?.startLine) : target?.startLine,
    endLine: mode === 'append' ? (source?.endLine ?? target?.endLine) : target?.endLine,
  };
}

function isGenericFallbackTitle(title = '') {
  return GENERIC_FALLBACK_TITLE_REGEX.test(String(title || '').trim());
}

function mergeSuspiciousChapters(chapters = [], options = {}) {
  const minChapterWords = Math.max(10, Number(options.minChapterWords || 30));
  if (!Array.isArray(chapters) || chapters.length <= 1) {
    return chapters;
  }

  const merged = [];

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!chapter?.content) {
      continue;
    }

    const current = {
      ...chapter,
      wordCount: countWords(chapter.content),
    };
    const titleInfo = detectChapterMarker(current.title || '');
    const next = chapters[index + 1];
    const nextTitleInfo = detectChapterMarker(next?.title || '');

    const isCoverLikeLead = (
      merged.length === 0
      && !titleInfo.strong
      && current.wordCount < Math.max(minChapterWords * 2, 80)
      && next
      && nextTitleInfo.strong
    );

    if (isCoverLikeLead) {
      chapters[index + 1] = mergeChapterBodies(next, current, 'prepend');
      continue;
    }

    const isGenericFrontLead = (
      merged.length === 0
      && isGenericFallbackTitle(current.title || '')
      && current.wordCount < Math.max(minChapterWords * 8, 420)
      && next
      && nextTitleInfo.strong
    );

    if (isGenericFrontLead) {
      chapters[index + 1] = mergeChapterBodies(next, current, 'prepend');
      continue;
    }

    const previous = merged[merged.length - 1];
    const shouldMergeIntoPrevious = (
      previous
      && current.wordCount < minChapterWords
      && !titleInfo.strong
    ) || (
      previous
      && !titleInfo.strong
      && looksLikeSentenceTitle(current.title || '')
    );

    if (shouldMergeIntoPrevious) {
      merged[merged.length - 1] = mergeChapterBodies(previous, current, 'append');
      continue;
    }

    merged.push(current);
  }

  return merged.map((chapter, index) => ({
    ...chapter,
    title: cleanChapterTitle(chapter.title, `Chapter ${index + 1}`),
    wordCount: countWords(chapter.content),
  }));
}

function cleanChapterTitles(chapters = [], options = {}) {
  const fallbackTitlePrefix = options.fallbackTitlePrefix || 'Chapter';

  return chapters.map((chapter, index) => {
    const fallback = `${fallbackTitlePrefix} ${index + 1}`;
    const cleanedTitle = cleanChapterTitle(chapter.title, fallback);
    return {
      ...chapter,
      title: cleanedTitle,
      wordCount: countWords(chapter.content),
    };
  });
}

export function analyzeChapterSegmentation(rawText, options = {}) {
  const normalizedText = normalizeRawText(rawText);
  const lines = normalizedText.split('\n');
  const frontMatterCandidates = extractFrontMatterCandidates(lines);
  const headingCandidates = detectChapterHeadingCandidates(lines);
  const scoredCandidates = scoreHeadingCandidates(headingCandidates);
  const { accepted, rejected } = validateAcceptedBoundaries(scoredCandidates, lines, options);
  const split = splitByAcceptedBoundaries(lines, accepted, options);
  const merged = mergeSuspiciousChapters(split.chapters, options);
  const chapters = cleanChapterTitles(merged, options);

  return {
    normalizedText,
    frontMatter: split.frontMatter,
    chapters,
    diagnostics: {
      frontMatterCandidates,
      headingCandidates: scoredCandidates.map((candidate) => ({
        lineNumber: candidate.lineNumber,
        text: candidate.text,
        score: candidate.score,
        reasons: candidate.reasons,
        accepted: candidate.accepted,
        markerType: candidate.markerInfo.type,
        hasSeparatorAbove: candidate.hasSeparatorAbove,
        hasSeparatorBelow: candidate.hasSeparatorBelow,
      })),
      acceptedBoundaries: accepted.map((candidate) => ({
        lineNumber: candidate.lineNumber,
        text: candidate.text,
        score: candidate.score,
      })),
      rejectedBoundaries: rejected.map((candidate) => ({
        lineNumber: candidate.lineNumber,
        text: candidate.text,
        score: candidate.score,
        rejectedReason: candidate.rejectedReason,
      })),
      chapterCount: chapters.length,
      hasFrontMatter: Boolean(split.frontMatter?.content),
    },
  };
}

export function splitTextIntoChapters(rawText, options = {}) {
  return analyzeChapterSegmentation(rawText, options).chapters;
}
