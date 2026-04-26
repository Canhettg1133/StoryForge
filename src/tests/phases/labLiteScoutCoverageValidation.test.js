import { describe, expect, it } from 'vitest';
import { extractScoutBatchItems, validateChapterCoverage } from '../../services/labLite/analysisValidation.js';
import { normalizeScoutBatchResults, normalizeScoutResult } from '../../services/labLite/chapterScout.js';

describe('Lab Lite scout coverage validation', () => {
  it('extracts scout batch items from array and object payloads', () => {
    const arrayPayload = extractScoutBatchItems([
      { chapterIndex: 1, priority: 'high', recommendation: 'deep_load' },
    ]);
    const objectPayload = extractScoutBatchItems({
      results: [{ chapterIndex: '2', priority: 'low', recommendation: 'skip' }],
    });

    expect(arrayPayload.ok).toBe(true);
    expect(arrayPayload.items[0].chapterIndex).toBe(1);
    expect(objectPayload.ok).toBe(true);
    expect(objectPayload.items[0].chapterIndex).toBe(2);
  });

  it('returns a non-throwing validation error for malformed payloads', () => {
    const parsed = extractScoutBatchItems({ results: [{ chapterIndex: 0 }] });

    expect(parsed.ok).toBe(false);
    expect(parsed.items).toEqual([]);
    expect(parsed.error).toBeTruthy();
  });

  it('reports missing, extra, and duplicate chapter coverage without losing expected indexes', () => {
    const coverage = validateChapterCoverage([
      { chapterIndex: 1 },
      { chapterIndex: 1 },
      { chapterIndex: 3 },
      { chapterIndex: 99 },
    ], [1, 2, 3]);

    expect(coverage.missingChapterIndexes).toEqual([2]);
    expect(coverage.extraChapterIndexes).toEqual([99]);
  });

  it('creates synthetic fallback results for chapters missing from an AI batch', () => {
    const results = normalizeScoutBatchResults({
      results: [
        {
          chapterIndex: 2,
          priority: 'high',
          recommendation: 'deep_load',
          detectedSignals: ['reveal'],
          reason: 'Có reveal quan trọng.',
          confidence: 0.8,
        },
      ],
    }, {
      chapters: [{ corpusId: 'corpus_scout', index: 1 }, { corpusId: 'corpus_scout', index: 2 }],
      corpusId: 'corpus_scout',
      goal: 'fanfic',
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({
      chapterIndex: 1,
      recommendation: 'skip',
      syntheticFallback: true,
      missingFromBatch: true,
      reason: 'AI không trả kết quả cho chương này.',
    }));
    expect(results[1]).toEqual(expect.objectContaining({
      chapterIndex: 2,
      syntheticFallback: false,
      missingFromBatch: false,
    }));
  });

  it('keeps synthetic fallback separate from real scout completion', () => {
    const results = normalizeScoutBatchResults({ results: [] }, {
      chapters: [{ corpusId: 'corpus_scout', index: 1 }],
      corpusId: 'corpus_scout',
      goal: 'story_bible',
    });

    const realScoutDone = results.filter((item) => item.status === 'complete' && !item.syntheticFallback);

    expect(results[0]).toEqual(expect.objectContaining({
      status: 'complete',
      syntheticFallback: true,
    }));
    expect(realScoutDone).toHaveLength(0);
  });

  it('preserves explicit syntheticFallback and adult signal policy', () => {
    const safe = normalizeScoutResult({
      chapterIndex: 4,
      priority: 'critical',
      recommendation: 'deep_load',
      detectedSignals: ['adult_sensitive', 'relationship_shift'],
      reason: 'Cảnh quan hệ làm đổi trạng thái nhân vật.',
      confidence: 0.9,
      syntheticFallback: true,
    }, {
      corpusId: 'corpus_scout',
      goal: 'fanfic',
      allowAdultSignals: false,
    });
    const adult = normalizeScoutResult({
      chapterIndex: 4,
      priority: 'critical',
      recommendation: 'deep_load',
      detectedSignals: ['adult_sensitive'],
      reason: 'Cảnh trưởng thành cần tách riêng.',
      confidence: 0.9,
    }, {
      corpusId: 'corpus_scout',
      goal: 'adult_context',
      allowAdultSignals: true,
    });

    expect(safe.syntheticFallback).toBe(true);
    expect(safe.detectedSignals).toEqual(['sensitive_or_relationship_heavy', 'relationship_shift']);
    expect(adult.detectedSignals).toEqual(['adult_sensitive']);
  });

  it('uses Vietnamese default reasons with diacritics', () => {
    const missingReason = normalizeScoutResult({
      chapterIndex: 1,
      priority: 'low',
      recommendation: 'skip',
      reason: '',
    }, {
      corpusId: 'corpus_scout',
      goal: 'story_bible',
    });

    expect(missingReason.reason).toBe('AI không trả lý do.');
    expect(missingReason.reason).not.toContain('khong');
    expect(missingReason.reason).not.toContain('Ă');
  });
});
