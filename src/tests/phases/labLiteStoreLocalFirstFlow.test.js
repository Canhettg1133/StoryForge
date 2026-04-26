import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFile, makeParsedCorpus, resetLabLiteDb } from '../helpers/labLiteTestUtils.js';

let activeDb = null;

async function loadStoreHarness({
  parsed = makeParsedCorpus({ id: 'corpus_store', chapterCount: 3 }),
  scoutImpl = null,
  deepImpl = null,
} = {}) {
  vi.resetModules();
  const readLabLiteFile = vi.fn().mockResolvedValue(parsed);
  const runChapterScoutBatch = vi.fn(scoutImpl || (async ({ chapters, goal }) => (
    chapters.map((chapter) => ({
      corpusId: chapter.corpusId,
      goal,
      chapterIndex: chapter.index,
      priority: chapter.index === 2 ? 'high' : 'low',
      recommendation: chapter.index === 2 ? 'deep_load' : 'skip',
      detectedSignals: chapter.index === 2 ? ['reveal'] : [],
      reason: `Scout thật cho chương ${chapter.index}`,
      confidence: 0.8,
      status: 'complete',
    }))
  )));
  const runDeepAnalysisBatch = vi.fn(deepImpl || (async ({ chapters }) => ({
    chapterCanon: chapters.map((chapter) => ({
      chapterIndex: chapter.index,
      summary: `Digest chương ${chapter.index}`,
      mainEvents: [`Sự kiện ${chapter.index}`],
      charactersAppearing: ['Linh'],
    })),
    characterUpdates: [],
    relationshipUpdates: [],
    worldUpdates: [],
    timelineEvents: [],
    styleObservations: [],
    adultCanonNotes: [],
    canonRestrictions: [],
    creativeGaps: [],
    uncertainties: [],
    sourceEvidence: chapters.map((chapter) => `Chương ${chapter.index}`),
  })));

  vi.doMock('../../services/labLite/fileReader.js', () => ({ readLabLiteFile }));
  vi.doMock('../../services/labLite/chapterScout.js', async () => {
    const actual = await vi.importActual('../../services/labLite/chapterScout.js');
    return {
      ...actual,
      runChapterScoutBatch,
      abortChapterScoutQueue: vi.fn(),
    };
  });
  vi.doMock('../../services/labLite/deepAnalyzer.js', async () => {
    const actual = await vi.importActual('../../services/labLite/deepAnalyzer.js');
    return {
      ...actual,
      runDeepAnalysisBatch,
      abortDeepAnalysis: vi.fn(),
    };
  });

  const dbModule = await import('../../services/labLite/labLiteDb.js');
  activeDb = dbModule.labLiteDb;
  await resetLabLiteDb(dbModule.labLiteDb);
  const storeModule = await import('../../stores/labLiteStore.js');
  return {
    useLabLiteStore: storeModule.default,
    db: dbModule,
    readLabLiteFile,
    runChapterScoutBatch,
    runDeepAnalysisBatch,
  };
}

describe('Lab Lite store local-first flow', () => {
  afterEach(async () => {
    if (activeDb) {
      if (activeDb.isOpen?.()) activeDb.close();
      await activeDb.delete();
      activeDb = null;
    }
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('../../services/labLite/fileReader.js');
    vi.doUnmock('../../services/labLite/chapterScout.js');
    vi.doUnmock('../../services/labLite/deepAnalyzer.js');
  });

  it('imports files into metadata-only Zustand state and initializes coverage', async () => {
    const { useLabLiteStore, db } = await loadStoreHarness();

    const saved = await useLabLiteStore.getState().importFile(makeFile('store.txt', 'ignored'), {
      analysisMode: 'complete',
      ingestType: 'source_story',
    });
    const state = useLabLiteStore.getState();
    const ingestBatches = await db.listIngestBatches({ corpusId: saved.corpus.id });

    expect(state.currentCorpusId).toBe(saved.corpus.id);
    expect(state.chapters).toHaveLength(3);
    expect(state.chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
    expect(state.chapterCoverage).toHaveLength(3);
    expect(state.chapterCoverage.every((item) => item.localDone && item.status === 'missing')).toBe(true);
    expect(ingestBatches[0]).toEqual(expect.objectContaining({ analysisMode: 'complete' }));
  });

  it('imports files into the active project scope and hides them from other projects', async () => {
    const { useLabLiteStore, db } = await loadStoreHarness();

    const saved = await useLabLiteStore.getState().importFile(makeFile('project-a.txt', 'ignored'), {
      projectId: 'project_a',
      analysisMode: 'fast',
    });
    const scopedCorpuses = await db.listLabLiteCorpuses({ projectId: 'project_a', includeUnscoped: false });
    const otherProjectCorpuses = await db.listLabLiteCorpuses({ projectId: 'project_b', includeUnscoped: false });
    const ingestBatches = await db.listIngestBatches({ corpusId: saved.corpus.id });

    expect(saved.corpus).toEqual(expect.objectContaining({ projectId: 'project_a' }));
    expect(useLabLiteStore.getState()).toEqual(expect.objectContaining({
      activeProjectId: 'project_a',
      currentCorpusId: saved.corpus.id,
    }));
    expect(scopedCorpuses.map((corpus) => corpus.id)).toEqual([saved.corpus.id]);
    expect(otherProjectCorpuses).toEqual([]);
    expect(ingestBatches[0]).toEqual(expect.objectContaining({ projectId: 'project_a' }));
  });

  it('selects an existing corpus without loading full chapter content into the store', async () => {
    const { useLabLiteStore } = await loadStoreHarness();
    const saved = await useLabLiteStore.getState().importFile(makeFile('store.txt', 'ignored'));

    useLabLiteStore.setState({
      currentCorpusId: null,
      currentCorpus: null,
      chapters: [],
      scoutResults: [],
      chapterCoverage: [],
    });
    const bundle = await useLabLiteStore.getState().selectCorpus(saved.corpus.id);
    const state = useLabLiteStore.getState();

    expect(bundle.chapters).toHaveLength(3);
    expect(state.chapters).toHaveLength(3);
    expect(state.chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
  });

  it('renames and splits chapters through Dexie content helpers instead of Zustand content', async () => {
    const parsed = makeParsedCorpus({
      id: 'corpus_edit',
      chapters: [{
        id: 'chapter_edit_1',
        index: 1,
        title: 'Chương cũ',
        content: 'Dòng một\nDòng hai\nDòng ba\nDòng bốn',
        wordCount: 8,
        estimatedTokens: 20,
      }],
    });
    const { useLabLiteStore, db } = await loadStoreHarness({ parsed });

    await useLabLiteStore.getState().importFile(makeFile('edit.txt', 'ignored'));
    const firstId = useLabLiteStore.getState().chapters[0].id;
    await useLabLiteStore.getState().renameChapter(firstId, 'Chương đã đổi tên');
    await useLabLiteStore.getState().splitChapter(firstId, 2, 'Chương mới sau khi tách');

    const state = useLabLiteStore.getState();
    const fullChapters = await db.listChaptersWithContent('corpus_edit');

    expect(state.chapters).toHaveLength(2);
    expect(state.chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
    expect(state.chapters[0].title).toBe('Chương đã đổi tên');
    expect(state.chapters[1].title).toBe('Chương mới sau khi tách');
    expect(fullChapters[0].content).toContain('Dòng một');
    expect(fullChapters[1].content).toContain('Dòng ba');
  });

  it('runs Scout using full content from Dexie and saves real coverage/cache', async () => {
    const { useLabLiteStore, db, runChapterScoutBatch } = await loadStoreHarness();

    await useLabLiteStore.getState().importFile(makeFile('scout.txt', 'ignored'));
    const results = await useLabLiteStore.getState().runScout({ goal: 'fanfic', concurrency: 1 });
    const coverage = await db.listChapterCoverage('corpus_store');
    const cache = await db.listAnalysisCacheEntries({ corpusId: 'corpus_store', analysisType: 'scout', goal: 'fanfic' });
    const firstCall = runChapterScoutBatch.mock.calls[0][0];

    expect(firstCall.chapters.every((chapter) => typeof chapter.content === 'string' && chapter.content.includes('Linh'))).toBe(true);
    expect(results.filter((result) => result.goal === 'fanfic')).toHaveLength(3);
    expect(cache).toHaveLength(3);
    expect(coverage.filter((item) => item.scoutDone && !item.scoutSynthetic)).toHaveLength(3);
    expect(useLabLiteStore.getState().chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
  });

  it('reruns only failed Scout chapters when retrying failures', async () => {
    const { useLabLiteStore, db, runChapterScoutBatch } = await loadStoreHarness();

    await useLabLiteStore.getState().importFile(makeFile('retry.txt', 'ignored'));
    await db.saveScoutResult({
      corpusId: 'corpus_store',
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'skip',
      priority: 'low',
    });
    await db.saveScoutResult({
      corpusId: 'corpus_store',
      goal: 'story_bible',
      chapterIndex: 2,
      status: 'error',
      recommendation: 'skip',
      priority: 'low',
      reason: 'Rate limited',
    });
    await useLabLiteStore.getState().selectCorpus('corpus_store');
    await useLabLiteStore.getState().retryScoutFailures();

    const retriedIndexes = runChapterScoutBatch.mock.calls.flatMap((call) => call[0].chapters.map((chapter) => chapter.index));

    expect(retriedIndexes).toEqual([2]);
  });

  it('runs deep analysis with full target content and marks digest/deep coverage', async () => {
    const { useLabLiteStore, db, runDeepAnalysisBatch } = await loadStoreHarness();

    await useLabLiteStore.getState().importFile(makeFile('deep.txt', 'ignored'));
    useLabLiteStore.getState().setDeepChapterSelection([1, 2]);
    const run = await useLabLiteStore.getState().runDeepAnalysis();
    const coverage = await db.listChapterCoverage('corpus_store');
    const firstCall = runDeepAnalysisBatch.mock.calls[0][0];

    expect(run.status).toBe('complete');
    expect(firstCall.chapters.map((chapter) => chapter.index)).toEqual([1, 2]);
    expect(firstCall.chapters.every((chapter) => typeof chapter.content === 'string')).toBe(true);
    expect(coverage.filter((item) => item.digestDone && item.deepDone)).toHaveLength(2);
    expect(useLabLiteStore.getState().deepAnalysisItems.every((item) => item.status === 'complete')).toBe(true);
  });

  it('keeps control actions scoped to Scout state and preserves loaded metadata', async () => {
    const { useLabLiteStore } = await loadStoreHarness();

    await useLabLiteStore.getState().importFile(makeFile('control.txt', 'ignored'));
    useLabLiteStore.setState((state) => ({
      scoutState: { ...state.scoutState, status: 'running', running: 2 },
    }));

    useLabLiteStore.getState().pauseScout();
    expect(useLabLiteStore.getState().scoutState).toEqual(expect.objectContaining({ status: 'paused', running: 0 }));
    expect(useLabLiteStore.getState().chapters).toHaveLength(3);

    useLabLiteStore.setState((state) => ({
      scoutState: { ...state.scoutState, status: 'running', running: 1 },
    }));
    useLabLiteStore.getState().cancelScout();
    expect(useLabLiteStore.getState().scoutState).toEqual(expect.objectContaining({ status: 'canceled', running: 0 }));
    expect(useLabLiteStore.getState().chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);
  });

  it('deletes the selected corpus from IndexedDB and clears loaded Lab Lite state', async () => {
    const { useLabLiteStore, db } = await loadStoreHarness();

    const saved = await useLabLiteStore.getState().importFile(makeFile('delete.txt', 'ignored'), {
      projectId: 'project_delete',
    });
    await db.saveScoutResult({
      corpusId: saved.corpus.id,
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'deep_load',
      priority: 'high',
    });
    await useLabLiteStore.getState().selectCorpus(saved.corpus.id);

    const result = await useLabLiteStore.getState().deleteCorpus(saved.corpus.id);
    const bundle = await db.getLabLiteCorpusBundle(saved.corpus.id);
    const state = useLabLiteStore.getState();

    expect(result.deleted).toBe(true);
    expect(bundle.corpus).toBeNull();
    expect(state.currentCorpusId).toBeNull();
    expect(state.currentCorpus).toBeNull();
    expect(state.chapters).toEqual([]);
    expect(state.scoutResults).toEqual([]);
    expect(state.chapterCoverage).toEqual([]);
    expect(state.corpuses).toEqual([]);
  });
});
