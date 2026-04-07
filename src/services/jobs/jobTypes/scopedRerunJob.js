import { analysisRepository } from '../../analysis/repositories/analysisRepository.js';
import { executeScopedRerun } from '../../analysis/v3/scopedRerun.js';

function throwIfCancelled(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('Job cancelled');
  error.code = 'JOB_CANCELLED';
  throw error;
}

function resolveKeyCount(inputData = {}) {
  const values = [
    ...(Array.isArray(inputData.apiKeys) ? inputData.apiKeys : []),
    inputData.apiKey,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Math.max(1, new Set(values).size || 1);
}

export async function processScopedRerunJob(
  job,
  onProgress,
  { signal } = {},
) {
  throwIfCancelled(signal);

  const inputData = job.inputData || {};
  const corpusId = String(inputData.corpusId || '').trim();
  const analysisId = String(inputData.analysisId || '').trim();

  if (!corpusId || !analysisId) {
    const error = new Error('Scoped rerun requires corpusId and analysisId.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const [analysis, artifact] = await Promise.all([
    analysisRepository.getAnalysisByIdAsync(analysisId),
    analysisRepository.getAnalysisArtifactByAnalysisAsync(analysisId),
  ]);

  if (!analysis || analysis.corpusId !== corpusId) {
    const error = new Error('Analysis not found for scoped rerun.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  if (!artifact) {
    const error = new Error('Artifact V3 is required before scoped rerun can execute.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  await onProgress(5, 'Scoped rerun queued', {
    step: {
      name: 'load_scope',
      status: 'running',
      progress: 10,
      message: 'Loading analysis artifact for scoped rerun',
    },
  });

  const result = await executeScopedRerun({
    corpusId,
    analysisId,
    analysis,
    artifact,
    phase: inputData.phase || 'incident',
    windowIds: inputData.windowIds || [],
    incidentIds: inputData.incidentIds || [],
    canonicalizerKinds: inputData.canonicalizerKinds || [],
    reason: inputData.reason || null,
    keyCount: resolveKeyCount(inputData),
    signal,
    onProgress,
  });

  return {
    rerunComplete: true,
    ...result,
  };
}

export default {
  processScopedRerunJob,
};
