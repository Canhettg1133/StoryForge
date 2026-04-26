import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bulkSaveChapterCoverage,
  getChapterContent,
  getLabLiteCorpusBundle,
  labLiteDb,
  listChapterCoverage,
  saveParsedCorpus,
} from '../../services/labLite/labLiteDb.js';
import { planLabLiteScoutBatches } from '../../services/labLite/longContextPlanner.js';
import { extractScoutBatchItems, validateChapterCoverage } from '../../services/labLite/analysisValidation.js';

describe('Lab Lite local-first pipeline foundations', () => {
  beforeEach(async () => {
    await labLiteDb.delete();
    await labLiteDb.open();
  });

  afterEach(async () => {
    await labLiteDb.delete();
  });

  it('loads corpus bundles with chapter metadata only while keeping lazy content available', async () => {
    const saved = await saveParsedCorpus({
      id: 'corpus_local_first',
      title: 'Truyện thử',
      fileType: 'txt',
      chapters: [
        { title: 'Chương 1', content: 'Dòng một.\nDòng hai.', wordCount: 4, estimatedTokens: 10 },
        { title: 'Chương 2', content: 'Nội dung chương hai.', wordCount: 4, estimatedTokens: 9 },
      ],
    });

    const bundle = await getLabLiteCorpusBundle(saved.corpus.id);
    expect(bundle.chapters).toHaveLength(2);
    expect(bundle.chapters[0]).not.toHaveProperty('content');
    expect(bundle.chapters[0]).toEqual(expect.objectContaining({
      title: 'Chương 1',
      lineCount: 2,
      contentHash: expect.stringContaining('fnv1a32_'),
    }));
    await expect(getChapterContent(bundle.chapters[0].id)).resolves.toBe('Dòng một.\nDòng hai.');
  });

  it('tracks coverage without counting synthetic scout fallback as complete scout coverage', async () => {
    await bulkSaveChapterCoverage([
      { corpusId: 'corpus_cov', chapterIndex: 1, localDone: true, scoutDone: true, status: 'complete' },
      { corpusId: 'corpus_cov', chapterIndex: 2, localDone: true, scoutSynthetic: true, status: 'synthetic_fallback' },
      { corpusId: 'corpus_cov', chapterIndex: 3, localDone: true, status: 'error', failedReason: 'Bad JSON' },
    ]);

    const coverage = await listChapterCoverage('corpus_cov');
    expect(coverage.find((item) => item.chapterIndex === 2)).toEqual(expect.objectContaining({
      scoutSynthetic: true,
      status: 'synthetic_fallback',
    }));
    expect(coverage.filter((item) => item.scoutDone && !item.scoutSynthetic)).toHaveLength(1);
  });

  it('plans scout batches by token budget as well as chapter count', () => {
    const plan = planLabLiteScoutBatches({
      chapters: [
        { index: 1, estimatedTokens: 400 },
        { index: 2, estimatedTokens: 400 },
        { index: 3, estimatedTokens: 400 },
      ],
      batchTokenBudget: 700,
      expectedOutputTokensPerChapter: 50,
      maxChaptersPerBatch: 10,
    });

    expect(plan.batches.map((batch) => batch.map((chapter) => chapter.index))).toEqual([[1], [2], [3]]);
  });

  it('validates scout batch shape and reports missing chapters', () => {
    const parsed = extractScoutBatchItems({
      results: [
        { chapterIndex: 1, priority: 'high', recommendation: 'deep_load' },
        { chapterIndex: 3, priority: 'low', recommendation: 'skip' },
      ],
    });
    const coverage = validateChapterCoverage(parsed.items, [1, 2, 3]);

    expect(parsed.ok).toBe(true);
    expect(coverage.missingChapterIndexes).toEqual([2]);
    expect(coverage.extraChapterIndexes).toEqual([]);
  });
});
