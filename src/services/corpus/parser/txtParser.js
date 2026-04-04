import path from 'node:path';
import { splitTextIntoChapters } from '../detector/chapterDetector.js';
import { cleanTitle, decodeTextBuffer, sanitizeWhitespace } from '../utils/textUtils.js';

function inferTitleFromFilename(fileName = '') {
  const base = path.basename(fileName || '', path.extname(fileName || ''));
  return cleanTitle(base.replace(/[_-]+/g, ' '), 'Untitled');
}

export function parseTxt(buffer, options = {}) {
  const rawText = sanitizeWhitespace(decodeTextBuffer(buffer));
  const chapters = splitTextIntoChapters(rawText, {
    fallbackTitlePrefix: options.fallbackTitlePrefix || 'Chapter',
  });

  return {
    metadata: {
      title: inferTitleFromFilename(options.fileName),
      author: null,
      language: options.language || null,
    },
    chapters,
    rawText,
  };
}
