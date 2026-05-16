import { estimateTokensDetailed } from '../labLite/tokenEstimator.js';
import {
  CHUNK_HARD_CAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  FULL_FILE_MAX_BYTES,
} from './fileSafety.js';

export {
  CHUNK_HARD_CAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  FULL_FILE_MAX_BYTES,
};

function asPositiveInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeChapters({ chapters = [], rawText = '' } = {}) {
  const normalized = (Array.isArray(chapters) ? chapters : [])
    .map((chapter, arrayIndex) => {
      const content = cleanText(chapter?.content);
      return {
        id: chapter?.id || `chapter_${arrayIndex + 1}`,
        index: asPositiveInteger(chapter?.index || chapter?.chapterIndex, arrayIndex + 1),
    title: String(chapter?.title || `Chương ${arrayIndex + 1}`).trim(),
        content,
        estimatedTokens: asPositiveInteger(
          chapter?.estimatedTokens,
          estimateTokensDetailed(content).estimatedTokens,
        ),
      };
    })
    .filter((chapter) => chapter.content);

  if (normalized.length > 0) {
    return normalized.sort((left, right) => left.index - right.index);
  }

  const fallbackText = cleanText(rawText);
  if (!fallbackText) return [];
  return [{
    id: 'chapter_1',
    index: 1,
    title: 'Toàn bộ tác phẩm',
    content: fallbackText,
    estimatedTokens: estimateTokensDetailed(fallbackText).estimatedTokens,
  }];
}

function splitParagraphs(text = '') {
  const value = cleanText(text);
  if (!value) return [];
  const paragraphs = value.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  return paragraphs.length > 0 ? paragraphs : [value];
}

function splitSentences(text = '') {
  const value = cleanText(text);
  if (!value) return [];
  const sentences = value.match(/[^.!?。！？\n]+[.!?。！？]?/gu) || [value];
  return sentences.map((part) => part.trim()).filter(Boolean);
}

function splitByCharacterBudget(text = '', estimatedTokens = 0) {
  const value = cleanText(text);
  if (!value) return [];
  const tokenBudget = Math.max(1, CHUNK_TARGET_TOKENS);
  const ratio = Math.max(1, estimatedTokens) / Math.max(1, value.length);
  const charBudget = Math.max(1, Math.floor(tokenBudget / ratio));
  const parts = [];
  for (let index = 0; index < value.length; index += charBudget) {
    parts.push(value.slice(index, index + charBudget).trim());
  }
  return parts.filter(Boolean);
}

function proportionalTokens(part, totalText, totalEstimatedTokens) {
  const rawEstimate = estimateTokensDetailed(part).estimatedTokens;
  const normalizedTotal = cleanText(totalText);
  const declaredTotal = asPositiveInteger(totalEstimatedTokens, rawEstimate);
  if (!normalizedTotal || declaredTotal <= rawEstimate) return rawEstimate;

  const share = part.length / Math.max(1, normalizedTotal.length);
  return Math.max(rawEstimate, Math.ceil(declaredTotal * share));
}

function makeUnit(chapter, partText, estimatedTokens, partIndex = 0, partCount = 1) {
  return {
    id: `${chapter.id || `chapter_${chapter.index}`}_part_${partIndex + 1}`,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    partIndex: partIndex + 1,
    partCount,
    text: cleanText(partText),
    estimatedTokens: asPositiveInteger(estimatedTokens, 1),
  };
}

function splitOversizedChapter(chapter) {
  if (chapter.estimatedTokens <= CHUNK_HARD_CAP_TOKENS) {
    return [makeUnit(chapter, chapter.content, chapter.estimatedTokens)];
  }

  const paragraphUnits = [];
  const paragraphs = splitParagraphs(chapter.content);
  let current = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    const text = current.join('\n\n');
    paragraphUnits.push({
      text,
      estimatedTokens: currentTokens,
    });
    current = [];
    currentTokens = 0;
  };

  for (const paragraph of paragraphs) {
    const tokens = proportionalTokens(paragraph, chapter.content, chapter.estimatedTokens);
    if (tokens > CHUNK_HARD_CAP_TOKENS) {
      flush();
      const sentences = splitSentences(paragraph);
      let sentenceGroup = [];
      let sentenceTokens = 0;
      const flushSentenceGroup = () => {
        if (sentenceGroup.length === 0) return;
        paragraphUnits.push({
          text: sentenceGroup.join(' '),
          estimatedTokens: sentenceTokens,
        });
        sentenceGroup = [];
        sentenceTokens = 0;
      };
      for (const sentence of sentences) {
        const sentenceEstimate = proportionalTokens(sentence, paragraph, tokens);
        if (sentenceEstimate > CHUNK_HARD_CAP_TOKENS) {
          flushSentenceGroup();
          splitByCharacterBudget(sentence, sentenceEstimate).forEach((part) => {
            paragraphUnits.push({
              text: part,
              estimatedTokens: Math.min(CHUNK_HARD_CAP_TOKENS, proportionalTokens(part, sentence, sentenceEstimate)),
            });
          });
          continue;
        }
        if (sentenceGroup.length > 0 && sentenceTokens + sentenceEstimate > CHUNK_TARGET_TOKENS) {
          flushSentenceGroup();
        }
        sentenceGroup.push(sentence);
        sentenceTokens += sentenceEstimate;
      }
      flushSentenceGroup();
      continue;
    }

    if (current.length > 0 && currentTokens + tokens > CHUNK_TARGET_TOKENS) {
      flush();
    }
    current.push(paragraph);
    currentTokens += tokens;
  }
  flush();

  return paragraphUnits.map((unit, index) => makeUnit(
    chapter,
    unit.text,
    Math.min(unit.estimatedTokens, CHUNK_HARD_CAP_TOKENS),
    index,
    paragraphUnits.length,
  ));
}

function buildChunkText(units) {
  return units.map((unit) => {
    const partLabel = unit.partCount > 1 ? ` | part ${unit.partIndex}/${unit.partCount}` : '';
    return [
      `[EXCERPT | chapter ${unit.chapterIndex}${partLabel} | ${unit.chapterTitle}]`,
      unit.text,
    ].join('\n');
  }).join('\n\n');
}

function makeChunk(units, chunkIndex, totalUnits) {
  const first = units[0];
  const last = units[units.length - 1];
  const estimatedTokens = units.reduce((sum, unit) => sum + asPositiveInteger(unit.estimatedTokens, 0), 0);
  const startUnitIndex = totalUnits.findIndex((unit) => unit.id === first.id);
  const endUnitIndex = totalUnits.findIndex((unit) => unit.id === last.id);
  const denominator = Math.max(1, totalUnits.length - 1);

  return {
    id: `style_chunk_${String(chunkIndex + 1).padStart(3, '0')}`,
    label: `Mega chunk ${chunkIndex + 1}`,
    text: buildChunkText(units),
    estimatedTokens,
    chapterRange: {
      start: first.chapterIndex,
      end: last.chapterIndex,
    },
    positionPercent: {
      start: Math.round((Math.max(0, startUnitIndex) / denominator) * 100),
      end: Math.round((Math.max(0, endUnitIndex) / denominator) * 100),
    },
    unitCount: units.length,
  };
}

export function planStyleImporterChunks({
  rawText = '',
  chapters = [],
  fileSizeBytes = 0,
  totalEstimatedTokens = 0,
} = {}) {
  const normalizedChapters = normalizeChapters({ chapters, rawText });
  const estimatedTotal = asPositiveInteger(
    totalEstimatedTokens,
    normalizedChapters.reduce((sum, chapter) => sum + chapter.estimatedTokens, 0),
  );

  if (
    Number(fileSizeBytes || 0) <= FULL_FILE_MAX_BYTES
    && estimatedTotal <= CHUNK_HARD_CAP_TOKENS
  ) {
    const text = cleanText(rawText) || normalizedChapters.map((chapter) => chapter.content).join('\n\n');
    const firstChapter = normalizedChapters[0] || { index: 1 };
    const lastChapter = normalizedChapters[normalizedChapters.length - 1] || firstChapter;
    return {
      mode: 'full',
      estimatedRequests: 1,
      totalEstimatedTokens: estimatedTotal,
      chunks: [{
        id: 'style_chunk_full',
        label: 'Toàn bộ tác phẩm',
        text,
        estimatedTokens: estimatedTotal,
        chapterRange: {
          start: firstChapter.index,
          end: lastChapter.index,
        },
        positionPercent: { start: 0, end: 100 },
        unitCount: normalizedChapters.length || 1,
      }],
      warnings: [],
    };
  }

  const units = normalizedChapters.flatMap(splitOversizedChapter);
  const chunks = [];
  let current = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(makeChunk(current, chunks.length, units));
    current = [];
    currentTokens = 0;
  };

  for (const unit of units) {
    if (
      current.length > 0
      && (currentTokens + unit.estimatedTokens > CHUNK_TARGET_TOKENS
        || currentTokens + unit.estimatedTokens > CHUNK_HARD_CAP_TOKENS)
    ) {
      flush();
    }
    current.push(unit);
    currentTokens += unit.estimatedTokens;
  }
  flush();

  return {
    mode: 'chunked',
    estimatedRequests: chunks.length,
    totalEstimatedTokens: estimatedTotal,
    chunks,
    warnings: chunks.some((chunk) => chunk.estimatedTokens > CHUNK_HARD_CAP_TOKENS)
      ? ['Một số chunk vẫn vượt hard cap vì chương nguồn quá dài hoặc token estimate bất thường.']
      : [],
  };
}
