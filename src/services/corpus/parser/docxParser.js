import mammoth from 'mammoth';
import { splitTextIntoChapters } from '../detector/chapterDetector.js';
import { cleanTitle, countWords, stripHtml } from '../utils/textUtils.js';

const HEADING_REGEX = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

export async function parseDocx(buffer, options = {}) {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );

  const [rawResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml({ arrayBuffer }),
  ]);

  const rawText = (rawResult?.value || '').trim();
  const html = htmlResult?.value || '';
  const chapters = [];

  const headings = [];
  let match;
  while ((match = HEADING_REGEX.exec(html)) !== null) {
    headings.push({
      level: Number(match[1]),
      title: stripHtml(match[2]),
      index: match.index,
      end: HEADING_REGEX.lastIndex,
    });
  }

  if (headings.length > 0) {
    for (let index = 0; index < headings.length; index += 1) {
      const current = headings[index];
      const next = headings[index + 1];
      const contentStart = current.end;
      const contentEnd = next ? next.index : html.length;
      const contentHtml = html.slice(contentStart, contentEnd);
      const content = stripHtml(contentHtml);

      if (!content || countWords(content) < 20) {
        continue;
      }

      chapters.push({
        title: cleanTitle(current.title, `Chapter ${chapters.length + 1}`),
        content,
        headingLevel: current.level,
      });
    }
  }

  if (chapters.length === 0 && rawText) {
    chapters.push(...splitTextIntoChapters(rawText, {
      fallbackTitlePrefix: 'Chapter',
      minWordsBeforeSplit: 100,
    }));
  }

  if (chapters.length === 0) {
    throw new Error('DOCX parser could not extract readable text');
  }

  return {
    metadata: {
      title: cleanTitle(options.fileName || 'Untitled', 'Untitled'),
      author: null,
      language: null,
    },
    chapters,
    rawText: chapters.map((chapter) => chapter.content).join('\n\n'),
  };
}
