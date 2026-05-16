import { analyzeChapterSegmentation } from '../corpus/detector/chapterDetector.js';
import { countLabLiteWords, estimateTokens } from './tokenEstimator.js';

function normalizeTitle(title, fallback) {
  const cleaned = String(title || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function makeChapterId(corpusId, index) {
  return `${corpusId || 'lab_lite'}_chapter_${String(index).padStart(5, '0')}`;
}

export function normalizeLabLiteChapters(chapters = [], { corpusId = '', fallbackTitlePrefix = 'Chapter' } = {}) {
  return chapters
    .map((chapter, arrayIndex) => {
      const index = arrayIndex + 1;
      const content = String(chapter?.content || '').trim();
      const title = normalizeTitle(chapter?.title, `${fallbackTitlePrefix} ${index}`);
      return {
        id: chapter?.id || makeChapterId(corpusId, index),
        corpusId,
        index,
        title,
        content,
        wordCount: countLabLiteWords(content),
        estimatedTokens: estimateTokens(content),
        startLine: Number(chapter?.startLine || 0),
        endLine: Number(chapter?.endLine || 0),
      };
    })
    .filter((chapter) => chapter.content);
}

export function parseChaptersFromText(text, options = {}) {
  const fallbackTitlePrefix = options.fallbackTitlePrefix || 'Chapter';
  const segmentation = analyzeChapterSegmentation(String(text || ''), {
    fallbackTitlePrefix,
    minWordsBeforeSplit: options.minWordsBeforeSplit,
    minChapterWords: options.minChapterWords,
  });

  return {
    rawText: segmentation.normalizedText || String(text || ''),
    chapters: normalizeLabLiteChapters(segmentation.chapters, {
      corpusId: options.corpusId || '',
      fallbackTitlePrefix,
    }),
    frontMatter: segmentation.frontMatter || null,
    diagnostics: segmentation.diagnostics || null,
  };
}

export function renameChapter(chapters = [], chapterId, title) {
  return normalizeLabLiteChapters(
    chapters.map((chapter) => (
      chapter.id === chapterId
        ? { ...chapter, title: normalizeTitle(title, chapter.title || `Chapter ${chapter.index || 1}`) }
        : chapter
    )),
    { corpusId: chapters[0]?.corpusId || '' },
  );
}

export function splitChapterAtLine(chapters = [], chapterId, lineNumber, nextTitle = '') {
  const targetIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (targetIndex < 0) {
    throw new Error('Chapter not found.');
  }

  const target = chapters[targetIndex];
  const lines = String(target.content || '').split(/\n/);
  const splitAt = Math.trunc(Number(lineNumber));
  if (!Number.isFinite(splitAt) || splitAt <= 0 || splitAt >= lines.length) {
    throw new Error('Line number must be inside the selected chapter.');
  }

  const firstContent = lines.slice(0, splitAt).join('\n').trim();
  const secondContent = lines.slice(splitAt).join('\n').trim();
  if (!firstContent || !secondContent) {
    throw new Error('Split would create an empty chapter.');
  }

  const corpusId = target.corpusId || chapters[0]?.corpusId || '';
  const inserted = [
    { ...target, content: firstContent },
    {
      ...target,
      id: `${target.id}_split_${Date.now()}`,
      title: normalizeTitle(nextTitle, `Chapter ${(target.index || targetIndex + 1) + 1}`),
      content: secondContent,
      startLine: 0,
      endLine: 0,
    },
  ];

  return normalizeLabLiteChapters(
    [
      ...chapters.slice(0, targetIndex),
      ...inserted,
      ...chapters.slice(targetIndex + 1),
    ],
    { corpusId },
  );
}
