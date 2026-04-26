import { describe, expect, it } from 'vitest';
import { compactScoutResultsForArcMapper, normalizeArcResults } from '../../services/labLite/arcMapper.js';

describe('Lab Lite Phase 3 - arc mapper edge cases', () => {
  it('drops compact rows with invalid chapter indexes', () => {
    const compact = compactScoutResultsForArcMapper([
      { chapterIndex: 0, status: 'complete', priority: 'low', recommendation: 'skip', reason: 'bad', confidence: 0 },
      { chapterIndex: Number.NaN, status: 'complete', priority: 'low', recommendation: 'skip', reason: 'bad', confidence: 0 },
      { chapterIndex: 2, status: 'complete', priority: 'medium', recommendation: 'light_load', reason: 'good', confidence: 0.5 },
    ]);

    expect(compact).toHaveLength(1);
    expect(compact[0].chapterIndex).toBe(2);
  });

  it('defaults missing compact fields without carrying extra data', () => {
    const compact = compactScoutResultsForArcMapper([
      { chapterIndex: 3, status: 'complete' },
    ]);

    expect(compact[0]).toEqual({
      chapterIndex: 3,
      priority: 'low',
      recommendation: 'skip',
      detectedSignals: [],
      reason: '',
      confidence: 0,
    });
  });

  it('sorts same-start arcs by stronger importance first', () => {
    const arcs = normalizeArcResults({
      arcs: [
        { id: 'low', title: 'Low', chapterStart: 1, chapterEnd: 3, summary: '', importance: 'low', whyLoad: '', recommendedDeepChapters: [] },
        { id: 'critical', title: 'Critical', chapterStart: 1, chapterEnd: 4, summary: '', importance: 'critical', whyLoad: '', recommendedDeepChapters: [] },
        { id: 'medium', title: 'Medium', chapterStart: 1, chapterEnd: 2, summary: '', importance: 'medium', whyLoad: '', recommendedDeepChapters: [] },
      ],
    }, { corpusId: 'corpus_arc', chapterCount: 10 });

    expect(arcs.map((arc) => arc.id)).toEqual(['critical', 'medium', 'low']);
  });

  it('clips chapter start below one and end above chapter count', () => {
    const arcs = normalizeArcResults({
      arcs: [
        { id: 'wide', title: 'Wide', chapterStart: -10, chapterEnd: 999, summary: '', importance: 'high', whyLoad: '', recommendedDeepChapters: [-1, 1, 50, 999] },
      ],
    }, { corpusId: 'corpus_arc', chapterCount: 50 });

    expect(arcs[0].chapterStart).toBe(1);
    expect(arcs[0].chapterEnd).toBe(50);
    expect(arcs[0].recommendedDeepChapters).toEqual([1, 50]);
  });

  it('deduplicates recommended deep chapters after clipping', () => {
    const arcs = normalizeArcResults({
      arcs: [
        { id: 'dupe', title: 'Dupe', chapterStart: 2, chapterEnd: 5, summary: '', importance: 'high', whyLoad: '', recommendedDeepChapters: [2, 2, 3, 3, 5] },
      ],
    }, { corpusId: 'corpus_arc', chapterCount: 10 });

    expect(arcs[0].recommendedDeepChapters).toEqual([2, 3, 5]);
  });
});
