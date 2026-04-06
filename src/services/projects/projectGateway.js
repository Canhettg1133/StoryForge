import { corpusApi } from '../api/corpusApi.js';

function dedupeSnapshots(items = []) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.analysis_id || item?.analysisId || item?.id || '').trim();
    if (!key) continue;
    const currentTime = Number(item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || 0);
    const existing = map.get(key);
    const existingTime = Number(existing?.updated_at || existing?.updatedAt || existing?.created_at || existing?.createdAt || 0);
    if (!existing || currentTime >= existingTime) {
      map.set(key, item);
    }
  }
  return [...map.values()].sort((a, b) => {
    const left = Number(b?.updated_at || b?.updatedAt || b?.created_at || b?.createdAt || 0);
    const right = Number(a?.updated_at || a?.updatedAt || a?.created_at || a?.createdAt || 0);
    return left - right;
  });
}

export async function getProjectAnalysisSnapshots(projectId, limit = 30) {
  const response = await corpusApi.listProjectAnalysisSnapshots(projectId, { limit });
  if (!Array.isArray(response?.items)) {
    return [];
  }
  return dedupeSnapshots(response.items).slice(0, limit);
}

export async function saveAnalysisSnapshotToProject(payload) {
  return corpusApi.saveProjectAnalysisSnapshot(payload.projectId, {
    corpusId: payload.corpusId,
    analysisId: payload.analysisId,
    status: payload.status,
    layers: payload.layers,
    result: payload.result,
    artifactVersion: payload.result?.artifact_version || payload.result?.artifactVersion || 'v2',
  });
}

export default {
  getProjectAnalysisSnapshots,
  saveAnalysisSnapshotToProject,
};
