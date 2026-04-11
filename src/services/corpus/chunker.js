import { cleanTitle, countWords, extractWords, sanitizeWhitespace } from './utils/textUtils.js';

export const CHUNK_SIZE_OPTIONS = [500, 750, 1500];
export const DEFAULT_CHUNK_SIZE = 750;

const CHUNK_OVERLAP = {
  500: 60,
  750: 100,
  1500: 200,
};

function splitLongSegment(segment, chunkSize) {
  const bySentence = segment
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => sanitizeWhitespace(part))
    .filter(Boolean);

  if (bySentence.length <= 1) {
    const words = extractWords(segment);
    const chunks = [];
    for (let index = 0; index < words.length; index += chunkSize) {
      chunks.push(words.slice(index, index + chunkSize).join(' '));
    }
    return chunks;
  }

  return bySentence;
}

function normalizeOverlap(chunkSize, overlapInput) {
  const defaultOverlap = CHUNK_OVERLAP[chunkSize] || 100;
  const parsed = Number(overlapInput);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultOverlap;
  }

  return Math.min(Math.floor(chunkSize / 2), Math.max(20, Math.round(parsed)));
}

export function normalizeChunkSize(chunkSizeInput) {
  const parsed = Number(chunkSizeInput);
  if (CHUNK_SIZE_OPTIONS.includes(parsed)) {
    return parsed;
  }
  return DEFAULT_CHUNK_SIZE;
}

export function createChunks(chapter, options = {}) {
  const chunkSize = normalizeChunkSize(options.chunkSize);
  const overlap = normalizeOverlap(chunkSize, options.overlap);
  const chapterTitle = cleanTitle(chapter?.title, 'Chapter');
  const chapterId = chapter?.id;
  const chapterContent = sanitizeWhitespace(chapter?.content || '');

  if (!chapterContent) {
    return [];
  }

  const preserveParagraphs = options.preserveParagraphs !== false;
  const baseSegments = preserveParagraphs
    ? chapterContent.split(/\n\s*\n+/u)
    : chapterContent.split(/\n+/u);

  const segments = [];
  for (const segment of baseSegments) {
    const cleanSegment = sanitizeWhitespace(segment);
    if (!cleanSegment) {
      continue;
    }

    const segmentWords = countWords(cleanSegment);
    if (segmentWords > chunkSize) {
      segments.push(...splitLongSegment(cleanSegment, chunkSize));
      continue;
    }

    segments.push(cleanSegment);
  }

  const chunks = [];
  let currentSegments = [];
  let currentWordCount = 0;
  let overlapTail = [];

  const flushChunk = () => {
    const text = sanitizeWhitespace(currentSegments.join('\n\n'));
    if (!text) {
      return;
    }

    const words = extractWords(text);
    if (words.length === 0) {
      return;
    }

    const chunkIndex = chunks.length;
    chunks.push({
      id: `${chapterId}_chunk_${chunkIndex + 1}`,
      chapterId,
      chapterTitle,
      index: chunkIndex,
      text,
      wordCount: words.length,
      startWord: words[0] || null,
      endWord: words[words.length - 1] || null,
    });

    overlapTail = words.slice(-overlap);
  };

  for (const segment of segments) {
    const segmentWordCount = countWords(segment);
    if (segmentWordCount === 0) {
      continue;
    }

    if (currentWordCount > 0 && currentWordCount + segmentWordCount > chunkSize) {
      flushChunk();
      currentSegments = overlapTail.length > 0 ? [overlapTail.join(' ')] : [];
      currentWordCount = overlapTail.length;
    }

    currentSegments.push(segment);
    currentWordCount += segmentWordCount;
  }

  if (currentSegments.length > 0) {
    flushChunk();
  }

  return chunks;
}

export function createChunksForChapters(chapters = [], options = {}) {
  return chapters.flatMap((chapter) => createChunks(chapter, options));
}
