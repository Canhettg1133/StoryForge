import { describe, expect, it } from 'vitest';
import {
  buildChapterAnalysisCacheEntry,
  hashLabLiteContent,
  planLabLiteScoutBatches,
  resolveLongContextStrategy,
  shouldReuseAnalysisCache,
} from '../../services/labLite/longContextPlanner.js';
import { makeLargeChapterMetas } from '../helpers/labLiteTestUtils.js';

function batchCost(batch, expectedOutputTokensPerChapter) {
  return batch.reduce((sum, chapter) => (
    sum + Number(chapter.sampleEstimatedTokens || chapter.scoutEstimatedTokens || chapter.estimatedTokens || 1) + expectedOutputTokensPerChapter
  ), 0);
}

describe('Lab Lite Gemini 1M token budget planner', () => {
  it('sorts chapters before planning batches', () => {
    const plan = planLabLiteScoutBatches({
      chapters: [
        { index: 5, estimatedTokens: 10 },
        { index: 1, estimatedTokens: 10 },
        { index: 3, estimatedTokens: 10 },
      ],
      batchTokenBudget: 1000,
      maxChaptersPerBatch: 10,
    });

    expect(plan.batches.flat().map((chapter) => chapter.index)).toEqual([1, 3, 5]);
  });

  it('respects max chapter count and token budget including expected output', () => {
    const expectedOutputTokensPerChapter = 100;
    const plan = planLabLiteScoutBatches({
      chapters: Array.from({ length: 9 }, (_item, index) => ({ index: index + 1, estimatedTokens: 250 })),
      batchTokenBudget: 750,
      expectedOutputTokensPerChapter,
      maxChaptersPerBatch: 3,
    });

    expect(plan.batches.every((batch) => batch.length <= 3)).toBe(true);
    expect(plan.batches.every((batch) => batchCost(batch, expectedOutputTokensPerChapter) <= 750)).toBe(true);
    expect(plan.batches.flat()).toHaveLength(9);
  });

  it('keeps a single oversize chapter instead of dropping it', () => {
    const plan = planLabLiteScoutBatches({
      chapters: [
        { index: 1, estimatedTokens: 1200 },
        { index: 2, estimatedTokens: 100 },
      ],
      batchTokenBudget: 500,
      expectedOutputTokensPerChapter: 50,
      maxChaptersPerBatch: 10,
    });

    expect(plan.batches.map((batch) => batch.map((chapter) => chapter.index))).toEqual([[1], [2]]);
  });

  it('covers all 2000 chapters exactly once', () => {
    const chapters = makeLargeChapterMetas(2000);
    const plan = planLabLiteScoutBatches({
      chapters,
      totalEstimatedTokens: 2_400_000,
      chapterCount: 2000,
      batchTokenBudget: 80_000,
      expectedOutputTokensPerChapter: 120,
      maxChaptersPerBatch: 80,
    });
    const indexes = plan.batches.flat().map((chapter) => chapter.index);

    expect(indexes).toHaveLength(2000);
    expect(new Set(indexes).size).toBe(2000);
    expect(indexes[0]).toBe(1);
    expect(indexes.at(-1)).toBe(2000);
  });

  it('uses metadata contentHash for cache entries and reuse checks without raw content', () => {
    const chapter = {
      id: 'chapter_1',
      corpusId: 'corpus_budget',
      index: 1,
      title: 'Chương 1',
      contentHash: 'hash_from_metadata',
    };
    const entry = buildChapterAnalysisCacheEntry({
      chapter,
      analysisType: 'scout',
      goal: 'fanfic',
      resultId: 'result_1',
    });

    expect(entry.contentHash).toBe('hash_from_metadata');
    expect(shouldReuseAnalysisCache({ chapter, cacheEntry: entry, analysisType: 'scout', goal: 'fanfic' })).toBe(true);
    expect(shouldReuseAnalysisCache({
      chapter: { ...chapter, contentHash: hashLabLiteContent('nội dung đã đổi') },
      cacheEntry: entry,
      analysisType: 'scout',
      goal: 'fanfic',
    })).toBe(false);
  });

  it('keeps strategy labels in readable Vietnamese', () => {
    const strategy = resolveLongContextStrategy({ totalEstimatedTokens: 2_000_000, chapterCount: 500 });

    expect(strategy.label).toContain('Quét batch lớn');
    expect(strategy.label).toContain('chọn lọc');
    expect(strategy.label).not.toContain('Quet');
    expect(strategy.label).not.toContain('Ă');
  });
});
