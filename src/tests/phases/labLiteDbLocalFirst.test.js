import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkSaveChapterCoverage,
  createDeepAnalysisRun,
  deleteLabLiteCorpus,
  getChapterContent,
  getChaptersByIndexes,
  getLabLiteCorpusBundle,
  labLiteDb,
  listAnalysisCacheEntries,
  listAnalysisJobs,
  listChapterCoverage,
  listChapterMetas,
  replaceCorpusChapters,
  saveAnalysisCacheEntry,
  saveAnalysisJob,
  saveAnalysisJobItems,
  saveArcResults,
  saveCanonPack,
  saveCanonPackMergePlan,
  saveCanonReviewItem,
  saveChapterCoverage,
  saveIngestBatch,
  saveMaterializationPlan,
  saveParsedCorpus,
  saveScoutResult,
} from '../../services/labLite/labLiteDb.js';
import { hashLabLiteContent } from '../../services/labLite/longContextPlanner.js';
import {
  makeLabLiteChapters,
  makeParsedCorpus,
  resetLabLiteDb,
  VIETNAMESE_CJK_TEXT,
} from '../helpers/labLiteTestUtils.js';

describe('Lab Lite DB local-first storage', () => {
  beforeEach(async () => {
    await resetLabLiteDb(labLiteDb);
  });

  afterEach(async () => {
    await labLiteDb.delete();
  });

  it('returns metadata-only chapters while preserving full content in Dexie', async () => {
    const parsed = makeParsedCorpus({
      id: 'corpus_db_meta',
      chapters: makeLabLiteChapters(2, {
        corpusId: 'corpus_db_meta',
        content: VIETNAMESE_CJK_TEXT,
      }),
    });

    const saved = await saveParsedCorpus(parsed);
    const bundle = await getLabLiteCorpusBundle(saved.corpus.id);

    expect(saved.chapters).toHaveLength(2);
    expect(saved.chapters[0]).not.toHaveProperty('content');
    expect(bundle.chapters[0]).not.toHaveProperty('content');
    expect(bundle.chapters[0]).toEqual(expect.objectContaining({
      title: 'Chương 1: Dấu mốc 1',
      lineCount: 3,
      contentHash: hashLabLiteContent(VIETNAMESE_CJK_TEXT),
    }));
    await expect(getChapterContent(bundle.chapters[0].id)).resolves.toBe(VIETNAMESE_CJK_TEXT);
  });

  it('lists chapter metadata sorted by index with derived fields', async () => {
    await labLiteDb.corpuses.put({
      id: 'corpus_db_sort',
      title: 'Sort Corpus',
      fileType: 'txt',
      chapterCount: 3,
      updatedAt: Date.now(),
    });
    await labLiteDb.chapters.bulkPut([
      { id: 'sort_3', corpusId: 'corpus_db_sort', index: 3, title: 'Chương 3', content: 'Nội dung ba', wordCount: 3, estimatedTokens: 30 },
      { id: 'sort_1', corpusId: 'corpus_db_sort', index: 1, title: 'Chương 1', content: 'Nội dung một\nDòng hai', wordCount: 4, estimatedTokens: 40 },
      { id: 'sort_2', corpusId: 'corpus_db_sort', index: 2, title: 'Chương 2', content: 'Nội dung hai', wordCount: 3, estimatedTokens: 35 },
    ]);

    const metas = await listChapterMetas('corpus_db_sort');

    expect(metas.map((chapter) => chapter.index)).toEqual([1, 2, 3]);
    expect(metas[0]).toEqual(expect.objectContaining({
      lineCount: 2,
      estimatedTokens: 40,
      contentHash: expect.stringContaining('fnv1a32_'),
    }));
    expect(metas.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
  });

  it('loads selected chapters with and without content by explicit option', async () => {
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_indexes', chapterCount: 4 }));

    const metas = await getChaptersByIndexes('corpus_db_indexes', [4, 2], { includeContent: false });
    const full = await getChaptersByIndexes('corpus_db_indexes', [4, 2], { includeContent: true });

    expect(metas.map((chapter) => chapter.index)).toEqual([2, 4]);
    expect(metas.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
    expect(full.map((chapter) => chapter.index)).toEqual([2, 4]);
    expect(full.every((chapter) => typeof chapter.content === 'string' && chapter.content.includes('Linh'))).toBe(true);
  });

  it('replaces chapters with recomputed metadata and preserved order', async () => {
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_replace', chapterCount: 1 }));

    const replaced = await replaceCorpusChapters('corpus_db_replace', [
      { id: 'a', title: 'Chương mới 1', content: 'Một\nHai', wordCount: 2, estimatedTokens: 7 },
      { id: 'b', title: 'Chương mới 2', content: 'Ba bốn năm', wordCount: 3, estimatedTokens: 8 },
    ]);
    const bundle = await getLabLiteCorpusBundle('corpus_db_replace');

    expect(replaced.map((chapter) => chapter.index)).toEqual([1, 2]);
    expect(replaced.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
    expect(bundle.corpus.chapterCount).toBe(2);
    expect(bundle.chapters[0]).toEqual(expect.objectContaining({ title: 'Chương mới 1', lineCount: 2 }));
    await expect(getChapterContent('a')).resolves.toBe('Một\nHai');
  });

  it('returns bundle side data without adding chapter content', async () => {
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_bundle', chapterCount: 2 }));
    await saveScoutResult({
      corpusId: 'corpus_db_bundle',
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'deep_load',
      priority: 'high',
    });
    await saveIngestBatch({
      corpusId: 'corpus_db_bundle',
      type: 'source_story',
      analysisMode: 'complete',
      status: 'imported',
    });
    await saveChapterCoverage({
      corpusId: 'corpus_db_bundle',
      chapterIndex: 1,
      localDone: true,
      scoutDone: true,
    });

    const bundle = await getLabLiteCorpusBundle('corpus_db_bundle');

    expect(bundle.scoutResults).toHaveLength(1);
    expect(bundle.ingestBatches[0]).toEqual(expect.objectContaining({ analysisMode: 'complete' }));
    expect(bundle.chapterCoverage[0]).toEqual(expect.objectContaining({ scoutDone: true, status: 'complete' }));
    expect(bundle.chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
  });

  it('loads bundle side data through corpus-scoped indexes instead of full table scans', async () => {
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_indexed_bundle', chapterCount: 2 }));
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_other_bundle', chapterCount: 2 }));
    await saveIngestBatch({
      id: 'ingest_indexed_target',
      corpusId: 'corpus_db_indexed_bundle',
      type: 'source_story',
      status: 'imported',
    });
    await saveIngestBatch({
      id: 'ingest_indexed_other',
      corpusId: 'corpus_db_other_bundle',
      type: 'source_story',
      status: 'imported',
    });
    await saveChapterCoverage({
      corpusId: 'corpus_db_indexed_bundle',
      chapterIndex: 1,
      localDone: true,
      scoutDone: true,
    });
    await saveChapterCoverage({
      corpusId: 'corpus_db_other_bundle',
      chapterIndex: 1,
      localDone: true,
      failedReason: 'Other corpus failed',
    });
    const targetPack = await saveCanonPack({
      id: 'pack_indexed_target',
      corpusId: 'corpus_db_indexed_bundle',
      title: 'Pack cần lấy',
    });
    await saveCanonPack({
      id: 'pack_indexed_other',
      corpusId: 'corpus_db_other_bundle',
      title: 'Pack khác',
    });
    await saveCanonPackMergePlan({
      id: 'merge_indexed_target',
      canonPackId: targetPack.id,
      ingestBatchId: 'ingest_indexed_target',
      status: 'draft',
    });
    await saveCanonPackMergePlan({
      id: 'merge_indexed_other',
      canonPackId: 'pack_indexed_other',
      ingestBatchId: 'ingest_indexed_other',
      status: 'draft',
    });

    const ingestToArray = vi.spyOn(labLiteDb.ingestBatches, 'toArray').mockImplementation(() => {
      throw new Error('full ingest scan');
    });
    const coverageToArray = vi.spyOn(labLiteDb.chapterCoverage, 'toArray').mockImplementation(() => {
      throw new Error('full coverage scan');
    });
    const mergeToArray = vi.spyOn(labLiteDb.canonPackMergePlans, 'toArray').mockImplementation(() => {
      throw new Error('full merge scan');
    });

    try {
      const bundle = await getLabLiteCorpusBundle('corpus_db_indexed_bundle');

      expect(bundle.ingestBatches.map((item) => item.id)).toEqual(['ingest_indexed_target']);
      expect(bundle.chapterCoverage.map((item) => item.corpusId)).toEqual(['corpus_db_indexed_bundle']);
      expect(bundle.canonPackMergePlans.map((item) => item.id)).toEqual(['merge_indexed_target']);
    } finally {
      ingestToArray.mockRestore();
      coverageToArray.mockRestore();
      mergeToArray.mockRestore();
    }
  });

  it('filters analysis cache by corpus, type, and goal', async () => {
    await saveAnalysisCacheEntry({
      corpusId: 'corpus_a',
      chapterIndex: 1,
      analysisType: 'scout',
      goal: 'fanfic',
      contentHash: 'hash_a',
    });
    await saveAnalysisCacheEntry({
      corpusId: 'corpus_a',
      chapterIndex: 2,
      analysisType: 'scout',
      goal: 'story_bible',
      contentHash: 'hash_b',
    });
    await saveAnalysisCacheEntry({
      corpusId: 'corpus_b',
      chapterIndex: 1,
      analysisType: 'deep_analysis',
      goal: 'fanfic',
      contentHash: 'hash_c',
    });

    expect(await listAnalysisCacheEntries({ corpusId: 'corpus_a' })).toHaveLength(2);
    expect(await listAnalysisCacheEntries({ corpusId: 'corpus_a', analysisType: 'scout' })).toHaveLength(2);
    const fanficScout = await listAnalysisCacheEntries({ corpusId: 'corpus_a', analysisType: 'scout', goal: 'fanfic' });
    expect(fanficScout).toHaveLength(1);
    expect(fanficScout[0]).toEqual(expect.objectContaining({ chapterIndex: 1, contentHash: 'hash_a' }));
  });

  it('persists durable job defaults and coverage updates without duplicate chapter rows', async () => {
    const job = await saveAnalysisJob({
      id: 'job_1',
      corpusId: 'corpus_jobs',
      mode: 'complete',
      phase: 'scout',
    });
    const items = await saveAnalysisJobItems([
      { jobId: job.id, corpusId: 'corpus_jobs', chapterIndex: 1, batchId: 'batch_1' },
      { jobId: job.id, corpusId: 'corpus_jobs', chapterIndex: 2, batchId: 'batch_1', retryCount: 2, status: 'error' },
    ]);

    expect(job).toEqual(expect.objectContaining({ status: 'pending', progress: 0, error: '' }));
    expect(items[0]).toEqual(expect.objectContaining({ status: 'pending', retryCount: 0, error: '' }));
    expect(items[1]).toEqual(expect.objectContaining({ status: 'error', retryCount: 2 }));

    await bulkSaveChapterCoverage([
      { corpusId: 'corpus_jobs', chapterIndex: 1, localDone: true, status: 'missing' },
      { corpusId: 'corpus_jobs', chapterIndex: 2, localDone: true, scoutSynthetic: true },
    ]);
    await bulkSaveChapterCoverage([
      { corpusId: 'corpus_jobs', chapterIndex: 1, localDone: true, scoutDone: true },
    ]);

    const jobs = await listAnalysisJobs({ corpusId: 'corpus_jobs', status: 'pending' });
    const coverage = await listChapterCoverage('corpus_jobs');

    expect(jobs).toHaveLength(1);
    expect(coverage).toHaveLength(2);
    expect(coverage.find((item) => item.chapterIndex === 1)).toEqual(expect.objectContaining({
      scoutDone: true,
      status: 'complete',
    }));
    expect(coverage.find((item) => item.chapterIndex === 2)).toEqual(expect.objectContaining({
      scoutSynthetic: true,
      status: 'synthetic_fallback',
    }));
  });

  it('deletes a corpus and every IndexedDB row that belongs to its Lab Lite pipeline', async () => {
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_delete', chapterCount: 2 }));
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_db_keep', chapterCount: 1 }));
    await saveScoutResult({
      corpusId: 'corpus_db_delete',
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'deep_load',
      priority: 'high',
    });
    await saveScoutResult({
      corpusId: 'corpus_db_keep',
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'skip',
      priority: 'low',
    });
    await saveArcResults('corpus_db_delete', [{ chapterStart: 1, chapterEnd: 2, title: 'Arc xóa' }]);
    await createDeepAnalysisRun({
      corpusId: 'corpus_db_delete',
      targets: [{ targetType: 'chapter', targetId: '1', chapterIndexes: [1] }],
    });
    const pack = await saveCanonPack({
      id: 'pack_delete',
      corpusId: 'corpus_db_delete',
      projectId: 'project_delete',
      title: 'Pack xóa',
    });
    const ingest = await saveIngestBatch({
      id: 'ingest_delete',
      corpusId: 'corpus_db_delete',
      projectId: 'project_delete',
      canonPackId: pack.id,
      type: 'source_story',
    });
    await saveCanonPackMergePlan({
      id: 'merge_delete',
      corpusId: 'corpus_db_delete',
      canonPackId: pack.id,
      ingestBatchId: ingest.id,
    });
    await saveMaterializationPlan({
      id: 'materialize_delete',
      canonPackId: pack.id,
      projectId: 'project_delete',
      status: 'draft',
    });
    await saveCanonReviewItem({
      id: 'review_delete',
      projectId: 'project_delete',
      canonPackId: pack.id,
      status: 'complete',
      verdict: 'no_obvious_issue',
    });
    await saveAnalysisCacheEntry({
      corpusId: 'corpus_db_delete',
      analysisType: 'scout',
      goal: 'story_bible',
      chapterIndex: 1,
      contentHash: 'hash_delete',
    });
    const job = await saveAnalysisJob({
      id: 'job_delete',
      corpusId: 'corpus_db_delete',
      mode: 'complete',
      phase: 'scout',
    });
    await saveAnalysisJobItems([
      { id: 'job_item_delete', jobId: job.id, corpusId: 'corpus_db_delete', chapterIndex: 1 },
    ]);
    await saveChapterCoverage({
      corpusId: 'corpus_db_delete',
      chapterIndex: 1,
      localDone: true,
      scoutDone: true,
    });

    const result = await deleteLabLiteCorpus('corpus_db_delete');
    const deletedBundle = await getLabLiteCorpusBundle('corpus_db_delete');
    const keptBundle = await getLabLiteCorpusBundle('corpus_db_keep');

    expect(result.deleted).toBe(true);
    expect(deletedBundle.corpus).toBeNull();
    await expect(labLiteDb.chapters.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.scoutResults.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.arcs.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.deepAnalysisRuns.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.deepAnalysisItems.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.canonPacks.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.ingestBatches.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.analysisCache.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.analysisJobs.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.analysisJobItems.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.chapterCoverage.where('corpusId').equals('corpus_db_delete').count()).resolves.toBe(0);
    await expect(labLiteDb.canonPackMergePlans.get('merge_delete')).resolves.toBeUndefined();
    await expect(labLiteDb.materializationPlans.get('materialize_delete')).resolves.toBeUndefined();
    await expect(labLiteDb.canonReviewItems.get('review_delete')).resolves.toBeUndefined();
    expect(keptBundle.corpus.id).toBe('corpus_db_keep');
    expect(keptBundle.chapters).toHaveLength(1);
    expect(keptBundle.scoutResults).toHaveLength(1);
  });
});
