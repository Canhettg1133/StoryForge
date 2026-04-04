import { randomUUID } from 'node:crypto';
import { extractWords, sanitizeWhitespace } from './utils/textUtils.js';

function countWords(text) {
  return extractWords(text).length;
}

function splitByWordLimit(text, chunkSizeWords) {
  const words = extractWords(text);
  if (words.length === 0) {
    return [];
  }

  const parts = [];
  for (let index = 0; index < words.length; index += chunkSizeWords) {
    parts.push(words.slice(index, index + chunkSizeWords).join(' '));
  }

  return parts;
}

function splitLongParagraph(paragraphText, chunkSizeWords) {
  const sentenceParts = paragraphText
    .split(/(?<=[.!?])\s+/u)
    .map((item) => sanitizeWhitespace(item))
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return splitByWordLimit(paragraphText, chunkSizeWords);
  }

  const output = [];
  let current = [];
  let currentWords = 0;

  for (const sentence of sentenceParts) {
    const sentenceWords = countWords(sentence);
    if (sentenceWords === 0) {
      continue;
    }

    if (sentenceWords > chunkSizeWords) {
      if (current.length > 0) {
        output.push(current.join(' '));
        current = [];
        currentWords = 0;
      }
      output.push(...splitByWordLimit(sentence, chunkSizeWords));
      continue;
    }

    if (currentWords > 0 && currentWords + sentenceWords > chunkSizeWords) {
      output.push(current.join(' '));
      current = [];
      currentWords = 0;
    }

    current.push(sentence);
    currentWords += sentenceWords;
  }

  if (current.length > 0) {
    output.push(current.join(' '));
  }

  return output;
}

function toUnits(chapters = [], chunkSizeWords, preserveParagraphs = true) {
  const units = [];

  for (const chapter of chapters) {
    const chapterId = chapter?.id;
    if (!chapterId) {
      continue;
    }

    const content = sanitizeWhitespace(chapter?.content || '');
    if (!content) {
      continue;
    }

    const baseParts = preserveParagraphs
      ? content.split(/\n\s*\n+/u)
      : content.split(/\n+/u);

    for (const basePart of baseParts) {
      const cleaned = sanitizeWhitespace(basePart);
      if (!cleaned) {
        continue;
      }

      const wordCount = countWords(cleaned);
      if (wordCount === 0) {
        continue;
      }

      if (wordCount > chunkSizeWords) {
        const longParts = splitLongParagraph(cleaned, chunkSizeWords);
        for (const part of longParts) {
          const partWords = countWords(part);
          if (partWords === 0) {
            continue;
          }

          units.push({
            chapterId,
            text: part,
            wordCount: partWords,
          });
        }
        continue;
      }

      units.push({
        chapterId,
        text: cleaned,
        wordCount,
      });
    }
  }

  return units;
}

function makeChunkState(startPosition = 0) {
  return {
    texts: [],
    chapterIds: [],
    wordCount: 0,
    startPosition,
  };
}

function pushUnique(values, item) {
  if (!item) {
    return;
  }
  if (!values.includes(item)) {
    values.push(item);
  }
}

export function createRechunkRows({
  corpusId,
  chapters = [],
  chunkSizeWords,
  preserveParagraphs = true,
} = {}) {
  if (!corpusId) {
    return [];
  }

  const safeChunkSize = Math.max(1, Number(chunkSizeWords) || 1);
  const units = toUnits(chapters, safeChunkSize, preserveParagraphs);
  if (units.length === 0) {
    return [];
  }

  const fallbackChapterId = chapters.find((item) => item?.id)?.id || units[0].chapterId;

  const chunks = [];
  let absoluteWordOffset = 0;
  let current = makeChunkState(absoluteWordOffset);

  const flush = () => {
    if (current.wordCount === 0) {
      return;
    }

    const text = sanitizeWhitespace(current.texts.join('\n\n'));
    const words = extractWords(text);
    if (words.length === 0) {
      current = makeChunkState(absoluteWordOffset);
      return;
    }

    chunks.push({
      id: randomUUID(),
      chapterId: current.chapterIds[0] || fallbackChapterId,
      corpusId,
      index: chunks.length + 1,
      text,
      wordCount: words.length,
      startWord: words[0] || null,
      endWord: words[words.length - 1] || null,
      startPosition: current.startPosition,
      chapterIds: [...current.chapterIds],
    });

    current = makeChunkState(absoluteWordOffset);
  };

  for (const unit of units) {
    if (current.wordCount > 0 && current.wordCount + unit.wordCount > safeChunkSize) {
      flush();
    }

    current.texts.push(unit.text);
    current.wordCount += unit.wordCount;
    pushUnique(current.chapterIds, unit.chapterId);

    absoluteWordOffset += unit.wordCount;
  }

  flush();
  return chunks;
}
