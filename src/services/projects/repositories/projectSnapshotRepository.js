import { randomUUID } from 'node:crypto';
import { bootstrapPostgres } from '../../storage/postgres/bootstrap.js';
import {
  requirePostgresDatabase,
  queryPostgres,
} from '../../storage/postgres/client.js';
import {
  pgGetProjectAnalysisSnapshot,
  pgListProjectAnalysisSnapshots,
} from '../../storage/postgres/read.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function summarizeAnalysisResult(result) {
  const raw = safeJson(result, result || {});
  const l2 = raw?.events || raw?.resultL2 || {};
  const knowledge = raw?.knowledge || {};
  const majorEvents = toArray(l2?.majorEvents || l2?.major || l2?.major_events);
  const minorEvents = toArray(l2?.minorEvents || l2?.minor || l2?.minor_events);
  const twists = toArray(l2?.plotTwists || l2?.twists || l2?.plot_twists);
  const cliffhangers = toArray(l2?.cliffhangers || l2?.cliffhanger || l2?.cliff_hangers);
  return {
    totalEvents: majorEvents.length + minorEvents.length + twists.length + cliffhangers.length,
    majorEvents: majorEvents.length,
    minorEvents: minorEvents.length,
    twists: twists.length,
    cliffhangers: cliffhangers.length,
    incidents: toArray(raw?.incidents || raw?.incidentClusters).length,
    locations: toArray(knowledge?.locations || raw?.locations || raw?.worldbuilding?.locations).length,
    characters: toArray(knowledge?.characters || raw?.characters?.profiles || raw?.structural?.characters).length,
    objects: toArray(knowledge?.objects || raw?.objects || raw?.worldbuilding?.objects).length,
    terms: toArray(knowledge?.terms || raw?.terms || raw?.worldTerms || raw?.worldbuilding?.terms).length,
  };
}

export const projectSnapshotRepository = {
  async listByProject(projectId, limit = 30) {
    requirePostgresDatabase('Project snapshot storage');
    await bootstrapPostgres();
    return pgListProjectAnalysisSnapshots(projectId, limit);
  },

  async saveSnapshot({
    projectId,
    corpusId,
    analysisId,
    status = 'completed',
    layers = [],
    result = null,
    artifactVersion = 'v2',
  } = {}) {
    requirePostgresDatabase('Project snapshot storage');
    if (!projectId || !analysisId) {
      throw new Error('projectId and analysisId are required.');
    }

    await bootstrapPostgres();
    const existing = await pgGetProjectAnalysisSnapshot(projectId, analysisId);
    const now = Date.now();
    const recordId = existing?.id || randomUUID();
    const summary = summarizeAnalysisResult(result);

    await queryPostgres(`
      INSERT INTO project_analysis_snapshots (
        id, project_id, corpus_id, analysis_id, status, layers, result_json,
        summary, artifact_version, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      ON CONFLICT (project_id, analysis_id) DO UPDATE SET
        corpus_id = EXCLUDED.corpus_id,
        status = EXCLUDED.status,
        layers = EXCLUDED.layers,
        result_json = EXCLUDED.result_json,
        summary = EXCLUDED.summary,
        artifact_version = EXCLUDED.artifact_version,
        updated_at = EXCLUDED.updated_at
    `, [
      recordId,
      String(projectId),
      corpusId || null,
      String(analysisId),
      status || 'completed',
      Array.isArray(layers) ? layers : [],
      result,
      summary,
      artifactVersion || 'v2',
      existing?.created_at || now,
      now,
    ]);

    return {
      snapshotId: recordId,
      summary,
      materialized: null,
      sourceOfTruth: 'postgres',
    };
  },
};

export default projectSnapshotRepository;
