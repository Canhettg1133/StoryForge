import { describe, expect, it } from 'vitest';
import {
  normalizeLabLiteChapters,
  parseChaptersFromText,
  renameChapter,
  splitChapterAtLine,
} from '../../services/labLite/chapterParser.js';

describe('Lab Lite Phase 1 - chapter parser extended coverage', () => {
  it('falls back to one chapter when no explicit heading exists', () => {
    const parsed = parseChaptersFromText('A continuous story without headings but with readable content.');

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe('Chapter 1');
    expect(parsed.frontMatter).toBeNull();
  });

  it('keeps corpus ids and deterministic chapter ids during normalization', () => {
    const chapters = normalizeLabLiteChapters([
      { title: 'One', content: 'First body.' },
      { title: 'Two', content: 'Second body.' },
    ], { corpusId: 'corpus_alpha' });

    expect(chapters.map((chapter) => chapter.id)).toEqual([
      'corpus_alpha_chapter_00001',
      'corpus_alpha_chapter_00002',
    ]);
    expect(chapters.every((chapter) => chapter.corpusId === 'corpus_alpha')).toBe(true);
  });

  it('drops empty normalized chapters', () => {
    const chapters = normalizeLabLiteChapters([
      { title: 'Empty', content: '   ' },
      { title: 'Filled', content: 'Actual content.' },
    ], { corpusId: 'corpus_alpha' });

    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('Filled');
  });

  it('renames a chapter without changing order or content', () => {
    const original = normalizeLabLiteChapters([
      { id: 'c1', title: 'Old', content: 'First body.' },
      { id: 'c2', title: 'Two', content: 'Second body.' },
    ], { corpusId: 'corpus_alpha' });

    const renamed = renameChapter(original, 'c1', 'New Title');

    expect(renamed.map((chapter) => chapter.title)).toEqual(['New Title', 'Two']);
    expect(renamed.map((chapter) => chapter.index)).toEqual([1, 2]);
    expect(renamed[0].content).toBe('First body.');
  });

  it('uses fallback title when rename input is blank', () => {
    const original = normalizeLabLiteChapters([
      { id: 'c1', title: 'Original', content: 'First body.' },
    ], { corpusId: 'corpus_alpha' });

    const renamed = renameChapter(original, 'c1', '   ');

    expect(renamed[0].title).toBe('Original');
  });

  it('throws when manual split chapter id is missing', () => {
    expect(() => splitChapterAtLine([], 'missing', 1, 'Next')).toThrow('Chapter not found');
  });

  it('throws when manual split would create an empty chapter', () => {
    const chapters = [{ id: 'c1', corpusId: 'x', index: 1, title: 'One', content: 'line one\nline two' }];

    expect(() => splitChapterAtLine(chapters, 'c1', 0, 'Next')).toThrow('Line number');
    expect(() => splitChapterAtLine(chapters, 'c1', 2, 'Next')).toThrow('Line number');
  });

  it('preserves later chapters after a manual split and reindexes all chapters', () => {
    const chapters = [
      { id: 'c1', corpusId: 'x', index: 1, title: 'One', content: 'a\nb\nc\nd' },
      { id: 'c2', corpusId: 'x', index: 2, title: 'Two', content: 'second body' },
    ];

    const split = splitChapterAtLine(chapters, 'c1', 2, 'Inserted');

    expect(split).toHaveLength(3);
    expect(split.map((chapter) => chapter.index)).toEqual([1, 2, 3]);
    expect(split.map((chapter) => chapter.title)).toEqual(['One', 'Inserted', 'Two']);
  });
});
