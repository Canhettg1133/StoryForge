import { labLiteDb } from '../labLite/labLiteDb.js';
import { remapOptional } from '../db/snapshotRemap.js';

const LAB_TABLES = Object.freeze([
  'corpuses', 'chapters', 'scoutResults', 'arcs', 'deepAnalysisRuns', 'deepAnalysisItems',
  'canonPacks', 'materializationPlans', 'canonReviewItems', 'analysisCache', 'ingestBatches',
  'canonPackMergePlans', 'chapterCoverage',
]);

function makeId(oldId, prefix) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${String(oldId || 'item')}-${suffix}`;
}

function makeMap(rows, prefix) {
  return new Map((rows || []).filter((row) => row?.id != null).map((row) => [String(row.id), makeId(row.id, prefix)]));
}

function mapId(map, value) {
  return remapOptional(map, value);
}

async function putAll(tableName, rows) {
  if (rows.length > 0) await labLiteDb[tableName].bulkPut(rows);
}

export async function stageLabBundle(lab, { sourceCanonPackId = '', fallbackCanonPack = null } = {}) {
  if (!lab || typeof lab !== 'object') return null;
  const normalized = { ...lab };
  for (const table of LAB_TABLES) {
    if (!Array.isArray(normalized[table])) normalized[table] = [];
  }
  if (fallbackCanonPack && !normalized.canonPacks.some((pack) => String(pack.id) === String(fallbackCanonPack.id))) {
    normalized.canonPacks.push(fallbackCanonPack);
  }

  const maps = {
    corpus: makeMap(normalized.corpuses, 'corpus-import'),
    chapter: makeMap(normalized.chapters, 'lab-chapter-import'),
    scout: makeMap(normalized.scoutResults, 'scout-import'),
    arc: makeMap(normalized.arcs, 'lab-arc-import'),
    run: makeMap(normalized.deepAnalysisRuns, 'deep-run-import'),
    item: makeMap(normalized.deepAnalysisItems, 'deep-item-import'),
    canonPack: makeMap(normalized.canonPacks, 'canon-pack-import'),
    materialization: makeMap(normalized.materializationPlans, 'materialization-import'),
    canonReview: makeMap(normalized.canonReviewItems, 'canon-review-import'),
    cache: makeMap(normalized.analysisCache, 'analysis-cache-import'),
    ingestBatch: makeMap(normalized.ingestBatches, 'ingest-import'),
    mergePlan: makeMap(normalized.canonPackMergePlans, 'merge-import'),
    coverage: makeMap(normalized.chapterCoverage, 'coverage-import'),
  };
  const stagingProjectId = `story-bundle-staging-${makeId('', 'project')}`;
  const stagedIds = Object.fromEntries(LAB_TABLES.map((table) => [table, []]));

  const rows = {
    corpuses: normalized.corpuses.map((row) => ({ ...row, id: mapId(maps.corpus, row.id), projectId: stagingProjectId })),
    chapters: normalized.chapters.map((row) => ({ ...row, id: mapId(maps.chapter, row.id), corpusId: mapId(maps.corpus, row.corpusId) })),
    scoutResults: normalized.scoutResults.map((row) => ({ ...row, id: mapId(maps.scout, row.id), corpusId: mapId(maps.corpus, row.corpusId) })),
    arcs: normalized.arcs.map((row) => ({ ...row, id: mapId(maps.arc, row.id), corpusId: mapId(maps.corpus, row.corpusId) })),
    deepAnalysisRuns: normalized.deepAnalysisRuns.map((row) => ({ ...row, id: mapId(maps.run, row.id), corpusId: mapId(maps.corpus, row.corpusId) })),
    deepAnalysisItems: normalized.deepAnalysisItems.map((row) => ({
      ...row,
      id: mapId(maps.item, row.id),
      corpusId: mapId(maps.corpus, row.corpusId),
      runId: mapId(maps.run, row.runId),
      targetId: mapId(maps.chapter, row.targetId) || mapId(maps.arc, row.targetId) || row.targetId,
    })),
    canonPacks: normalized.canonPacks.map((row) => ({
      ...row,
      id: mapId(maps.canonPack, row.id),
      corpusId: mapId(maps.corpus, row.corpusId),
      projectId: stagingProjectId,
      linkedProjectId: stagingProjectId,
    })),
    ingestBatches: normalized.ingestBatches.map((row) => ({
      ...row,
      id: mapId(maps.ingestBatch, row.id),
      corpusId: mapId(maps.corpus, row.corpusId),
      canonPackId: mapId(maps.canonPack, row.canonPackId),
      projectId: stagingProjectId,
    })),
    canonPackMergePlans: normalized.canonPackMergePlans.map((row) => ({
      ...row,
      id: mapId(maps.mergePlan, row.id),
      canonPackId: mapId(maps.canonPack, row.canonPackId),
      incomingCanonPackId: mapId(maps.canonPack, row.incomingCanonPackId),
      ingestBatchId: mapId(maps.ingestBatch, row.ingestBatchId),
    })),
    materializationPlans: normalized.materializationPlans.map((row) => ({
      ...row,
      id: mapId(maps.materialization, row.id),
      canonPackId: mapId(maps.canonPack, row.canonPackId),
      projectId: stagingProjectId,
    })),
    canonReviewItems: normalized.canonReviewItems.map((row) => ({
      ...row,
      id: mapId(maps.canonReview, row.id),
      canonPackId: mapId(maps.canonPack, row.canonPackId),
      projectId: stagingProjectId,
      chapterId: null,
      sceneId: null,
    })),
    analysisCache: normalized.analysisCache.map((row) => ({
      ...row,
      id: mapId(maps.cache, row.id),
      corpusId: mapId(maps.corpus, row.corpusId),
      chapterId: mapId(maps.chapter, row.chapterId),
    })),
    chapterCoverage: normalized.chapterCoverage.map((row) => ({
      ...row,
      id: mapId(maps.coverage, row.id),
      corpusId: mapId(maps.corpus, row.corpusId),
    })),
  };
  for (const table of LAB_TABLES) stagedIds[table] = rows[table].map((row) => row.id).filter(Boolean);

  await labLiteDb.transaction('rw', ...LAB_TABLES.map((table) => labLiteDb[table]), async () => {
    for (const table of LAB_TABLES) await putAll(table, rows[table]);
  });

  const cleanup = async () => {
    await labLiteDb.transaction('rw', ...LAB_TABLES.map((table) => labLiteDb[table]), async () => {
      for (const table of [...LAB_TABLES].reverse()) {
        if (stagedIds[table].length > 0) await labLiteDb[table].bulkDelete(stagedIds[table]);
      }
    });
  };

  const finalize = async (projectId, projectMaps) => {
    const normalizedProjectId = String(projectId);
    await labLiteDb.transaction(
      'rw',
      labLiteDb.corpuses,
      labLiteDb.canonPacks,
      labLiteDb.ingestBatches,
      labLiteDb.materializationPlans,
      labLiteDb.canonReviewItems,
      async () => {
        await Promise.all(rows.corpuses.map((row) => labLiteDb.corpuses.update(row.id, { projectId: normalizedProjectId })));
        await Promise.all(rows.canonPacks.map((row) => labLiteDb.canonPacks.update(row.id, {
          projectId: normalizedProjectId,
          linkedProjectId: normalizedProjectId,
          updatedAt: Date.now(),
        })));
        await Promise.all(rows.ingestBatches.map((row) => labLiteDb.ingestBatches.update(row.id, { projectId: normalizedProjectId })));
        await Promise.all(rows.materializationPlans.map((row) => labLiteDb.materializationPlans.update(row.id, { projectId: normalizedProjectId })));
        await Promise.all(normalized.canonReviewItems.map((sourceRow, index) => {
          const stagedRow = rows.canonReviewItems[index];
          return labLiteDb.canonReviewItems.update(stagedRow.id, {
            projectId: normalizedProjectId,
            chapterId: projectMaps ? mapId(projectMaps.chapter, sourceRow.chapterId) : null,
            sceneId: projectMaps ? mapId(projectMaps.scene, sourceRow.sceneId) : null,
          });
        }));
      },
    );
  };

  return {
    canonPackId: mapId(maps.canonPack, sourceCanonPackId),
    cleanup,
    finalize,
  };
}

export default { stageLabBundle };
