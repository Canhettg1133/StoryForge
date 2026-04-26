import Dexie from 'dexie';
import { hashLabLiteContent } from './longContextPlanner.js';

export const labLiteDb = new Dexie('StoryForgeLabLiteDB');

labLiteDb.version(1).stores({
  corpuses: 'id, title, sourceFileName, fileType, createdAt, updatedAt',
  chapters: 'id, corpusId, index, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
});

labLiteDb.version(2).stores({
  corpuses: 'id, title, sourceFileName, fileType, createdAt, updatedAt',
  chapters: 'id, corpusId, index, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
  deepAnalysisRuns: 'id, corpusId, status, createdAt, updatedAt',
  deepAnalysisItems: 'id, corpusId, runId, targetType, targetId, status, [corpusId+runId]',
  canonPacks: 'id, corpusId, title, status, updatedAt, linkedProjectId',
  materializationPlans: 'id, canonPackId, projectId, status, updatedAt',
});

labLiteDb.version(3).stores({
  corpuses: 'id, title, sourceFileName, fileType, createdAt, updatedAt',
  chapters: 'id, corpusId, index, contentHash, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
  deepAnalysisRuns: 'id, corpusId, status, createdAt, updatedAt',
  deepAnalysisItems: 'id, corpusId, runId, targetType, targetId, status, [corpusId+runId]',
  canonPacks: 'id, corpusId, title, status, updatedAt, linkedProjectId',
  materializationPlans: 'id, canonPackId, projectId, status, updatedAt',
  canonReviewItems: 'id, projectId, chapterId, sceneId, canonPackId, status, verdict, updatedAt, [projectId+canonPackId]',
  analysisCache: 'id, corpusId, chapterId, chapterIndex, analysisType, goal, contentHash, status, updatedAt, [corpusId+analysisType], [corpusId+analysisType+goal]',
});

labLiteDb.version(4).stores({
  corpuses: 'id, title, sourceFileName, fileType, createdAt, updatedAt',
  chapters: 'id, corpusId, index, contentHash, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
  deepAnalysisRuns: 'id, corpusId, status, createdAt, updatedAt',
  deepAnalysisItems: 'id, corpusId, runId, targetType, targetId, status, [corpusId+runId]',
  canonPacks: 'id, corpusId, title, status, updatedAt, linkedProjectId',
  materializationPlans: 'id, canonPackId, projectId, status, updatedAt',
  canonReviewItems: 'id, projectId, chapterId, sceneId, canonPackId, status, verdict, updatedAt, [projectId+canonPackId]',
  analysisCache: 'id, corpusId, chapterId, chapterIndex, analysisType, goal, contentHash, status, updatedAt, [corpusId+analysisType], [corpusId+analysisType+goal]',
  ingestBatches: 'id, corpusId, canonPackId, type, status, createdAt, updatedAt',
  canonPackMergePlans: 'id, canonPackId, ingestBatchId, status, updatedAt',
});

labLiteDb.version(5).stores({
  corpuses: 'id, title, sourceFileName, fileType, createdAt, updatedAt',
  chapters: 'id, corpusId, index, contentHash, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
  deepAnalysisRuns: 'id, corpusId, status, createdAt, updatedAt',
  deepAnalysisItems: 'id, corpusId, runId, targetType, targetId, status, [corpusId+runId]',
  canonPacks: 'id, corpusId, title, status, updatedAt, linkedProjectId',
  materializationPlans: 'id, canonPackId, projectId, status, updatedAt',
  canonReviewItems: 'id, projectId, chapterId, sceneId, canonPackId, status, verdict, updatedAt, [projectId+canonPackId]',
  analysisCache: 'id, corpusId, chapterId, chapterIndex, analysisType, goal, contentHash, status, updatedAt, [corpusId+analysisType], [corpusId+analysisType+goal]',
  ingestBatches: 'id, corpusId, canonPackId, type, status, createdAt, updatedAt',
  canonPackMergePlans: 'id, canonPackId, ingestBatchId, status, updatedAt',
  analysisJobs: 'id, corpusId, mode, phase, status, createdAt, updatedAt, [corpusId+status]',
  analysisJobItems: 'id, jobId, corpusId, chapterIndex, batchId, status, retryCount, updatedAt, [jobId+status], [corpusId+chapterIndex]',
  chapterCoverage: 'id, corpusId, chapterIndex, status, failedReason, updatedAt, [corpusId+chapterIndex], [corpusId+status]',
});

labLiteDb.version(6).stores({
  corpuses: 'id, projectId, title, sourceFileName, fileType, createdAt, updatedAt, [projectId+updatedAt]',
  chapters: 'id, corpusId, index, contentHash, [corpusId+index]',
  scoutResults: 'id, corpusId, chapterIndex, goal, status, recommendation, priority, [corpusId+goal], [corpusId+chapterIndex]',
  arcs: 'id, corpusId, chapterStart, chapterEnd, importance, [corpusId+chapterStart]',
  deepAnalysisRuns: 'id, corpusId, status, createdAt, updatedAt',
  deepAnalysisItems: 'id, corpusId, runId, targetType, targetId, status, [corpusId+runId]',
  canonPacks: 'id, corpusId, projectId, title, status, updatedAt, linkedProjectId',
  materializationPlans: 'id, canonPackId, projectId, status, updatedAt',
  canonReviewItems: 'id, projectId, chapterId, sceneId, canonPackId, status, verdict, updatedAt, [projectId+canonPackId]',
  analysisCache: 'id, corpusId, chapterId, chapterIndex, analysisType, goal, contentHash, status, updatedAt, [corpusId+analysisType], [corpusId+analysisType+goal]',
  ingestBatches: 'id, corpusId, projectId, canonPackId, type, status, createdAt, updatedAt',
  canonPackMergePlans: 'id, canonPackId, ingestBatchId, status, updatedAt',
  analysisJobs: 'id, corpusId, mode, phase, status, createdAt, updatedAt, [corpusId+status]',
  analysisJobItems: 'id, jobId, corpusId, chapterIndex, batchId, status, retryCount, updatedAt, [jobId+status], [corpusId+chapterIndex]',
  chapterCoverage: 'id, corpusId, chapterIndex, status, failedReason, updatedAt, [corpusId+chapterIndex], [corpusId+status]',
});

function createId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return Date.now();
}

export function normalizeProjectId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function emptyCorpusBundle() {
  return {
    corpus: null,
    chapters: [],
    scoutResults: [],
    arcs: [],
    deepAnalysisRuns: [],
    deepAnalysisItems: [],
    canonPacks: [],
    ingestBatches: [],
    canonPackMergePlans: [],
    chapterCoverage: [],
  };
}

export function corpusBelongsToProject(corpus, projectId, { allowUnscoped = true } = {}) {
  if (!corpus) return false;
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return true;
  const corpusProjectId = normalizeProjectId(corpus.projectId);
  if (!corpusProjectId) return Boolean(allowUnscoped);
  return corpusProjectId === normalizedProjectId;
}

async function tableToArray(table, orderBy = null) {
  if (!table) return [];
  if (orderBy && typeof table.orderBy === 'function') {
    return table.orderBy(orderBy).reverse().toArray();
  }
  if (typeof table.toArray === 'function') {
    return table.toArray();
  }
  if (typeof table.where === 'function') {
    return table.where('id').toArray();
  }
  return [];
}

function countLines(value = '') {
  const text = String(value || '');
  if (!text) return 0;
  return text.split(/\n/u).length;
}

export function toChapterMeta(chapter = {}) {
  return {
    id: chapter.id || '',
    corpusId: chapter.corpusId || '',
    index: Number(chapter.index || chapter.chapterIndex || 0),
    title: chapter.title || '',
    wordCount: Number(chapter.wordCount || 0),
    estimatedTokens: Number(chapter.estimatedTokens || 0),
    lineCount: Number(chapter.lineCount || countLines(chapter.content || '')),
    startLine: Number(chapter.startLine || 0),
    endLine: Number(chapter.endLine || 0),
    contentHash: chapter.contentHash || hashLabLiteContent(chapter.content || ''),
  };
}

function withChapterDerivedFields(chapter = {}, { corpusId = '', index = 0 } = {}) {
  const content = String(chapter.content || '');
  return {
    ...chapter,
    corpusId,
    index,
    content,
    lineCount: Number(chapter.lineCount || countLines(content)),
    contentHash: chapter.contentHash || hashLabLiteContent(content),
  };
}

async function queryAnalysisCache({ corpusId = null, analysisType = null, goal = null } = {}) {
  if (corpusId && analysisType && goal) {
    return labLiteDb.analysisCache
      .where('[corpusId+analysisType+goal]')
      .equals([corpusId, analysisType, goal])
      .toArray();
  }
  if (corpusId && analysisType) {
    return labLiteDb.analysisCache
      .where('[corpusId+analysisType]')
      .equals([corpusId, analysisType])
      .toArray();
  }
  if (corpusId) {
    return labLiteDb.analysisCache
      .where('corpusId')
      .equals(corpusId)
      .toArray();
  }
  return tableToArray(labLiteDb.analysisCache);
}

async function listCanonPackMergePlansForPacks(canonPacks = []) {
  const packIds = [...new Set((canonPacks || []).map((pack) => pack?.id).filter(Boolean))];
  if (packIds.length === 0) return [];
  const groups = await Promise.all(packIds.map((packId) => (
    labLiteDb.canonPackMergePlans.where('canonPackId').equals(packId).toArray()
  )));
  return groups
    .flat()
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function idsOf(items = []) {
  return [...new Set((items || []).map((item) => item?.id).filter(Boolean))];
}

async function bulkDeleteByIds(table, ids = []) {
  const safeIds = [...new Set((ids || []).filter(Boolean))];
  if (safeIds.length === 0) return 0;
  await table.bulkDelete(safeIds);
  return safeIds.length;
}

export async function saveParsedCorpus(parsed) {
  const corpusId = parsed.id || createId('corpus');
  const chapters = (parsed.chapters || []).map((chapter, index) => withChapterDerivedFields({
    ...chapter,
    id: `${corpusId}_chapter_${String(index + 1).padStart(5, '0')}`,
  }, {
    corpusId,
    index: index + 1,
  }));
  const timestamp = now();
  const totalWords = chapters.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
  const totalEstimatedTokens = chapters.reduce((sum, chapter) => sum + Number(chapter.estimatedTokens || 0), 0);
  const corpus = {
    id: corpusId,
    projectId: normalizeProjectId(parsed.projectId),
    title: parsed.title || 'Untitled',
    sourceFileName: parsed.sourceFileName || '',
    fileType: parsed.fileType || 'txt',
    frontMatter: parsed.frontMatter || null,
    parseDiagnostics: parsed.diagnostics || null,
    chapterCount: chapters.length,
    totalWords,
    totalEstimatedTokens,
    createdAt: parsed.createdAt || timestamp,
    updatedAt: timestamp,
  };

  await labLiteDb.transaction('rw', labLiteDb.corpuses, labLiteDb.chapters, async () => {
    await labLiteDb.corpuses.put(corpus);
    await labLiteDb.chapters.where('corpusId').equals(corpusId).delete();
    await labLiteDb.chapters.bulkPut(chapters);
  });

  return { corpus, chapters: chapters.map(toChapterMeta) };
}

export async function listLabLiteCorpuses(options = {}) {
  const hasProjectFilter = Object.prototype.hasOwnProperty.call(options, 'projectId');
  const projectId = normalizeProjectId(options.projectId);
  const includeUnscoped = Boolean(options.includeUnscoped);
  const items = await labLiteDb.corpuses.orderBy('updatedAt').reverse().toArray();
  if (!hasProjectFilter) return items;
  return items.filter((corpus) => {
    const corpusProjectId = normalizeProjectId(corpus.projectId);
    if (corpusProjectId === projectId) return true;
    return includeUnscoped && !corpusProjectId;
  });
}

export async function renameLabLiteCorpus(corpusId, title) {
  const cleaned = String(title || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!corpusId || !cleaned) return null;
  await labLiteDb.corpuses.update(corpusId, {
    title: cleaned,
    updatedAt: now(),
  });
  return labLiteDb.corpuses.get(corpusId);
}

export async function getLabLiteCorpusBundle(corpusId, options = {}) {
  if (!corpusId) return emptyCorpusBundle();
  const loadedCorpus = await labLiteDb.corpuses.get(corpusId);
  if (!loadedCorpus) return emptyCorpusBundle();
  if (
    Object.prototype.hasOwnProperty.call(options, 'projectId')
    && !corpusBelongsToProject(loadedCorpus, options.projectId, {
      allowUnscoped: options.allowUnscoped !== false,
    })
  ) {
    return emptyCorpusBundle();
  }
  const [corpus, chapters, scoutResults, arcs, deepAnalysisRuns, deepAnalysisItems, canonPacks, ingestBatches, chapterCoverage] = await Promise.all([
    Promise.resolve(loadedCorpus),
    labLiteDb.chapters.where('corpusId').equals(corpusId).sortBy('index'),
    labLiteDb.scoutResults.where('corpusId').equals(corpusId).toArray(),
    labLiteDb.arcs.where('corpusId').equals(corpusId).sortBy('chapterStart'),
    labLiteDb.deepAnalysisRuns.where('corpusId').equals(corpusId).toArray(),
    labLiteDb.deepAnalysisItems.where('corpusId').equals(corpusId).toArray(),
    labLiteDb.canonPacks.where('corpusId').equals(corpusId).toArray(),
    labLiteDb.ingestBatches.where('corpusId').equals(corpusId).toArray(),
    labLiteDb.chapterCoverage.where('corpusId').equals(corpusId).toArray(),
  ]);
  const canonPackMergePlans = await listCanonPackMergePlansForPacks(canonPacks);
  return {
    corpus: corpus || null,
    chapters: chapters.map(toChapterMeta),
    scoutResults,
    arcs,
    deepAnalysisRuns,
    deepAnalysisItems,
    canonPacks,
    ingestBatches,
    canonPackMergePlans,
    chapterCoverage,
  };
}

export async function deleteLabLiteCorpus(corpusId, options = {}) {
  if (!corpusId) return { deleted: false, corpusId: null, reason: 'missing_corpus_id', counts: {} };
  const loadedCorpus = await labLiteDb.corpuses.get(corpusId);
  if (!loadedCorpus) return { deleted: false, corpusId, reason: 'not_found', counts: {} };
  if (
    Object.prototype.hasOwnProperty.call(options, 'projectId')
    && !corpusBelongsToProject(loadedCorpus, options.projectId, {
      allowUnscoped: options.allowUnscoped !== false,
    })
  ) {
    return { deleted: false, corpusId, reason: 'project_mismatch', counts: {} };
  }

  const counts = {};
  await labLiteDb.transaction(
    'rw',
    labLiteDb.corpuses,
    labLiteDb.chapters,
    labLiteDb.scoutResults,
    labLiteDb.arcs,
    labLiteDb.deepAnalysisRuns,
    labLiteDb.deepAnalysisItems,
    labLiteDb.canonPacks,
    labLiteDb.materializationPlans,
    labLiteDb.canonReviewItems,
    labLiteDb.analysisCache,
    labLiteDb.ingestBatches,
    labLiteDb.canonPackMergePlans,
    labLiteDb.analysisJobs,
    labLiteDb.analysisJobItems,
    labLiteDb.chapterCoverage,
    async () => {
      const [canonPacks, ingestBatches, mergePlans, materializationPlans, canonReviewItems] = await Promise.all([
        labLiteDb.canonPacks.where('corpusId').equals(corpusId).toArray(),
        labLiteDb.ingestBatches.where('corpusId').equals(corpusId).toArray(),
        labLiteDb.canonPackMergePlans.toArray(),
        labLiteDb.materializationPlans.toArray(),
        labLiteDb.canonReviewItems.toArray(),
      ]);
      const canonPackIds = new Set(idsOf(canonPacks));
      const ingestBatchIds = new Set(idsOf(ingestBatches));
      const mergePlanIds = idsOf(mergePlans.filter((plan) => (
        plan.corpusId === corpusId
        || canonPackIds.has(plan.canonPackId)
        || ingestBatchIds.has(plan.ingestBatchId)
      )));
      const materializationPlanIds = idsOf(materializationPlans.filter((plan) => canonPackIds.has(plan.canonPackId)));
      const canonReviewItemIds = idsOf(canonReviewItems.filter((item) => canonPackIds.has(item.canonPackId)));

      counts.canonPackMergePlans = await bulkDeleteByIds(labLiteDb.canonPackMergePlans, mergePlanIds);
      counts.materializationPlans = await bulkDeleteByIds(labLiteDb.materializationPlans, materializationPlanIds);
      counts.canonReviewItems = await bulkDeleteByIds(labLiteDb.canonReviewItems, canonReviewItemIds);
      counts.chapters = await labLiteDb.chapters.where('corpusId').equals(corpusId).delete();
      counts.scoutResults = await labLiteDb.scoutResults.where('corpusId').equals(corpusId).delete();
      counts.arcs = await labLiteDb.arcs.where('corpusId').equals(corpusId).delete();
      counts.deepAnalysisRuns = await labLiteDb.deepAnalysisRuns.where('corpusId').equals(corpusId).delete();
      counts.deepAnalysisItems = await labLiteDb.deepAnalysisItems.where('corpusId').equals(corpusId).delete();
      counts.canonPacks = await labLiteDb.canonPacks.where('corpusId').equals(corpusId).delete();
      counts.analysisCache = await labLiteDb.analysisCache.where('corpusId').equals(corpusId).delete();
      counts.ingestBatches = await labLiteDb.ingestBatches.where('corpusId').equals(corpusId).delete();
      counts.analysisJobs = await labLiteDb.analysisJobs.where('corpusId').equals(corpusId).delete();
      counts.analysisJobItems = await labLiteDb.analysisJobItems.where('corpusId').equals(corpusId).delete();
      counts.chapterCoverage = await labLiteDb.chapterCoverage.where('corpusId').equals(corpusId).delete();
      await labLiteDb.corpuses.delete(corpusId);
      counts.corpuses = 1;
    },
  );

  return { deleted: true, corpusId, counts };
}

export async function clearCorpusAnalysisArtifacts(corpusId) {
  if (!corpusId) return { corpusId: null, counts: {} };
  const counts = {};
  await labLiteDb.transaction(
    'rw',
    labLiteDb.scoutResults,
    labLiteDb.arcs,
    labLiteDb.deepAnalysisRuns,
    labLiteDb.deepAnalysisItems,
    labLiteDb.canonPacks,
    labLiteDb.materializationPlans,
    labLiteDb.canonReviewItems,
    labLiteDb.analysisCache,
    labLiteDb.canonPackMergePlans,
    labLiteDb.analysisJobs,
    labLiteDb.analysisJobItems,
    labLiteDb.chapterCoverage,
    async () => {
      const [canonPacks, mergePlans, materializationPlans, canonReviewItems] = await Promise.all([
        labLiteDb.canonPacks.where('corpusId').equals(corpusId).toArray(),
        labLiteDb.canonPackMergePlans.toArray(),
        labLiteDb.materializationPlans.toArray(),
        labLiteDb.canonReviewItems.toArray(),
      ]);
      const canonPackIds = new Set(idsOf(canonPacks));
      const mergePlanIds = idsOf(mergePlans.filter((plan) => (
        plan.corpusId === corpusId
        || canonPackIds.has(plan.canonPackId)
      )));
      const materializationPlanIds = idsOf(materializationPlans.filter((plan) => canonPackIds.has(plan.canonPackId)));
      const canonReviewItemIds = idsOf(canonReviewItems.filter((item) => canonPackIds.has(item.canonPackId)));

      counts.canonPackMergePlans = await bulkDeleteByIds(labLiteDb.canonPackMergePlans, mergePlanIds);
      counts.materializationPlans = await bulkDeleteByIds(labLiteDb.materializationPlans, materializationPlanIds);
      counts.canonReviewItems = await bulkDeleteByIds(labLiteDb.canonReviewItems, canonReviewItemIds);
      counts.scoutResults = await labLiteDb.scoutResults.where('corpusId').equals(corpusId).delete();
      counts.arcs = await labLiteDb.arcs.where('corpusId').equals(corpusId).delete();
      counts.deepAnalysisRuns = await labLiteDb.deepAnalysisRuns.where('corpusId').equals(corpusId).delete();
      counts.deepAnalysisItems = await labLiteDb.deepAnalysisItems.where('corpusId').equals(corpusId).delete();
      counts.canonPacks = await labLiteDb.canonPacks.where('corpusId').equals(corpusId).delete();
      counts.analysisCache = await labLiteDb.analysisCache.where('corpusId').equals(corpusId).delete();
      counts.analysisJobs = await labLiteDb.analysisJobs.where('corpusId').equals(corpusId).delete();
      counts.analysisJobItems = await labLiteDb.analysisJobItems.where('corpusId').equals(corpusId).delete();
      counts.chapterCoverage = await labLiteDb.chapterCoverage.where('corpusId').equals(corpusId).delete();
    },
  );
  return { corpusId, counts };
}

export async function listChapterMetas(corpusId) {
  if (!corpusId) return [];
  const chapters = await labLiteDb.chapters.where('corpusId').equals(corpusId).sortBy('index');
  return chapters.map(toChapterMeta);
}

export async function getChapterContent(chapterId) {
  if (!chapterId) return '';
  const chapter = await labLiteDb.chapters.get(chapterId);
  return String(chapter?.content || '');
}

export async function getChapterById(chapterId, { includeContent = false } = {}) {
  if (!chapterId) return null;
  const chapter = await labLiteDb.chapters.get(chapterId);
  if (!chapter) return null;
  return includeContent ? chapter : toChapterMeta(chapter);
}

export async function getChaptersByIndexes(corpusId, indexes = [], { includeContent = false } = {}) {
  if (!corpusId) return [];
  const wanted = new Set((indexes || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0));
  if (wanted.size === 0) return [];
  const chapters = await labLiteDb.chapters.where('corpusId').equals(corpusId).filter((chapter) => wanted.has(Number(chapter.index))).toArray();
  return chapters
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((chapter) => (includeContent ? chapter : toChapterMeta(chapter)));
}

export async function listChaptersWithContent(corpusId) {
  if (!corpusId) return [];
  return labLiteDb.chapters.where('corpusId').equals(corpusId).sortBy('index');
}

export async function replaceCorpusChapters(corpusId, chapters = []) {
  const normalized = chapters.map((chapter, index) => withChapterDerivedFields(chapter, {
    corpusId,
    index: index + 1,
  }));
  const totalWords = normalized.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
  const totalEstimatedTokens = normalized.reduce((sum, chapter) => sum + Number(chapter.estimatedTokens || 0), 0);

  await labLiteDb.transaction('rw', labLiteDb.corpuses, labLiteDb.chapters, async () => {
    await labLiteDb.chapters.where('corpusId').equals(corpusId).delete();
    await labLiteDb.chapters.bulkPut(normalized);
    await labLiteDb.corpuses.update(corpusId, {
      chapterCount: normalized.length,
      totalWords,
      totalEstimatedTokens,
      updatedAt: now(),
    });
  });

  return normalized.map(toChapterMeta);
}

export async function saveScoutResult(result) {
  const id = result.id || `${result.corpusId}_${result.goal || 'default'}_scout_${result.chapterIndex}`;
  const record = { ...result, id, updatedAt: now() };
  await labLiteDb.scoutResults.put(record);
  return record;
}

export async function saveArcResults(corpusId, arcs = []) {
  const timestamp = now();
  const records = arcs.map((arc, index) => ({
    ...arc,
    id: arc.id || `${corpusId}_arc_${String(index + 1).padStart(3, '0')}`,
    corpusId,
    updatedAt: timestamp,
  }));
  await labLiteDb.transaction('rw', labLiteDb.arcs, async () => {
    await labLiteDb.arcs.where('corpusId').equals(corpusId).delete();
    if (records.length > 0) {
      await labLiteDb.arcs.bulkPut(records);
    }
  });
  return records;
}

export async function createDeepAnalysisRun({ corpusId, targets = [], status = 'running', metadata = {} }) {
  const timestamp = now();
  const id = createId(`${corpusId || 'corpus'}_deep_run`);
  const run = {
    id,
    corpusId,
    status,
    metadata,
    total: targets.length,
    completed: 0,
    failed: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items = targets.map((target, index) => ({
    id: `${id}_item_${String(index + 1).padStart(4, '0')}`,
    corpusId,
    runId: id,
    targetType: target.targetType || target.type || 'chapter',
    targetId: String(target.targetId || target.id || target.chapterIndex || index + 1),
    chapterIndexes: target.chapterIndexes || [],
    title: target.title || '',
    status: 'pending',
    result: null,
    error: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  await labLiteDb.transaction('rw', labLiteDb.deepAnalysisRuns, labLiteDb.deepAnalysisItems, async () => {
    await labLiteDb.deepAnalysisRuns.put(run);
    if (items.length > 0) {
      await labLiteDb.deepAnalysisItems.bulkPut(items);
    }
  });
  return { run, items };
}

export async function updateDeepAnalysisRun(runId, patch = {}) {
  const record = { ...patch, updatedAt: now() };
  await labLiteDb.deepAnalysisRuns.update(runId, record);
  return labLiteDb.deepAnalysisRuns.get(runId);
}

export async function saveDeepAnalysisItem(itemId, patch = {}) {
  const record = { ...patch, updatedAt: now() };
  await labLiteDb.deepAnalysisItems.update(itemId, record);
  return labLiteDb.deepAnalysisItems.get(itemId);
}

export async function listDeepAnalysisItems(corpusId) {
  if (!corpusId) return [];
  return labLiteDb.deepAnalysisItems.where('corpusId').equals(corpusId).toArray();
}

export async function saveCanonPack(pack) {
  const timestamp = now();
  const id = pack.id || createId(`${pack.corpusId || 'corpus'}_canon_pack`);
  const projectId = normalizeProjectId(pack.projectId || pack.linkedProjectId);
  const record = {
    ...pack,
    id,
    projectId,
    status: pack.status || 'draft',
    createdAt: pack.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.canonPacks.put(record);
  return record;
}

export async function saveIngestBatch(batch = {}) {
  const timestamp = now();
  const id = batch.id || createId(`ingest_${batch.type || 'source'}`);
  const record = {
    ...batch,
    id,
    projectId: normalizeProjectId(batch.projectId),
    type: batch.type || 'source_story',
    status: batch.status || 'imported',
    createdAt: batch.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.ingestBatches.put(record);
  return record;
}

export async function listIngestBatches({ corpusId = null, canonPackId = null, projectId = null } = {}) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const items = await tableToArray(labLiteDb.ingestBatches);
  return items
    .filter((item) => !corpusId || item.corpusId === corpusId)
    .filter((item) => !canonPackId || item.canonPackId === canonPackId)
    .filter((item) => !normalizedProjectId || normalizeProjectId(item.projectId) === normalizedProjectId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function updateIngestBatch(id, patch = {}) {
  const record = { ...patch, updatedAt: now() };
  await labLiteDb.ingestBatches.update(id, record);
  return labLiteDb.ingestBatches.get(id);
}

export async function saveCanonPackMergePlan(plan = {}) {
  const timestamp = now();
  const id = plan.id || createId(`merge_${plan.canonPackId || 'canon_pack'}`);
  const record = {
    ...plan,
    id,
    status: plan.status || 'draft',
    createdAt: plan.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.canonPackMergePlans.put(record);
  return record;
}

export async function listCanonPackMergePlans({ canonPackId = null, ingestBatchId = null } = {}) {
  const items = await tableToArray(labLiteDb.canonPackMergePlans);
  return items
    .filter((item) => !canonPackId || item.canonPackId === canonPackId)
    .filter((item) => !ingestBatchId || item.ingestBatchId === ingestBatchId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function listCanonPacks(corpusId = null) {
  if (corpusId) {
    return labLiteDb.canonPacks.where('corpusId').equals(corpusId).toArray();
  }
  return labLiteDb.canonPacks.orderBy('updatedAt').reverse().toArray();
}

export async function getCanonPackById(canonPackId) {
  if (!canonPackId) return null;
  return labLiteDb.canonPacks.get(canonPackId);
}

export async function saveCanonReviewItem(item) {
  const timestamp = now();
  const result = item.result || null;
  const id = item.id || createId(`canon_review_${item.projectId || 'project'}`);
  const record = {
    ...item,
    id,
    result,
    status: item.status || 'complete',
    verdict: item.verdict || result?.verdict || 'no_obvious_issue',
    createdAt: item.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.canonReviewItems.put(record);
  return record;
}

export async function listCanonReviewItems({ projectId = null, canonPackId = null, chapterId = null, sceneId = null } = {}) {
  const items = await tableToArray(labLiteDb.canonReviewItems);
  return items
    .filter((item) => !projectId || item.projectId === projectId)
    .filter((item) => !canonPackId || item.canonPackId === canonPackId)
    .filter((item) => !chapterId || item.chapterId === chapterId)
    .filter((item) => !sceneId || item.sceneId === sceneId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function updateCanonReviewItem(id, patch = {}) {
  const record = { ...patch, updatedAt: now() };
  await labLiteDb.canonReviewItems.update(id, record);
  return labLiteDb.canonReviewItems.get(id);
}

export async function saveAnalysisCacheEntry(entry) {
  const timestamp = now();
  const id = entry.id || [
    entry.corpusId || 'corpus',
    entry.analysisType || 'analysis',
    entry.goal || 'default',
    entry.chapterId || entry.chapterIndex || 'chapter',
  ].join('_');
  const record = {
    ...entry,
    id,
    status: entry.status || 'complete',
    createdAt: entry.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.analysisCache.put(record);
  return record;
}

export async function listAnalysisCacheEntries({ corpusId = null, analysisType = null, goal = null } = {}) {
  const items = await queryAnalysisCache({ corpusId, analysisType, goal });
  return items
    .filter((item) => !corpusId || item.corpusId === corpusId)
    .filter((item) => !analysisType || item.analysisType === analysisType)
    .filter((item) => !goal || item.goal === goal)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function saveAnalysisJob(job = {}) {
  const timestamp = now();
  const id = job.id || createId(`analysis_job_${job.phase || 'run'}`);
  const record = {
    ...job,
    id,
    status: job.status || 'pending',
    progress: Number(job.progress || 0),
    error: job.error || '',
    createdAt: job.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.analysisJobs.put(record);
  return record;
}

export async function saveAnalysisJobItems(items = []) {
  const timestamp = now();
  const records = (items || []).map((item, index) => ({
    ...item,
    id: item.id || `${item.jobId || 'job'}_item_${String(index + 1).padStart(5, '0')}`,
    status: item.status || 'pending',
    retryCount: Number(item.retryCount || 0),
    error: item.error || '',
    createdAt: item.createdAt || timestamp,
    updatedAt: timestamp,
  }));
  if (records.length > 0) {
    await labLiteDb.analysisJobItems.bulkPut(records);
  }
  return records;
}

export async function updateAnalysisJob(id, patch = {}) {
  const record = { ...patch, updatedAt: now() };
  await labLiteDb.analysisJobs.update(id, record);
  return labLiteDb.analysisJobs.get(id);
}

export async function listAnalysisJobs({ corpusId = null, status = null } = {}) {
  if (corpusId && status) {
    return labLiteDb.analysisJobs.where('[corpusId+status]').equals([corpusId, status]).toArray();
  }
  if (corpusId) {
    return labLiteDb.analysisJobs.where('corpusId').equals(corpusId).toArray();
  }
  return tableToArray(labLiteDb.analysisJobs, 'updatedAt');
}

export async function saveChapterCoverage(entry = {}) {
  const timestamp = now();
  const corpusId = entry.corpusId || '';
  const chapterIndex = Number(entry.chapterIndex || 0);
  const id = entry.id || `${corpusId}_coverage_${chapterIndex}`;
  const status = entry.status || (
    entry.failedReason
      ? 'error'
      : entry.scoutSynthetic
        ? 'synthetic_fallback'
        : (entry.localDone || entry.scoutDone || entry.digestDone || entry.deepDone) ? 'complete' : 'missing'
  );
  const record = {
    ...entry,
    id,
    corpusId,
    chapterIndex,
    status,
    localDone: Boolean(entry.localDone),
    scoutDone: Boolean(entry.scoutDone),
    scoutSynthetic: Boolean(entry.scoutSynthetic),
    digestDone: Boolean(entry.digestDone),
    deepDone: Boolean(entry.deepDone),
    failedReason: entry.failedReason || '',
    createdAt: entry.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.chapterCoverage.put(record);
  return record;
}

export async function bulkSaveChapterCoverage(entries = []) {
  const timestamp = now();
  const records = (entries || []).map((entry) => {
    const corpusId = entry.corpusId || '';
    const chapterIndex = Number(entry.chapterIndex || 0);
    const status = entry.status || (
      entry.failedReason
        ? 'error'
        : entry.scoutSynthetic
          ? 'synthetic_fallback'
          : (entry.localDone || entry.scoutDone || entry.digestDone || entry.deepDone) ? 'complete' : 'missing'
    );
    return {
      ...entry,
      id: entry.id || `${corpusId}_coverage_${chapterIndex}`,
      corpusId,
      chapterIndex,
      status,
      localDone: Boolean(entry.localDone),
      scoutDone: Boolean(entry.scoutDone),
      scoutSynthetic: Boolean(entry.scoutSynthetic),
      digestDone: Boolean(entry.digestDone),
      deepDone: Boolean(entry.deepDone),
      failedReason: entry.failedReason || '',
      createdAt: entry.createdAt || timestamp,
      updatedAt: timestamp,
    };
  });
  if (records.length > 0) {
    await labLiteDb.chapterCoverage.bulkPut(records);
  }
  return records;
}

export async function listChapterCoverage(corpusId) {
  if (!corpusId) return [];
  return labLiteDb.chapterCoverage.where('corpusId').equals(corpusId).toArray();
}

export async function saveMaterializationPlan(plan) {
  const timestamp = now();
  const id = plan.id || createId(`materialize_${plan.canonPackId || 'canon_pack'}`);
  const record = {
    ...plan,
    id,
    status: plan.status || 'draft',
    createdAt: plan.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await labLiteDb.materializationPlans.put(record);
  return record;
}

export default labLiteDb;
