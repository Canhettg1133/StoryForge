import { describe, expect, it } from 'vitest';
import { buildChapterSample } from '../../services/labLite/chapterScout.js';

describe('Lab Lite Phase 2 - scout sample boundary cases', () => {
  it('handles empty chapter content without throwing', () => {
    const sample = buildChapterSample({
      title: '',
      index: 1,
      content: '',
      wordCount: 0,
      estimatedTokens: 0,
    }, 1);

    expect(sample.opening).toBe('');
    expect(sample.middle).toEqual([]);
    expect(sample.ending).toBe('');
  });

  it('uses fallback title when chapter title is missing', () => {
    const sample = buildChapterSample({
      index: 4,
      content: 'Only paragraph.',
    }, 10);

    expect(sample.title).toBe('Chapter 4');
  });

  it('deduplicates middle paragraph indexes for short chapters', () => {
    const sample = buildChapterSample({
      index: 1,
      title: 'Short',
      content: ['First paragraph.', '', 'Second paragraph.', '', 'Third paragraph.'].join('\n'),
    }, 3);

    expect(sample.middle).toHaveLength(1);
  });

  it('keeps paragraph order in opening and ending samples', () => {
    const sample = buildChapterSample({
      index: 1,
      title: 'Ordered',
      content: ['A1', '', 'A2', '', 'M1', '', 'E1', '', 'E2'].join('\n'),
    }, 1);

    expect(sample.opening).toBe('A1\n\nA2');
    expect(sample.ending).toBe('E1\n\nE2');
  });
});
