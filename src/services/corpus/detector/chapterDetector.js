import { cleanTitle, countWords, normalizeForSearch, sanitizeWhitespace } from '../utils/textUtils.js';

const RAW_PATTERNS = [
  /^(chuong|chương|chapter|chap|ch)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/iu,
  /^(phan|phần|part|pt)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/iu,
  /^\s*={3,}.+={3,}\s*$/u,
  /^\s*[\[【]\s*(\d+|[ivxlcdm]+)\s*[\]】]\s*[-–—:]?\s*.+$/iu,
];

const NORMALIZED_PATTERNS = [
  /^(chuong|chapter|chap|ch)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/i,
  /^ch[a-z0-9_?]{0,4}ng\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/i,
  /^(phan|part|pt)\s*[.:#\-]?\s*(\d+|[ivxlcdm]+)\b/i,
  /^\s*={3,}.+={3,}\s*$/,
];

function looksLikeHeading(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length > 120) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 18) {
    return false;
  }

  const alphaCount = (trimmed.match(/[\p{L}]/gu) || []).length;
  return alphaCount >= 3;
}

function isNumberedHeading(line, normalizedLine) {
  if (!looksLikeHeading(line)) {
    return false;
  }

  return /^\d{1,4}\s*[.)\-:]\s+[\p{L}\p{N}]/u.test(line.trim())
    || /^tap\s*\d+\b/i.test(normalizedLine);
}

export function isChapterMarker(line = '') {
  return detectChapterMarker(line).matched;
}

function detectChapterMarker(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return { matched: false, strong: false };
  }

  if (RAW_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { matched: true, strong: true };
  }

  const normalized = normalizeForSearch(trimmed);
  if (NORMALIZED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { matched: true, strong: true };
  }

  if (isNumberedHeading(trimmed, normalized)) {
    return { matched: true, strong: false };
  }

  return { matched: false, strong: false };
}

function finalizeChapter(chapters, current, fallbackPrefix) {
  const content = sanitizeWhitespace(current.content.join('\n'));
  if (!content) {
    return;
  }

  const index = chapters.length + 1;
  chapters.push({
    title: cleanTitle(current.title, `${fallbackPrefix} ${index}`),
    content,
    startLine: current.startLine,
    endLine: current.endLine,
    wordCount: countWords(content),
  });
}

function mergeSmallChapters(chapters, minChapterWords) {
  const merged = [];

  for (const chapter of chapters) {
    if (!chapter?.content) {
      continue;
    }

    const normalized = {
      ...chapter,
      wordCount: countWords(chapter.content),
    };

    if (normalized.wordCount <= 0) {
      continue;
    }

    const last = merged[merged.length - 1];
    const titleMarker = detectChapterMarker(normalized.title || '');
    const shouldMerge = (
      last
      && normalized.wordCount < minChapterWords
      && !titleMarker.strong
    );

    if (!shouldMerge) {
      merged.push(normalized);
      continue;
    }

    const mergedContent = sanitizeWhitespace(`${last.content}\n\n${normalized.content}`);
    last.content = mergedContent;
    last.wordCount = countWords(mergedContent);
    last.endLine = normalized.endLine ?? last.endLine;
  }

  return merged;
}

export function splitTextIntoChapters(rawText, options = {}) {
  const fallbackTitlePrefix = options.fallbackTitlePrefix || 'Chapter';
  const minWordsBeforeSplit = Number(options.minWordsBeforeSplit || 20);
  const minChapterWords = Math.max(10, Number(options.minChapterWords || 30));
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');

  const chapters = [];
  let current = {
    title: '',
    content: [],
    startLine: 1,
    endLine: 1,
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    const markerInfo = detectChapterMarker(trimmed);
    const marker = markerInfo.matched;
    const currentWordCount = countWords(current.content.join(' '));

    if (marker) {
      if (current.content.length === 0) {
        current.title = cleanTitle(trimmed, current.title || '');
        current.startLine = lineNumber;
        continue;
      }

      const canSplit = markerInfo.strong || currentWordCount >= minWordsBeforeSplit;
      if (canSplit) {
        current.endLine = lineNumber - 1;
        finalizeChapter(chapters, current, fallbackTitlePrefix);
        current = {
          title: cleanTitle(trimmed, ''),
          content: [],
          startLine: lineNumber,
          endLine: lineNumber,
        };
        continue;
      }
    }

    current.content.push(line);
    current.endLine = lineNumber;
  }

  finalizeChapter(chapters, current, fallbackTitlePrefix);

  if (chapters.length > 0) {
    return mergeSmallChapters(chapters, minChapterWords);
  }

  const fallbackContent = sanitizeWhitespace(rawText || '');
  if (!fallbackContent) {
    return [];
  }

  return [
    {
      title: `${fallbackTitlePrefix} 1`,
      content: fallbackContent,
      startLine: 1,
      endLine: lines.length,
      wordCount: countWords(fallbackContent),
    },
  ];
}
