import { describe, expect, it } from 'vitest';
import { normalizeScoutBatchResults, normalizeScoutResult } from '../../services/labLite/chapterScout.js';

describe('Lab Lite Phase 2 - scout normalization extended cases', () => {
  it('falls back to caller chapter index when AI omits chapterIndex', () => {
    const result = normalizeScoutResult({
      priority: 'medium',
      recommendation: 'light_load',
      detectedSignals: [],
      reason: 'Useful setup.',
      confidence: 0.5,
    }, {
      corpusId: 'corpus_x',
      goal: 'story_bible',
      chapterIndex: 14,
    });

    expect(result.chapterIndex).toBe(14);
  });

  it('uses a clear Vietnamese default reason when AI returns blank reason', () => {
    const result = normalizeScoutResult({
      chapterIndex: 1,
      priority: 'low',
      recommendation: 'skip',
      detectedSignals: [],
      reason: '   ',
      confidence: 0.2,
    }, { corpusId: 'corpus_x', goal: 'story_bible' });

    expect(result.reason).toBe('AI không trả lý do.');
  });

  it('accepts all valid signal enums and removes unknown values', () => {
    const result = normalizeScoutResult({
      chapterIndex: 1,
      priority: 'critical',
      recommendation: 'deep_load',
      detectedSignals: [
        'new_character',
        'relationship_shift',
        'worldbuilding',
        'reveal',
        'state_change',
        'adult_sensitive',
        'sensitive_or_relationship_heavy',
        'ending_hook',
        'not_real',
      ],
      reason: 'Many signals.',
      confidence: 0.9,
    }, { corpusId: 'corpus_x', goal: 'fanfic', allowAdultSignals: true });

    expect(result.detectedSignals).toEqual([
      'new_character',
      'relationship_shift',
      'worldbuilding',
      'reveal',
      'state_change',
      'adult_sensitive',
      'sensitive_or_relationship_heavy',
      'ending_hook',
    ]);
  });

  it('handles non-object AI payloads conservatively', () => {
    const result = normalizeScoutResult(null, {
      corpusId: 'corpus_x',
      goal: 'story_bible',
      chapterIndex: 2,
    });

    expect(result).toEqual(expect.objectContaining({
      corpusId: 'corpus_x',
      goal: 'story_bible',
      chapterIndex: 2,
      priority: 'low',
      recommendation: 'skip',
      status: 'complete',
      confidence: 0,
    }));
  });

  it('clamps non-numeric confidence to zero', () => {
    const result = normalizeScoutResult({
      chapterIndex: 1,
      priority: 'medium',
      recommendation: 'light_load',
      detectedSignals: [],
      reason: 'Okay.',
      confidence: 'not-a-number',
    }, { corpusId: 'corpus_x', goal: 'story_bible' });

    expect(result.confidence).toBe(0);
  });

  it('normalizes batch Scout output and fills missing chapter results conservatively', () => {
    const results = normalizeScoutBatchResults({
      results: [{
        chapterIndex: 2,
        priority: 'high',
        recommendation: 'deep_load',
        detectedSignals: ['reveal'],
        reason: 'Có reveal quan trọng.',
        confidence: 0.8,
      }],
    }, {
      chapters: [{ index: 1 }, { index: 2 }],
      corpusId: 'corpus_x',
      goal: 'fanfic',
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({
      chapterIndex: 1,
      recommendation: 'skip',
      reason: 'AI không trả kết quả cho chương này.',
    }));
    expect(results[1]).toEqual(expect.objectContaining({
      chapterIndex: 2,
      recommendation: 'deep_load',
      reason: 'Có reveal quan trọng.',
    }));
  });
});
