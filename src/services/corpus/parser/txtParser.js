import path from 'node:path';
import { analyzeChapterSegmentation } from '../detector/chapterDetector.js';
import { cleanTitle, decodeTextBuffer, sanitizeWhitespace } from '../utils/textUtils.js';

function inferTitleFromFilename(fileName = '') {
  const base = path.basename(fileName || '', path.extname(fileName || ''));
  return cleanTitle(base.replace(/[_-]+/g, ' '), 'Untitled');
}

export function parseTxt(buffer, options = {}) {
  const rawText = sanitizeWhitespace(decodeTextBuffer(buffer));
  const segmentation = analyzeChapterSegmentation(rawText, {
    fallbackTitlePrefix: options.fallbackTitlePrefix || 'Chapter',
  });
  const chapters = segmentation.chapters;

  return {
    metadata: {
      title: inferTitleFromFilename(options.fileName),
      author: null,
      language: options.language || null,
    },
    chapters,
    frontMatter: segmentation.frontMatter || null,
    diagnostics: segmentation.diagnostics || null,
    rawText,
  };
}
