import { createRequire } from 'node:module';
import { splitTextIntoChapters } from '../detector/chapterDetector.js';
import { cleanTitle, sanitizeWhitespace } from '../utils/textUtils.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/lib/pdf-parse.js');

function normalizePageText(textContent) {
  const lines = textContent.items
    .map((item) => (item?.str || '').trim())
    .filter(Boolean);

  return sanitizeWhitespace(lines.join(' '));
}

function buildPageGroups(pages, pagesPerGroup = 10) {
  const groups = [];

  for (let index = 0; index < pages.length; index += pagesPerGroup) {
    const start = index;
    const end = Math.min(index + pagesPerGroup, pages.length);
    const content = pages.slice(start, end).join('\n\n').trim();

    if (!content) {
      continue;
    }

    groups.push({
      title: `Part ${groups.length + 1} (Pages ${start + 1}-${end})`,
      content,
      startPage: start + 1,
      endPage: end,
    });
  }

  return groups;
}

export async function parsePdf(buffer, options = {}) {
  const pages = [];

  const data = await pdf(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
      });

      const text = normalizePageText(textContent);
      pages.push(text);
      return text;
    },
  });

  const extractedPages = pages.length > 0
    ? pages
    : String(data.text || '')
      .split(/\f+/u)
      .map((page) => sanitizeWhitespace(page))
      .filter(Boolean);

  if (extractedPages.length === 0) {
    throw new Error('PDF parser could not extract readable text');
  }

  const fullText = extractedPages.join('\n\n');
  const chapterSplit = splitTextIntoChapters(fullText, {
    fallbackTitlePrefix: 'Chapter',
    minWordsBeforeSplit: 200,
  });

  const chapters = chapterSplit.length > 1
    ? chapterSplit
    : buildPageGroups(extractedPages, Number(options.pagesPerChapter || 10));

  return {
    metadata: {
      title: cleanTitle(data?.info?.Title || options.fileName || 'Untitled', 'Untitled'),
      author: cleanTitle(data?.info?.Author || '', '') || null,
      language: null,
    },
    chapters,
    rawText: fullText,
  };
}
