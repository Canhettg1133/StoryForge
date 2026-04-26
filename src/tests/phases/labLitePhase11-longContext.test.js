import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_STRATEGIES,
  buildChapterAnalysisCacheEntry,
  getLabLiteModelRoute,
  hashLabLiteContent,
  planLabLiteScoutBatches,
  resolveLongContextStrategy,
  shouldReuseAnalysisCache,
} from '../../services/labLite/longContextPlanner.js';
import { estimateTokens, estimateTokensDetailed } from '../../services/labLite/tokenEstimator.js';

describe('Lab Lite Phase 11 - long context optimization', () => {
  it('estimates tokens with language-aware detail and overhead budgeting', () => {
    const english = estimateTokensDetailed('Lan walks into the old shrine and waits for Kha.', { overheadTokens: 50 });
    const cjk = estimateTokensDetailed('她走进旧神殿等待。', { overheadTokens: 50 });
    const mixed = estimateTokens('Lan bước vào Đền Cũ。');

    expect(english.estimatedTokens).toBeGreaterThan(50);
    expect(cjk.cjkCharacters).toBeGreaterThan(0);
    expect(cjk.estimatedTokens).toBeGreaterThanOrEqual(cjk.cjkCharacters + 50);
    expect(mixed).toBeGreaterThan(0);
  });

  it('selects small, medium, large, and huge strategies by token and chapter boundaries', () => {
    expect(resolveLongContextStrategy({ totalEstimatedTokens: 80_000, chapterCount: 12 }).strategy).toBe(ANALYSIS_STRATEGIES.SMALL);
    expect(resolveLongContextStrategy({ totalEstimatedTokens: 500_000, chapterCount: 80 }).strategy).toBe(ANALYSIS_STRATEGIES.MEDIUM);
    expect(resolveLongContextStrategy({ totalEstimatedTokens: 1_800_000, chapterCount: 300 }).strategy).toBe(ANALYSIS_STRATEGIES.LARGE);
    expect(resolveLongContextStrategy({ totalEstimatedTokens: 5_000_000, chapterCount: 1200 }).strategy).toBe(ANALYSIS_STRATEGIES.HUGE);
  });

  it('plans long-context Scout batches instead of one request per chapter', () => {
    const small = planLabLiteScoutBatches({
      chapters: Array.from({ length: 18 }, (_item, index) => ({ index: index + 1 })),
      totalEstimatedTokens: 70_000,
      chapterCount: 18,
    });
    const huge = planLabLiteScoutBatches({
      chapters: Array.from({ length: 1000 }, (_item, index) => ({ index: index + 1 })),
      totalEstimatedTokens: 4_000_000,
      chapterCount: 1000,
    });

    expect(small.batches).toHaveLength(1);
    expect(small.estimatedRequests).toBe(1);
    expect(small.strategy.strategy).toBe(ANALYSIS_STRATEGIES.SMALL);
    expect(huge.estimatedRequests).toBeLessThan(1000);
    expect(huge.batches.every((batch) => batch.length <= 80)).toBe(true);
  });

  it('routes Lab Lite jobs by task and depth', () => {
    expect(getLabLiteModelRoute({ task: 'scout' }).quality).toBe('fast');
    expect(getLabLiteModelRoute({ task: 'arc_mapper' }).quality).toBe('balanced');
    expect(getLabLiteModelRoute({ task: 'deep_analysis' }).quality).toBe('best');
    expect(getLabLiteModelRoute({ task: 'canon_review', mode: 'quick' }).quality).toBe('fast');
    expect(getLabLiteModelRoute({ task: 'canon_review', mode: 'deep' }).quality).toBe('best');
  });

  it('uses stable content hashes to skip unchanged scout and deep analysis work', () => {
    const chapter = { id: 'c1', corpusId: 'corpus_1', index: 1, content: 'Lan waits.' };
    const entry = buildChapterAnalysisCacheEntry({
      chapter,
      analysisType: 'scout',
      goal: 'fanfic',
      status: 'complete',
      resultId: 'result_1',
    });

    expect(entry.contentHash).toBe(hashLabLiteContent('Lan waits.'));
    expect(shouldReuseAnalysisCache({ chapter, cacheEntry: entry, analysisType: 'scout', goal: 'fanfic' })).toBe(true);
    expect(shouldReuseAnalysisCache({
      chapter: { ...chapter, content: 'Lan leaves.' },
      cacheEntry: entry,
      analysisType: 'scout',
      goal: 'fanfic',
    })).toBe(false);
    expect(shouldReuseAnalysisCache({ chapter, cacheEntry: entry, analysisType: 'deep', goal: 'fanfic' })).toBe(false);
  });
});
