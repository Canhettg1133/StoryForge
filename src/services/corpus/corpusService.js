import { randomUUID } from 'node:crypto';
import { createChunks, normalizeChunkSize } from './chunker.js';
import {
  calculateNewChunks,
  estimateAnalysisTime,
  getContextLimits,
  getPartsPerChunk,
  normalizeParallelChunks,
  resolveChunkSizeWords,
  resolveModel,
  validateChunkSize,
} from './chunkCalculator.js';
import {
  corpusRepository,
} from './repositories/corpusRepository.js';
import { getFandomSuggestion } from './detector/fandomDetector.js';
import { parseCorpusFile } from './parser/index.js';
import { createRechunkRows } from './rechunker.js';
import { cleanTitle, countWords, sanitizeWhitespace } from './utils/textUtils.js';

function parseMetadata(metadataInput) {
  if (!metadataInput) {
    return {};
  }

  if (typeof metadataInput === 'object') {
    return metadataInput;
  }

  if (typeof metadataInput === 'string') {
    try {
      const parsed = JSON.parse(metadataInput);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeString(value, fallback = null) {
  if (value == null) {
    return fallback;
  }

  const normalized = sanitizeWhitespace(String(value));
  return normalized || fallback;
}

function normalizeLanguage(value, fallback = 'vi') {
  const normalized = normalizeString(value, fallback);
  return normalized ? normalized.toLowerCase() : fallback;
}

function createServiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
  }

  if (value == null) {
    return fallback;
  }

  return Boolean(value);
}

export async function createCorpusFromUpload({ file, metadata, chunkSize }) {
  if (!file?.buffer || !file.originalname) {
    const error = new Error('Thiếu file tải lên.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const parsedMetadata = parseMetadata(metadata);
  const safeChunkSize = normalizeChunkSize(chunkSize || parsedMetadata.chunkSize);

  const parsed = await parseCorpusFile({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
    options: {
      language: parsedMetadata.language,
    },
  });

  if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    const error = new Error('Không thể tách nội dung chương từ file.');
    error.code = 'PARSE_FAILED';
    throw error;
  }

  const corpusId = randomUUID();
  const now = Date.now();

  const chapterRows = [];
  const chunkRows = [];
  let totalWords = 0;

  for (let chapterIndex = 0; chapterIndex < parsed.chapters.length; chapterIndex += 1) {
    const source = parsed.chapters[chapterIndex] || {};
    const content = sanitizeWhitespace(source.content || '');

    if (!content) {
      continue;
    }

    const chapterId = randomUUID();
    const chapterNumber = chapterRows.length + 1;
    const chapterWordCount = countWords(content);
    totalWords += chapterWordCount;

    const chapterRow = {
      id: chapterId,
      corpusId,
      index: chapterNumber,
      title: cleanTitle(source.title, `Chapter ${chapterNumber}`),
      content,
      wordCount: chapterWordCount,
      startLine: source.startLine ?? null,
      endLine: source.endLine ?? null,
      startPage: source.startPage ?? null,
      endPage: source.endPage ?? null,
    };

    chapterRows.push(chapterRow);

    const chapterChunks = createChunks(
      {
        id: chapterId,
        title: chapterRow.title,
        content,
      },
      {
        chunkSize: safeChunkSize,
      },
    );

    for (let chunkIndex = 0; chunkIndex < chapterChunks.length; chunkIndex += 1) {
      const chunk = chapterChunks[chunkIndex];
      chunkRows.push({
        id: randomUUID(),
        chapterId,
        corpusId,
        index: chunkIndex + 1,
        text: chunk.text,
        wordCount: chunk.wordCount,
        startPosition: null,
        startWord: chunk.startWord,
        endWord: chunk.endWord,
      });
    }
  }

  if (chapterRows.length === 0) {
    const error = new Error('File không chứa nội dung chương có thể đọc được.');
    error.code = 'PARSE_FAILED';
    throw error;
  }

  const fandomSampleText = chapterRows
    .slice(0, 3)
    .map((chapter) => chapter.content)
    .join('\n\n')
    .slice(0, 120000);
  const fandomSuggestion = getFandomSuggestion(fandomSampleText);

  const corpusRow = {
    id: corpusId,
    title: normalizeString(parsedMetadata.title)
      || normalizeString(parsed.metadata?.title)
      || cleanTitle(file.originalname.replace(/\.[^.]+$/, ''), 'Untitled'),
    author: normalizeString(parsedMetadata.author)
      || normalizeString(parsed.metadata?.author)
      || null,
    sourceFile: file.originalname,
    fileType: parsed.fileType,
    frontMatter: parsed.frontMatter || null,
    parseDiagnostics: parsed.diagnostics || null,
    fandom: normalizeString(parsedMetadata.fandom) || fandomSuggestion?.fandom || null,
    fandomConfidence: fandomSuggestion?.confidence ?? null,
    isCanonFanfic: normalizeString(parsedMetadata.isCanonFanfic) || null,
    rating: normalizeString(parsedMetadata.rating) || null,
    language: normalizeLanguage(parsedMetadata.language || parsed.metadata?.language || 'vi'),
    chunkSize: safeChunkSize,
    chunkSizeUsed: safeChunkSize,
    chunkCount: chunkRows.length,
    lastRechunkedAt: null,
    wordCount: totalWords,
    chapterCount: chapterRows.length,
    status: 'parsed',
    createdAt: now,
    updatedAt: now,
  };

  const storedCorpus = await corpusRepository.insertGraph(corpusRow, chapterRows, chunkRows);

  return {
    ...storedCorpus,
    fandomSuggestion,
  };
}

export async function listCorpusRecords(filters = {}) {
  return corpusRepository.listAsync(filters);
}

export async function getCorpusRecord(corpusId, options = {}) {
  return corpusRepository.getByIdAsync(corpusId, options);
}

export function updateCorpusRecord(corpusId, updates = {}) {
  return corpusRepository.updateById(corpusId, updates);
}

export function removeCorpusRecord(corpusId) {
  return corpusRepository.deleteById(corpusId);
}

export async function getCorpusChapter(corpusId, chapterId) {
  return corpusRepository.getChapterByIdAsync(corpusId, chapterId);
}

export async function getCorpusChunkPreview(corpusId, options = {}) {
  const corpus = await corpusRepository.getByIdAsync(corpusId, { includeChapterContent: false });
  if (!corpus) {
    throw createServiceError('CORPUS_NOT_FOUND', 'Corpus không tồn tại.');
  }

  const preset = options.preset;
  const model = resolveModel(options.model, preset);
  const chunkSizeWords = resolveChunkSizeWords({
    preset,
    customWords: options.chunkSizeWords ?? options.customWords,
  });

  if (!chunkSizeWords) {
    throw createServiceError('INVALID_INPUT', 'chunkSizeWords không hợp lệ.');
  }

  const parallelChunks = normalizeParallelChunks(options.parallelChunks);
  const validation = validateChunkSize(chunkSizeWords, model, preset);
  const chunkStats = calculateNewChunks(corpus.wordCount, chunkSizeWords, corpus.chunkCount);
  const partsPerChunk = getPartsPerChunk(model, preset);
  const time = estimateAnalysisTime(chunkStats.newChunkCount, partsPerChunk, parallelChunks);
  const limits = getContextLimits(model, preset);

  return {
    corpusId: corpus.id,
    model,
    parallelChunks,
    partsPerChunk,
    outputTokens: limits.outputTokens,
    validation,
    ...chunkStats,
    ...time,
  };
}

export async function rechunkCorpusRecord(corpusId, options = {}) {
  const corpus = await corpusRepository.getByIdAsync(corpusId, { includeChapterContent: true });
  if (!corpus) {
    throw createServiceError('CORPUS_NOT_FOUND', 'Corpus không tồn tại.');
  }

  const preset = options.preset;
  const model = resolveModel(options.model, preset);
  const chunkSizeWords = resolveChunkSizeWords({
    preset,
    customWords: options.chunkSizeWords ?? options.customWords,
  });

  if (!chunkSizeWords) {
    throw createServiceError('INVALID_INPUT', 'chunkSizeWords không hợp lệ.');
  }

  const validation = validateChunkSize(chunkSizeWords, model, preset);
  if (!validation.valid) {
    throw createServiceError('CONTEXT_LIMIT_EXCEEDED', validation.warning || 'Chunk vượt giới hạn ngữ cảnh.');
  }

  const preserveParagraphs = normalizeBoolean(options.preserveParagraphs, true);
  const newChunkRows = createRechunkRows({
    corpusId,
    chapters: corpus.chapters || [],
    chunkSizeWords,
    preserveParagraphs,
  });

  if (newChunkRows.length === 0) {
    throw createServiceError('PARSE_FAILED', 'Không thể tạo chunk mới từ corpus hiện tại.');
  }

  const savedChunkCount = await corpusRepository.replaceChunks(corpusId, newChunkRows);
  const savedAt = Date.now();
  const parallelChunks = normalizeParallelChunks(options.parallelChunks);
  const partsPerChunk = getPartsPerChunk(model, preset);

  const updatedCorpus = await corpusRepository.updateById(corpusId, {
    chunkSize: chunkSizeWords,
    chunkSizeUsed: chunkSizeWords,
    chunkCount: savedChunkCount,
    lastRechunkedAt: savedAt,
  });

  if (!updatedCorpus) {
    throw createServiceError('CORPUS_NOT_FOUND', 'Corpus không tồn tại.');
  }

  return {
    corpus: updatedCorpus,
    originalChunkCount: Number(corpus.chunkCount || 0),
    newChunkCount: savedChunkCount,
    chunkSizeUsed: chunkSizeWords,
    preserveParagraphs,
    savedAt,
    validation,
    ...estimateAnalysisTime(savedChunkCount, partsPerChunk, parallelChunks),
  };
}

export { parseMetadata };
