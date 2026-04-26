import { describe, expect, it } from 'vitest';
import { normalizeArcResults } from '../../services/labLite/arcMapper.js';

describe('Lab Lite Phase 3 - arc normalization extended coverage', () => {
  it('returns an empty list for missing or invalid arc payloads', () => {
    expect(normalizeArcResults(null, { chapterCount: 10 })).toEqual([]);
    expect(normalizeArcResults({ arcs: null }, { chapterCount: 10 })).toEqual([]);
  });

  it('repairs reversed chapter ranges', () => {
    const arcs = normalizeArcResults({
      arcs: [{
        title: 'Reverse',
        chapterStart: 8,
        chapterEnd: 4,
        summary: 'Reverse range.',
        importance: 'high',
        whyLoad: 'Important.',
        recommendedDeepChapters: [4, 6, 8],
      }],
    }, { corpusId: 'corpus_alpha', chapterCount: 10 });

    expect(arcs[0].chapterStart).toBe(4);
    expect(arcs[0].chapterEnd).toBe(8);
    expect(arcs[0].recommendedDeepChapters).toEqual([4, 6, 8]);
  });

  it('defaults invalid importance to medium', () => {
    const arcs = normalizeArcResults({
      arcs: [{
        title: 'Odd',
        chapterStart: 1,
        chapterEnd: 2,
        summary: 'Odd importance.',
        importance: 'urgent',
        whyLoad: 'Maybe.',
        recommendedDeepChapters: [],
      }],
    }, { corpusId: 'corpus_alpha', chapterCount: 10 });

    expect(arcs[0].importance).toBe('medium');
  });

  it('assigns stable fallback ids with corpus prefix', () => {
    const arcs = normalizeArcResults({
      arcs: [{
        title: 'No Id',
        chapterStart: 1,
        chapterEnd: 2,
        summary: 'No id.',
        importance: 'low',
        whyLoad: '',
        recommendedDeepChapters: [1],
      }],
    }, { corpusId: 'corpus_alpha', chapterCount: 10 });

    expect(arcs[0].id).toBe('corpus_alpha_arc_001');
  });

  it('clips recommended deep chapters outside arc range', () => {
    const arcs = normalizeArcResults({
      arcs: [{
        title: 'Middle',
        chapterStart: 10,
        chapterEnd: 20,
        summary: 'Middle arc.',
        importance: 'critical',
        whyLoad: 'Major reveal.',
        recommendedDeepChapters: [1, 10, 15, 20, 25],
      }],
    }, { corpusId: 'corpus_alpha', chapterCount: 30 });

    expect(arcs[0].recommendedDeepChapters).toEqual([10, 15, 20]);
  });

  it('sorts arcs by chapter start after normalization', () => {
    const arcs = normalizeArcResults({
      arcs: [
        { id: 'b', title: 'B', chapterStart: 20, chapterEnd: 25, summary: '', importance: 'low', whyLoad: '', recommendedDeepChapters: [] },
        { id: 'a', title: 'A', chapterStart: 1, chapterEnd: 5, summary: '', importance: 'low', whyLoad: '', recommendedDeepChapters: [] },
      ],
    }, { corpusId: 'corpus_alpha', chapterCount: 30 });

    expect(arcs.map((arc) => arc.id)).toEqual(['a', 'b']);
  });
});
