import { create } from 'zustand';
import { readLabLiteFile } from '../services/labLite/fileReader.js';
import { renameChapter as renameParsedChapter, splitChapterAtLine } from '../services/labLite/chapterParser.js';
import {
  bulkSaveChapterCoverage,
  clearCorpusAnalysisArtifacts,
  deleteLabLiteCorpus,
  getLabLiteCorpusBundle,
  getChaptersByIndexes,
  listAnalysisCacheEntries,
  listChaptersWithContent,
  listLabLiteCorpuses,
  normalizeProjectId,
  createDeepAnalysisRun,
  listCanonPackMergePlans,
  listCanonPacks,
  listIngestBatches,
  listCanonReviewItems,
  replaceCorpusChapters,
  renameLabLiteCorpus,
  saveAnalysisCacheEntry,
  saveArcResults,
  saveCanonPack,
  saveCanonPackMergePlan,
  saveCanonReviewItem,
  saveChapterCoverage,
  saveDeepAnalysisItem,
  saveIngestBatch,
  saveMaterializationPlan,
  saveParsedCorpus,
  saveScoutResult,
  updateCanonReviewItem,
  updateDeepAnalysisRun,
  updateIngestBatch,
} from '../services/labLite/labLiteDb.js';
import {
  abortChapterScoutQueue,
  createFailedScoutResult,
  runChapterScoutBatch,
} from '../services/labLite/chapterScout.js';
import { abortArcMapper, runArcMapper as runArcMapperService } from '../services/labLite/arcMapper.js';
import {
  abortDeepAnalysis,
  buildDeepAnalysisTargets,
  planDeepAnalysisBatches,
  runDeepAnalysisBatch,
} from '../services/labLite/deepAnalyzer.js';
import { buildCanonPack as buildCanonPackArtifact } from '../services/labLite/canonPackBuilder.js';
import {
  applyCanonPackMergePlan as applyCanonPackMergePlanArtifact,
  buildCanonPackMergePlan as buildCanonPackMergePlanArtifact,
} from '../services/labLite/canonPackMerge.js';
import {
  abortCanonReview,
  runCanonReview as runCanonReviewService,
} from '../services/labLite/canonReview.js';
import {
  buildChapterAnalysisCacheEntry,
  planLabLiteScoutBatches,
  shouldReuseAnalysisCache,
} from '../services/labLite/longContextPlanner.js';
import {
  applyMaterializationPlan,
  buildMaterializationPlan,
} from '../services/labLite/materializeCanonPack.js';
import { PROJECT_CONTENT_MODES } from '../features/projectContentMode/projectContentMode.js';
import { selectPresetDeepChapterIndexes } from '../services/labLite/presetSelection.js';

let scoutRunCounter = 0;
let scoutControl = { runId: 0, paused: false, canceled: false };
let deepRunCounter = 0;
let deepControl = { runId: 0, canceled: false };
let reviewRunCounter = 0;
let reviewControl = { runId: 0, canceled: false };

function mergeResult(results = [], next) {
  const id = next?.id || `${next?.corpusId || 'corpus'}_${next?.goal || 'default'}_scout_${next?.chapterIndex}`;
  const record = { ...next, id };
  const existingIndex = results.findIndex((item) => item.id === id);
  if (existingIndex < 0) {
    return [...results, record].sort((a, b) => Number(a.chapterIndex || 0) - Number(b.chapterIndex || 0));
  }
  const copy = [...results];
  copy[existingIndex] = record;
  return copy.sort((a, b) => Number(a.chapterIndex || 0) - Number(b.chapterIndex || 0));
}

function allowAdultSignals(contentMode) {
  return contentMode === PROJECT_CONTENT_MODES.NSFW || contentMode === PROJECT_CONTENT_MODES.ENI;
}

function normalizeConcurrency(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(4, Math.max(1, parsed));
}

function emptyLoadedCorpusState() {
  return {
    currentCorpusId: null,
    currentChapterId: null,
    currentArcId: null,
    currentCorpus: null,
    chapters: [],
    scoutResults: [],
    arcs: [],
    deepAnalysisRuns: [],
    deepAnalysisItems: [],
    canonPacks: [],
    ingestBatches: [],
    canonPackMergePlans: [],
    chapterCoverage: [],
    materializationPlan: null,
    selectedArcIds: new Set(),
    selectedDeepChapterIndexes: new Set(),
  };
}

function buildCorpusListQuery(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return undefined;
  return { projectId: normalizedProjectId, includeUnscoped: false };
}

async function listCorpusesForProject(projectId) {
  const query = buildCorpusListQuery(projectId);
  return query ? listLabLiteCorpuses(query) : listLabLiteCorpuses();
}

async function loadBundleIntoState(set, corpusId, { projectId = null } = {}) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const bundle = await getLabLiteCorpusBundle(
    corpusId,
    normalizedProjectId ? { projectId: normalizedProjectId, allowUnscoped: false } : {},
  );
  if (!bundle.corpus) {
    set(emptyLoadedCorpusState());
    return bundle;
  }
  set({
    currentCorpusId: bundle.corpus?.id || null,
    currentChapterId: bundle.chapters[0]?.id || null,
    currentArcId: bundle.arcs[0]?.id || null,
    currentCorpus: bundle.corpus,
    chapters: bundle.chapters,
    scoutResults: bundle.scoutResults,
    arcs: bundle.arcs,
    deepAnalysisRuns: bundle.deepAnalysisRuns,
    deepAnalysisItems: bundle.deepAnalysisItems,
    canonPacks: bundle.canonPacks,
    ingestBatches: bundle.ingestBatches || [],
    canonPackMergePlans: bundle.canonPackMergePlans || [],
    chapterCoverage: bundle.chapterCoverage || [],
    selectedArcIds: new Set(),
    selectedDeepChapterIndexes: new Set(),
  });
  return bundle;
}

function mergeDeepResult(results = []) {
  return results.reduce((acc, result) => {
    if (!result) return acc;
    for (const [key, value] of Object.entries(result)) {
      if (Array.isArray(value)) {
        acc[key] = [...(acc[key] || []), ...value];
      }
    }
    return acc;
  }, {
    chapterCanon: [],
    characterUpdates: [],
    relationshipUpdates: [],
    worldUpdates: [],
    timelineEvents: [],
    styleObservations: [],
    adultCanonNotes: [],
    canonRestrictions: [],
    creativeGaps: [],
    uncertainties: [],
    sourceEvidence: [],
  });
}

const useLabLiteStore = create((set, get) => ({
  activeProjectId: null,
  corpuses: [],
  currentCorpusId: null,
  currentCorpus: null,
  currentChapterId: null,
  currentArcId: null,
  chapters: [],
  scoutResults: [],
  arcs: [],
  deepAnalysisRuns: [],
  deepAnalysisItems: [],
  canonPacks: [],
  ingestBatches: [],
  canonPackMergePlans: [],
  canonReviewItems: [],
  chapterCoverage: [],
  materializationPlan: null,
  selectedArcIds: new Set(),
  selectedDeepChapterIndexes: new Set(),
  loading: false,
  error: null,
  importState: {
    status: 'idle',
    error: null,
  },
  scoutState: {
    status: 'idle',
    goal: 'story_bible',
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    estimatedRequests: 0,
    completedRequests: 0,
    batchSize: 0,
    strategy: null,
    concurrency: 2,
    filter: 'all',
    error: null,
  },
  arcState: {
    status: 'idle',
    error: null,
  },
  deepState: {
    status: 'idle',
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    concurrency: 2,
    error: null,
  },
  canonPackState: {
    status: 'idle',
    error: null,
  },
  materializeState: {
    status: 'idle',
    error: null,
    appliedCount: 0,
  },
  presetRunState: {
    status: 'idle',
    mode: 'fast',
    step: '',
    label: '',
    error: null,
  },
  canonReviewState: {
    status: 'idle',
    error: null,
    mode: 'standard',
  },

  initialize: async ({ projectId = null } = {}) => {
    const activeProjectId = normalizeProjectId(projectId);
    set({ loading: true, error: null });
    try {
      const corpuses = await listCorpusesForProject(activeProjectId);
      const previousCurrentId = get().activeProjectId === activeProjectId ? get().currentCorpusId : null;
      const currentId = corpuses.some((corpus) => corpus.id === previousCurrentId)
        ? previousCurrentId
        : corpuses[0]?.id || null;
      set({
        activeProjectId,
        corpuses,
        loading: false,
        ...(currentId ? {} : emptyLoadedCorpusState()),
      });
      if (currentId) {
        await loadBundleIntoState(set, currentId, { projectId: activeProjectId });
      }
    } catch (error) {
      set({ loading: false, error: error?.message || 'Could not load Lab Lite data.' });
    }
  },

  importFile: async (file, options = {}) => {
    set({ importState: { status: 'reading', error: null }, error: null });
    try {
      const activeProjectId = normalizeProjectId(options.projectId ?? get().activeProjectId);
      const parsed = await readLabLiteFile(file);
      set({ importState: { status: 'saving', error: null } });
      const saved = await saveParsedCorpus({ ...parsed, projectId: activeProjectId });
      const importedCoverage = await bulkSaveChapterCoverage(saved.chapters.map((chapter) => ({
        corpusId: saved.corpus.id,
        chapterIndex: chapter.index,
        localDone: true,
        status: 'missing',
      })));
      const ingestBatch = await saveIngestBatch({
        corpusId: saved.corpus.id,
        projectId: activeProjectId,
        canonPackId: options.canonPackId || null,
        type: options.ingestType || options.type || 'source_story',
        analysisMode: options.analysisMode || 'fast',
        status: 'imported',
        allowAdultCanon: Boolean(options.allowAdultCanon),
        sourceFileName: file?.name || parsed.sourceFileName || '',
      });
      const corpuses = await listCorpusesForProject(activeProjectId);
      set({
        activeProjectId,
        corpuses,
        importState: { status: 'idle', error: null },
        currentCorpusId: saved.corpus.id,
        currentCorpus: saved.corpus,
        currentChapterId: saved.chapters[0]?.id || null,
        currentArcId: null,
        chapters: saved.chapters,
        scoutResults: [],
        arcs: [],
        deepAnalysisRuns: [],
        deepAnalysisItems: [],
        canonPacks: [],
        ingestBatches: [ingestBatch],
        canonPackMergePlans: [],
        chapterCoverage: importedCoverage,
        materializationPlan: null,
        selectedArcIds: new Set(),
        selectedDeepChapterIndexes: new Set(),
      });
      return saved;
    } catch (error) {
      set({ importState: { status: 'error', error: error?.message || 'Import failed.' } });
      throw error;
    }
  },

  selectCorpus: async (corpusId) => {
    if (!corpusId) return null;
    set({ loading: true, error: null });
    try {
      const bundle = await loadBundleIntoState(set, corpusId, { projectId: get().activeProjectId });
      set({ loading: false });
      return bundle;
    } catch (error) {
      set({ loading: false, error: error?.message || 'Could not load corpus.' });
      return null;
    }
  },

  deleteCorpus: async (corpusId = get().currentCorpusId) => {
    const activeCorpusId = corpusId || get().currentCorpusId;
    if (!activeCorpusId) return { deleted: false, corpusId: null, reason: 'missing_corpus_id', counts: {} };
    const projectId = get().activeProjectId;
    set({ loading: true, error: null });
    try {
      const result = await deleteLabLiteCorpus(
        activeCorpusId,
        projectId ? { projectId, allowUnscoped: false } : {},
      );
      if (!result.deleted) {
        set({ loading: false, error: result.reason || 'Không xóa được dữ liệu Lab Lite.' });
        return result;
      }

      const corpuses = await listCorpusesForProject(projectId);
      const deletingCurrent = get().currentCorpusId === activeCorpusId;
      if (deletingCurrent && corpuses[0]?.id) {
        set({
          corpuses,
          selectedArcIds: new Set(),
          selectedDeepChapterIndexes: new Set(),
        });
        await loadBundleIntoState(set, corpuses[0].id, { projectId });
        set({ loading: false });
      } else if (deletingCurrent) {
        set({
          activeProjectId: projectId,
          corpuses,
          ...emptyLoadedCorpusState(),
          selectedArcIds: new Set(),
          selectedDeepChapterIndexes: new Set(),
          loading: false,
        });
      } else {
        set({ corpuses, loading: false });
      }
      return result;
    } catch (error) {
      set({ loading: false, error: error?.message || 'Không xóa được dữ liệu Lab Lite.' });
      return { deleted: false, corpusId: activeCorpusId, reason: error?.message || 'delete_failed', counts: {} };
    }
  },

  selectChapter: (chapterId) => set({ currentChapterId: chapterId }),
  selectArc: (arcId) => set({ currentArcId: arcId }),
  setScoutFilter: (filter) => set((state) => ({ scoutState: { ...state.scoutState, filter } })),

  renameCorpus: async (corpusId, title) => {
    const activeCorpusId = corpusId || get().currentCorpusId;
    if (!activeCorpusId) return null;
    const projectId = get().activeProjectId;
    try {
      const corpus = await renameLabLiteCorpus(activeCorpusId, title);
      const corpuses = await listCorpusesForProject(projectId);
      set((state) => ({
        corpuses,
        currentCorpus: state.currentCorpusId === activeCorpusId && corpus ? corpus : state.currentCorpus,
      }));
      return corpus;
    } catch (error) {
      set({ error: error?.message || 'Không đổi được tên dữ liệu Lab Lite.' });
      throw error;
    }
  },

  toggleArcSelection: (arcId) => set((state) => {
    const next = new Set(state.selectedArcIds);
    if (next.has(arcId)) next.delete(arcId);
    else next.add(arcId);
    return { selectedArcIds: next };
  }),

  toggleDeepChapterSelection: (chapterIndex) => set((state) => {
    const normalized = Math.trunc(Number(chapterIndex));
    if (!Number.isFinite(normalized) || normalized <= 0) return {};
    const next = new Set(state.selectedDeepChapterIndexes);
    if (next.has(normalized)) next.delete(normalized);
    else next.add(normalized);
    return { selectedDeepChapterIndexes: next };
  }),

  setDeepChapterSelection: (chapterIndexes = []) => set({
    selectedDeepChapterIndexes: new Set(
      (chapterIndexes || [])
        .map((chapterIndex) => Math.trunc(Number(chapterIndex)))
        .filter((chapterIndex) => Number.isFinite(chapterIndex) && chapterIndex > 0),
    ),
  }),

  selectRecommendedDeepChapters: () => set((state) => {
    const next = new Set(state.selectedDeepChapterIndexes);
    state.arcs.forEach((arc) => {
      (arc.recommendedDeepChapters || []).forEach((chapterIndex) => {
        const normalized = Math.trunc(Number(chapterIndex));
        if (Number.isFinite(normalized) && normalized > 0) next.add(normalized);
      });
    });
    state.scoutResults.forEach((result) => {
      if (result.recommendation === 'deep_load') {
        const normalized = Math.trunc(Number(result.chapterIndex));
        if (Number.isFinite(normalized) && normalized > 0) next.add(normalized);
      }
    });
    return { selectedDeepChapterIndexes: next };
  }),

  renameChapter: async (chapterId, title) => {
    const corpusId = get().currentCorpusId;
    if (!corpusId) return;
    const currentChapters = await listChaptersWithContent(corpusId);
    const chapters = renameParsedChapter(currentChapters, chapterId, title);
    const savedChapters = await replaceCorpusChapters(corpusId, chapters);
    const projectId = get().activeProjectId;
    const bundle = await getLabLiteCorpusBundle(corpusId, projectId ? { projectId, allowUnscoped: false } : {});
    set({
      currentCorpus: bundle.corpus,
      chapters: savedChapters,
      chapterCoverage: bundle.chapterCoverage || [],
      corpuses: await listCorpusesForProject(projectId),
    });
  },

  splitChapter: async (chapterId, lineNumber, nextTitle) => {
    const corpusId = get().currentCorpusId;
    if (!corpusId) return;
    const currentChapters = await listChaptersWithContent(corpusId);
    const chapters = splitChapterAtLine(currentChapters, chapterId, lineNumber, nextTitle);
    const savedChapters = await replaceCorpusChapters(corpusId, chapters);
    await clearCorpusAnalysisArtifacts(corpusId);
    const resetCoverage = await bulkSaveChapterCoverage(savedChapters.map((chapter) => ({
      corpusId,
      chapterIndex: chapter.index,
      localDone: true,
      status: 'missing',
    })));
    const projectId = get().activeProjectId;
    const bundle = await getLabLiteCorpusBundle(corpusId, projectId ? { projectId, allowUnscoped: false } : {});
    set({
      currentCorpus: bundle.corpus,
      chapters: savedChapters,
      scoutResults: [],
      arcs: [],
      deepAnalysisRuns: [],
      deepAnalysisItems: [],
      canonPacks: [],
      canonPackMergePlans: [],
      materializationPlan: null,
      chapterCoverage: resetCoverage,
      currentChapterId: chapterId,
      corpuses: await listCorpusesForProject(projectId),
      selectedArcIds: new Set(),
      selectedDeepChapterIndexes: new Set(),
    });
  },

  runAnalysisPreset: async ({
    mode = 'fast',
    goal = 'story_bible',
    contentMode = PROJECT_CONTENT_MODES.SAFE,
    concurrency = 2,
  } = {}) => {
    const normalizedMode = ['fast', 'complete', 'deep'].includes(mode) ? mode : 'fast';
    if (!get().currentCorpusId) return null;
    const setPresetStep = (step, label) => set({
      presetRunState: {
        status: 'running',
        mode: normalizedMode,
        step,
        label,
        error: null,
      },
    });

    try {
      setPresetStep('scout', 'Đang quét nhanh');
      await get().runScout({ goal, concurrency, contentMode });
      if (normalizedMode === 'fast') {
        set({
          presetRunState: {
            status: 'complete',
            mode: normalizedMode,
            step: 'scout',
            label: 'Đã quét nhanh xong',
            error: null,
          },
        });
        return { mode: normalizedMode, completed: ['scout'] };
      }

      setPresetStep('scout', 'Đang tạo bản đồ arc');
      await get().runArcMapper(get().currentCorpusId);

      const selected = selectPresetDeepChapterIndexes({
        mode: normalizedMode,
        chapters: get().chapters,
        scoutResults: get().scoutResults.filter((result) => result.corpusId === get().currentCorpusId && result.goal === goal),
        arcs: get().arcs,
        chapterCoverage: get().chapterCoverage,
      });
      get().setDeepChapterSelection(selected);

      if (selected.length > 0) {
        setPresetStep('deep', 'Đang phân tích sâu');
        await get().runDeepAnalysis({ contentMode });
      }

      setPresetStep('canon-pack', 'Đang dựng Canon Pack');
      await get().buildCanonPack({ contentMode });

      set({
        presetRunState: {
          status: 'complete',
          mode: normalizedMode,
          step: 'canon-pack',
          label: 'Đã dựng Canon Pack',
          error: null,
        },
      });
      return { mode: normalizedMode, completed: ['scout', 'arc', 'deep', 'canon-pack'], selectedDeepChapterIndexes: selected };
    } catch (error) {
      set((state) => ({
        presetRunState: {
          ...state.presetRunState,
          status: 'error',
          error: error?.message || 'Không chạy được preset phân tích.',
        },
      }));
      throw error;
    }
  },

  pauseScout: () => {
    scoutControl.paused = true;
    set((state) => ({ scoutState: { ...state.scoutState, status: 'paused', running: 0 } }));
  },

  cancelScout: () => {
    scoutControl.canceled = true;
    abortChapterScoutQueue();
    set((state) => ({ scoutState: { ...state.scoutState, status: 'canceled', running: 0 } }));
  },

  runScout: async ({
    corpusId = get().currentCorpusId,
    goal = 'story_bible',
    contentMode = PROJECT_CONTENT_MODES.SAFE,
    concurrency = 2,
    onlyFailed = false,
    forceRerun = false,
  } = {}) => {
    const activeCorpusId = corpusId || get().currentCorpusId;
    if (!activeCorpusId) return [];

    const chapters = get().chapters.filter((chapter) => chapter.corpusId === activeCorpusId);
    const chapterMetaByIndex = new Map(chapters.map((chapter) => [Number(chapter.index), chapter]));
    const currentResults = get().scoutResults.filter((result) => result.corpusId === activeCorpusId && result.goal === goal);
    const cacheEntries = await listAnalysisCacheEntries({ corpusId: activeCorpusId, analysisType: 'scout', goal });
    const cacheByChapter = new Map(cacheEntries.map((entry) => [Number(entry.chapterIndex), entry]));
    const doneIndexes = new Set(currentResults
      .filter((result) => result.status === 'complete')
      .filter((result) => {
        const chapter = chapterMetaByIndex.get(Number(result.chapterIndex));
        if (!chapter) return false;
        const cacheEntry = cacheByChapter.get(Number(result.chapterIndex));
        return cacheEntry ? shouldReuseAnalysisCache({ chapter, cacheEntry, analysisType: 'scout', goal }) : true;
      })
      .map((result) => Number(result.chapterIndex)));
    const failedIndexes = new Set(currentResults.filter((result) => result.status === 'error').map((result) => Number(result.chapterIndex)));
    const pendingChapters = chapters.filter((chapter) => {
      if (onlyFailed) return failedIndexes.has(Number(chapter.index));
      if (forceRerun) return true;
      return !doneIndexes.has(Number(chapter.index));
    });

    const scoutPlan = planLabLiteScoutBatches({
      chapters: pendingChapters,
      totalEstimatedTokens: get().currentCorpus?.totalEstimatedTokens || pendingChapters.reduce((sum, chapter) => sum + Number(chapter.estimatedTokens || 0), 0),
      chapterCount: chapters.length,
    });
    const scoutBatches = scoutPlan.batches;
    const runId = ++scoutRunCounter;
    scoutControl = { runId, paused: false, canceled: false };
    const safeConcurrency = normalizeConcurrency(concurrency);
    const adultAllowed = allowAdultSignals(contentMode);

    set((state) => ({
      scoutState: {
        ...state.scoutState,
        status: pendingChapters.length > 0 ? 'running' : 'idle',
        goal,
        total: pendingChapters.length,
        completed: 0,
        failed: 0,
        running: 0,
        estimatedRequests: scoutPlan.estimatedRequests,
        completedRequests: 0,
        batchSize: scoutPlan.batchSize,
        strategy: scoutPlan.strategy,
        concurrency: safeConcurrency,
        error: null,
      },
    }));

    if (pendingChapters.length === 0) {
      return currentResults;
    }

    let cursor = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let completedRequests = 0;

    return new Promise((resolve) => {
      const finishIfDone = () => {
        if (scoutControl.runId !== runId) return true;
        const noMoreWork = cursor >= scoutBatches.length || scoutControl.paused || scoutControl.canceled;
        if (noMoreWork && running === 0) {
          const status = scoutControl.canceled ? 'canceled' : scoutControl.paused ? 'paused' : 'complete';
          set((state) => ({ scoutState: { ...state.scoutState, status, running: 0, completed, failed } }));
          resolve(get().scoutResults);
          return true;
        }
        return false;
      };

      const launchMore = () => {
        if (finishIfDone()) return;
        while (
          running < safeConcurrency
          && cursor < scoutBatches.length
          && !scoutControl.paused
          && !scoutControl.canceled
        ) {
          const batch = scoutBatches[cursor];
          const batchIndexes = batch.map((chapter) => Number(chapter.index));
          cursor += 1;
          running += 1;
          set((state) => ({ scoutState: { ...state.scoutState, running, completed, failed, completedRequests } }));

          getChaptersByIndexes(activeCorpusId, batchIndexes, { includeContent: true })
            .then((batchWithContent) => runChapterScoutBatch({
              corpusId: activeCorpusId,
              chapters: batchWithContent,
              totalChapters: chapters.length,
              goal,
              allowAdultSignals: adultAllowed,
            }).then((results) => ({ results, batchWithContent })))
            .then(async (results) => {
              const savedRecords = [];
              const coverageRecords = [];
              for (const result of results.results) {
                const chapter = results.batchWithContent.find((item) => Number(item.index) === Number(result.chapterIndex));
                const saved = await saveScoutResult(result);
                savedRecords.push(saved);
                if (chapter) {
                  await saveAnalysisCacheEntry(buildChapterAnalysisCacheEntry({
                    chapter,
                    analysisType: 'scout',
                    goal,
                    status: 'complete',
                    resultId: saved.id,
                  }));
                  coverageRecords.push({
                    corpusId: activeCorpusId,
                    chapterIndex: chapter.index,
                    localDone: true,
                    scoutDone: saved.status === 'complete',
                    scoutSynthetic: Boolean(saved.syntheticFallback),
                    status: saved.status === 'complete'
                      ? (saved.syntheticFallback ? 'synthetic_fallback' : 'complete')
                      : 'error',
                    failedReason: saved.status === 'error' ? saved.reason : '',
                  });
                }
                completed += 1;
              }
              const savedCoverage = await bulkSaveChapterCoverage(coverageRecords);
              set((state) => ({
                scoutResults: savedRecords.reduce((acc, record) => mergeResult(acc, record), state.scoutResults),
                chapterCoverage: savedCoverage.reduce((acc, record) => {
                  const id = record.id;
                  const existingIndex = acc.findIndex((item) => item.id === id);
                  if (existingIndex < 0) return [...acc, record];
                  const copy = [...acc];
                  copy[existingIndex] = record;
                  return copy;
                }, state.chapterCoverage),
              }));
            })
            .catch(async (error) => {
              const savedRecords = [];
              for (const chapter of batch) {
                const failedResult = createFailedScoutResult({
                  corpusId: activeCorpusId,
                  goal,
                  chapterIndex: chapter.index,
                  error,
                });
                const saved = await saveScoutResult(failedResult);
                savedRecords.push(saved);
                await saveChapterCoverage({
                  corpusId: activeCorpusId,
                  chapterIndex: chapter.index,
                  localDone: true,
                  scoutDone: false,
                  status: 'error',
                  failedReason: error?.message || 'Scout failed.',
                });
                failed += 1;
              }
              const projectId = get().activeProjectId;
              const refreshedCoverage = await getLabLiteCorpusBundle(activeCorpusId, projectId ? { projectId, allowUnscoped: false } : {});
              set((state) => ({
                scoutResults: savedRecords.reduce((acc, record) => mergeResult(acc, record), state.scoutResults),
                chapterCoverage: refreshedCoverage.chapterCoverage || state.chapterCoverage,
              }));
            })
            .finally(() => {
              running -= 1;
              completedRequests += 1;
              set((state) => ({ scoutState: { ...state.scoutState, running, completed, failed, completedRequests } }));
              launchMore();
            });
        }
      };

      launchMore();
    });
  },

  retryScoutFailures: async () => {
    const { currentCorpusId, scoutState } = get();
    return get().runScout({
      corpusId: currentCorpusId,
      goal: scoutState.goal,
      concurrency: scoutState.concurrency,
      onlyFailed: true,
    });
  },

  runArcMapper: async (corpusId = get().currentCorpusId) => {
    if (!corpusId) return [];
    set({ arcState: { status: 'running', error: null } });
    try {
      const { chapters, scoutResults } = get();
      const arcs = await runArcMapperService({
        corpusId,
        scoutResults: scoutResults.filter((result) => result.corpusId === corpusId),
        chapterCount: chapters.length,
      });
      const saved = await saveArcResults(corpusId, arcs);
      set({ arcs: saved, currentArcId: saved[0]?.id || null, arcState: { status: 'complete', error: null } });
      return saved;
    } catch (error) {
      set({ arcState: { status: 'error', error: error?.message || 'Arc Mapper failed.' } });
      throw error;
    }
  },

  cancelArcMapper: () => {
    abortArcMapper();
    set({ arcState: { status: 'canceled', error: null } });
  },

  runDeepAnalysis: async ({ contentMode = PROJECT_CONTENT_MODES.SAFE } = {}) => {
    const { currentCorpus, currentCorpusId, chapters, arcs, selectedArcIds, selectedDeepChapterIndexes } = get();
    if (!currentCorpusId) return null;
    const targets = buildDeepAnalysisTargets({
      selectedChapterIndexes: [...selectedDeepChapterIndexes],
      selectedArcIds: [...selectedArcIds],
      arcs,
      groupManualChapters: true,
      manualGroupSize: 6,
    });
    if (targets.length === 0) {
      set({ deepState: { status: 'error', total: 0, completed: 0, failed: 0, error: 'Hãy chọn chương hoặc arc để phân tích sâu.' } });
      return null;
    }

    const cacheEntries = await listAnalysisCacheEntries({ corpusId: currentCorpusId, analysisType: 'deep_analysis' });
    const cachedTargets = targets.filter((target) => {
      const goal = `${target.targetType}:${target.targetId}`;
      const targetChapters = chapters.filter((chapter) => (target.chapterIndexes || []).includes(Number(chapter.index)));
      if (targetChapters.length === 0) return false;
      return targetChapters.every((chapter) => {
        const cacheEntry = cacheEntries.find((entry) => (
          Number(entry.chapterIndex) === Number(chapter.index)
          && entry.goal === goal
        ));
        return shouldReuseAnalysisCache({ chapter, cacheEntry, analysisType: 'deep_analysis', goal });
      });
    });
    const targetsToRun = targets.filter((target) => !cachedTargets.includes(target));
    if (targetsToRun.length === 0) {
      set({ deepState: { status: 'complete', total: 0, completed: 0, failed: 0, error: null } });
      return null;
    }

    const runId = ++deepRunCounter;
    deepControl = { runId, canceled: false };
    const adultAllowed = allowAdultSignals(contentMode);
    const created = await createDeepAnalysisRun({
      corpusId: currentCorpusId,
      targets: targetsToRun,
      metadata: { allowAdultCanon: adultAllowed },
    });
    set((state) => ({
      deepAnalysisRuns: [...state.deepAnalysisRuns, created.run],
      deepAnalysisItems: [...state.deepAnalysisItems, ...created.items],
      deepState: { status: 'running', total: created.items.length, completed: 0, failed: 0, running: 0, concurrency: 2, error: null },
    }));

    let completed = 0;
    let failed = 0;
    let running = 0;
    let cursor = 0;
    const processItem = async (item) => {
      const target = targetsToRun.find((entry) => entry.targetType === item.targetType && String(entry.targetId) === String(item.targetId));
      if (!target || deepControl.runId !== runId || deepControl.canceled) return;
      await saveDeepAnalysisItem(item.id, { status: 'running' });
      set((state) => ({
        deepAnalysisItems: state.deepAnalysisItems.map((entry) => (entry.id === item.id ? { ...entry, status: 'running' } : entry)),
        deepState: { ...state.deepState, running },
      }));
      try {
        const targetChapters = await getChaptersByIndexes(currentCorpusId, target.chapterIndexes || [], { includeContent: true });
        const batches = planDeepAnalysisBatches({ targets: [target], chapters: targetChapters });
        const results = [];
        for (const batch of batches) {
          if (deepControl.runId !== runId || deepControl.canceled) break;
          results.push(await runDeepAnalysisBatch({
            corpusTitle: currentCorpus?.title || '',
            target,
            chapters: batch.chapters,
            allowAdultCanon: adultAllowed,
          }));
        }
        const merged = mergeDeepResult(results);
        const saved = await saveDeepAnalysisItem(item.id, { status: 'complete', result: merged, error: '' });
        const goal = `${target.targetType}:${target.targetId}`;
        await Promise.all((target.chapterIndexes || []).map((chapterIndex) => {
          const chapter = targetChapters.find((entry) => Number(entry.index) === Number(chapterIndex));
          if (!chapter) return null;
          return saveAnalysisCacheEntry(buildChapterAnalysisCacheEntry({
            chapter,
            analysisType: 'deep_analysis',
            goal,
            status: 'complete',
            resultId: saved.id,
          }));
        }).filter(Boolean));
        const savedCoverage = await bulkSaveChapterCoverage((target.chapterIndexes || []).map((chapterIndex) => ({
          corpusId: currentCorpusId,
          chapterIndex,
          localDone: true,
          deepDone: true,
          digestDone: true,
          status: 'complete',
        })));
        completed += 1;
        set((state) => ({
          deepAnalysisItems: state.deepAnalysisItems.map((entry) => (entry.id === item.id ? saved : entry)),
          chapterCoverage: savedCoverage.reduce((acc, record) => {
            const existingIndex = acc.findIndex((entry) => entry.id === record.id);
            if (existingIndex < 0) return [...acc, record];
            const copy = [...acc];
            copy[existingIndex] = record;
            return copy;
          }, state.chapterCoverage),
          deepState: { ...state.deepState, completed, failed, running },
        }));
      } catch (error) {
        const saved = await saveDeepAnalysisItem(item.id, { status: 'error', error: error?.message || 'Phân tích sâu thất bại.' });
        failed += 1;
        set((state) => ({
          deepAnalysisItems: state.deepAnalysisItems.map((entry) => (entry.id === item.id ? saved : entry)),
          deepState: { ...state.deepState, completed, failed, running },
        }));
      }
    };

    const launchWorker = async () => {
      while (cursor < created.items.length && deepControl.runId === runId && !deepControl.canceled) {
        const item = created.items[cursor];
        cursor += 1;
        running += 1;
        set((state) => ({ deepState: { ...state.deepState, running } }));
        await processItem(item);
        running -= 1;
        set((state) => ({ deepState: { ...state.deepState, running, completed, failed } }));
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, created.items.length) }, () => launchWorker()));

    const status = deepControl.canceled ? 'canceled' : failed > 0 ? 'complete_with_errors' : 'complete';
    const updatedRun = await updateDeepAnalysisRun(created.run.id, { status, completed, failed });
    set((state) => ({
      deepAnalysisRuns: state.deepAnalysisRuns.map((run) => (run.id === created.run.id ? updatedRun : run)),
      deepState: { ...state.deepState, status, completed, failed, running: 0 },
    }));
    return updatedRun;
  },

  cancelDeepAnalysis: () => {
    deepControl.canceled = true;
    abortDeepAnalysis();
    set((state) => ({ deepState: { ...state.deepState, status: 'canceled' } }));
  },

  buildCanonPack: async ({ contentMode = PROJECT_CONTENT_MODES.SAFE } = {}) => {
    const { activeProjectId, currentCorpus, currentCorpusId, arcs, scoutResults, deepAnalysisItems, ingestBatches } = get();
    if (!currentCorpusId || !currentCorpus) return null;
    set({ canonPackState: { status: 'building', error: null } });
    try {
      const pack = buildCanonPackArtifact({
        corpus: currentCorpus,
        arcs,
        scoutResults: scoutResults.filter((result) => result.corpusId === currentCorpusId),
        deepAnalysisItems: deepAnalysisItems.filter((item) => item.corpusId === currentCorpusId),
        allowAdultCanon: allowAdultSignals(contentMode),
        sourceBatches: ingestBatches.filter((batch) => batch.corpusId === currentCorpusId).map((batch) => batch.id),
      });
      const saved = await saveCanonPack({ ...pack, projectId: activeProjectId });
      await Promise.all(ingestBatches
        .filter((batch) => batch.corpusId === currentCorpusId)
        .map((batch) => updateIngestBatch(batch.id, { canonPackId: saved.id, status: 'merged' })));
      const canonPacks = await listCanonPacks(currentCorpusId);
      const refreshedBatches = await listIngestBatches({ corpusId: currentCorpusId });
      set({ canonPacks, ingestBatches: refreshedBatches, canonPackState: { status: 'complete', error: null } });
      return saved;
    } catch (error) {
      set({ canonPackState: { status: 'error', error: error?.message || 'Không dựng được Canon Pack.' } });
      throw error;
    }
  },

  createCanonPackMergePlan: async ({ baseCanonPackId = null, incomingCanonPackId = null, ingestBatchId = null } = {}) => {
    const { activeProjectId, canonPacks, currentCorpusId, ingestBatches } = get();
    const basePack = canonPacks.find((pack) => pack.id === baseCanonPackId) || canonPacks[0] || null;
    const incomingPack = canonPacks.find((pack) => pack.id === incomingCanonPackId)
      || canonPacks.find((pack) => pack.id !== basePack?.id)
      || null;
    if (!basePack || !incomingPack || basePack.id === incomingPack.id) return null;
    const ingestBatch = ingestBatches.find((batch) => batch.id === ingestBatchId)
      || ingestBatches.find((batch) => batch.canonPackId === incomingPack.id)
      || null;
    const plan = buildCanonPackMergePlanArtifact({ basePack, incomingPack, ingestBatch });
    const saved = await saveCanonPackMergePlan({ ...plan, corpusId: currentCorpusId, projectId: activeProjectId });
    const canonPackMergePlans = await listCanonPackMergePlans({ canonPackId: basePack.id });
    set({ canonPackMergePlans });
    return saved;
  },

  applyCanonPackMergePlan: async ({ mergePlanId, selectedActionIds = [] } = {}) => {
    const { canonPacks, canonPackMergePlans, currentCorpusId } = get();
    const plan = canonPackMergePlans.find((item) => item.id === mergePlanId) || canonPackMergePlans[0] || null;
    if (!plan) return null;
    const basePack = canonPacks.find((pack) => pack.id === plan.canonPackId) || canonPacks[0] || null;
    if (!basePack) return null;
    const merged = applyCanonPackMergePlanArtifact({ basePack, mergePlan: plan, selectedActionIds });
    const saved = await saveCanonPack(merged);
    const canonPacksNext = await listCanonPacks(basePack.corpusId || currentCorpusId);
    const canonPackMergePlansNext = await listCanonPackMergePlans({ canonPackId: basePack.id });
    set({ canonPacks: canonPacksNext, canonPackMergePlans: canonPackMergePlansNext });
    return saved;
  },

  createMaterializationPlan: async ({ canonPackId, projectId }) => {
    const pack = get().canonPacks.find((item) => item.id === canonPackId);
    if (!pack || !projectId) return null;
    set({ materializeState: { status: 'planning', error: null, appliedCount: 0 } });
    try {
      const plan = await buildMaterializationPlan({ canonPack: pack, projectId });
      const saved = await saveMaterializationPlan(plan);
      set({ materializationPlan: saved, materializeState: { status: 'planned', error: null, appliedCount: 0 } });
      return saved;
    } catch (error) {
      set({ materializeState: { status: 'error', error: error?.message || 'Không tạo được kế hoạch đưa vào dự án.', appliedCount: 0 } });
      throw error;
    }
  },

  applyMaterialization: async ({ selectedActionIds = null } = {}) => {
    const plan = get().materializationPlan;
    if (!plan) return null;
    set((state) => ({ materializeState: { ...state.materializeState, status: 'applying', error: null } }));
    try {
      const result = await applyMaterializationPlan(plan, { selectedActionIds });
      set({ materializeState: { status: 'applied', error: null, appliedCount: result.appliedCount || 0 } });
      return result;
    } catch (error) {
      set({ materializeState: { status: 'error', error: error?.message || 'Không áp dụng được Canon Pack.', appliedCount: 0 } });
      throw error;
    }
  },

  loadCanonReviews: async (filters = {}) => {
    const items = await listCanonReviewItems(filters);
    set({ canonReviewItems: items });
    return items;
  },

  runCanonReview: async (input) => {
    const runId = ++reviewRunCounter;
    reviewControl = { runId, canceled: false };
    const mode = input?.mode || 'standard';
    set({ canonReviewState: { status: 'running', error: null, mode } });
    try {
      const result = await runCanonReviewService(input || {});
      if (reviewControl.runId !== runId || reviewControl.canceled) return null;
      const saved = await saveCanonReviewItem({
        projectId: input?.projectId || input?.project?.id || null,
        chapterId: input?.chapterId || null,
        sceneId: input?.sceneId || null,
        canonPackId: input?.canonPackId || input?.canonPack?.id || null,
        mode,
        status: 'complete',
        verdict: result.verdict,
        result,
      });
      set((state) => ({
        canonReviewItems: [saved, ...state.canonReviewItems.filter((item) => item.id !== saved.id)],
        canonReviewState: { status: 'complete', error: null, mode },
      }));
      return saved;
    } catch (error) {
      set({ canonReviewState: { status: 'error', error: error?.message || 'Canon Review failed.', mode } });
      throw error;
    }
  },

  cancelCanonReview: () => {
    reviewControl.canceled = true;
    abortCanonReview();
    set((state) => ({ canonReviewState: { ...state.canonReviewState, status: 'canceled' } }));
  },

  updateCanonReviewStatus: async (id, patch = {}) => {
    const saved = await updateCanonReviewItem(id, patch);
    set((state) => ({
      canonReviewItems: state.canonReviewItems.map((item) => (item.id === id ? saved : item)),
    }));
    return saved;
  },
}));

export default useLabLiteStore;
