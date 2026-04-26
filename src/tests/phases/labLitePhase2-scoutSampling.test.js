import { describe, expect, it } from 'vitest';
import {
  buildChapterSample,
  createFailedScoutResult,
  normalizeScoutResult,
} from '../../services/labLite/chapterScout.js';

function makeLongChapter() {
  return {
    id: 'chapter_12',
    corpusId: 'corpus_alpha',
    index: 12,
    title: 'Chapter 12: Crossing',
    wordCount: 900,
    estimatedTokens: 1200,
    content: [
      'Opening paragraph one introduces the location.',
      '',
      'Opening paragraph two shows the protagonist goal.',
      '',
      'Middle paragraph one has a clue.',
      '',
      'Middle paragraph two changes the relationship.',
      '',
      'Middle paragraph three explains a world rule.',
      '',
      'Ending paragraph one reveals a secret.',
      '',
      'Ending paragraph two creates the hook.',
    ].join('\n'),
  };
}

describe('Lab Lite Phase 2 - scout sampling and normalization', () => {
  it('builds a compact chapter sample from opening, middle, and ending paragraphs', () => {
    const sample = buildChapterSample(makeLongChapter(), 100);

    expect(sample).toEqual(expect.objectContaining({
      title: 'Chapter 12: Crossing',
      chapterIndex: 12,
      totalChapters: 100,
      wordCount: 900,
      estimatedTokens: 1200,
    }));
    expect(sample.opening).toContain('Opening paragraph one');
    expect(sample.middle.length).toBeGreaterThan(0);
    expect(sample.ending).toContain('Ending paragraph two');
  });

  it('clips very long sample blocks', () => {
    const chapter = {
      ...makeLongChapter(),
      content: ['A'.repeat(5000), '', 'B'.repeat(5000), '', 'C'.repeat(5000)].join('\n'),
    };

    const sample = buildChapterSample(chapter, 3);

    expect(sample.opening.length).toBeLessThanOrEqual(1803);
    expect(sample.ending.length).toBeLessThanOrEqual(1803);
  });

  it('keeps adult_sensitive when adult signals are allowed', () => {
    const result = normalizeScoutResult({
      chapterIndex: 9,
      priority: 'high',
      recommendation: 'light_load',
      detectedSignals: ['adult_sensitive', 'state_change'],
      reason: 'Mature relationship context changes a state.',
      confidence: 0.7,
    }, {
      corpusId: 'corpus_alpha',
      goal: 'adult_context',
      allowAdultSignals: true,
    });

    expect(result.detectedSignals).toEqual(['adult_sensitive', 'state_change']);
  });

  it('deduplicates mapped sensitive signals in safe mode', () => {
    const result = normalizeScoutResult({
      chapterIndex: 9,
      priority: 'high',
      recommendation: 'light_load',
      detectedSignals: ['adult_sensitive', 'sensitive_or_relationship_heavy', 'adult_sensitive'],
      reason: 'Relationship-heavy scene.',
      confidence: 0.7,
    }, {
      corpusId: 'corpus_alpha',
      goal: 'fanfic',
      allowAdultSignals: false,
    });

    expect(result.detectedSignals).toEqual(['sensitive_or_relationship_heavy']);
  });

  it('creates a persisted-shaped failed scout result', () => {
    const failed = createFailedScoutResult({
      corpusId: 'corpus_alpha',
      goal: 'story_bible',
      chapterIndex: 3,
      error: new Error('Rate limited'),
    });

    expect(failed).toEqual(expect.objectContaining({
      corpusId: 'corpus_alpha',
      goal: 'story_bible',
      chapterIndex: 3,
      status: 'error',
      reason: 'Rate limited',
      confidence: 0,
    }));
  });
});
