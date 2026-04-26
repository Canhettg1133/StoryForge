import { describe, expect, it, vi } from 'vitest';
import { normalizeLabLiteChapters, renameChapter, splitChapterAtLine } from '../../services/labLite/chapterParser.js';

describe('Lab Lite Phase 1 - manual editing guards', () => {
  it('removes control characters from renamed titles', () => {
    const chapters = normalizeLabLiteChapters([
      { id: 'c1', title: 'Original', content: 'Body.' },
    ], { corpusId: 'corpus_edit' });

    const renamed = renameChapter(chapters, 'c1', 'New\u0000 Title\u0007');

    expect(renamed[0].title).toBe('New Title');
  });

  it('ignores rename requests for unknown chapter ids', () => {
    const chapters = normalizeLabLiteChapters([
      { id: 'c1', title: 'Original', content: 'Body.' },
    ], { corpusId: 'corpus_edit' });

    const renamed = renameChapter(chapters, 'missing', 'Other');

    expect(renamed[0].title).toBe('Original');
  });

  it('rejects non-numeric split line values', () => {
    const chapters = [{ id: 'c1', corpusId: 'x', index: 1, title: 'One', content: 'a\nb\nc' }];

    expect(() => splitChapterAtLine(chapters, 'c1', 'abc', 'Two')).toThrow('Line number');
  });

  it('truncates fractional split line values safely', () => {
    const chapters = [{ id: 'c1', corpusId: 'x', index: 1, title: 'One', content: 'a\nb\nc\nd' }];

    const split = splitChapterAtLine(chapters, 'c1', 2.9, 'Two');

    expect(split[0].content).toBe('a\nb');
    expect(split[1].content).toBe('c\nd');
  });

  it('assigns a generated id to inserted split chapter without mutating original array', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    const chapters = [{ id: 'c1', corpusId: 'x', index: 1, title: 'One', content: 'a\nb\nc\nd' }];

    const split = splitChapterAtLine(chapters, 'c1', 2, 'Two');

    expect(chapters).toHaveLength(1);
    expect(split[1].id).toBe('c1_split_12345');
    vi.restoreAllMocks();
  });
});
