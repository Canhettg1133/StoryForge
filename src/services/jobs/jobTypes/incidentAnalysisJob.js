import { runIncidentAnalysisJob as runAnalysisJob } from '../../analysis/jobs/incidentAnalysisJob.js';

function throwIfCancelled(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('Job cancelled');
  error.code = 'JOB_CANCELLED';
  throw error;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

async function emitStep(onProgress, overall, message, stepName, stepProgress, event = null) {
  await onProgress(overall, message, {
    ...(event ? { event } : {}),
    step: {
      name: stepName,
      status: stepProgress >= 100 ? 'completed' : 'running',
      progress: Math.max(0, Math.min(100, Number(stepProgress) || 0)),
      message,
    },
  });
}

function normalizePayload(inputData = {}) {
  const payload = toObject(inputData.payload);
  return {
    chapters: toArray(payload.chapters || inputData.chapters),
    incidents: toArray(payload.incidents || inputData.incidents),
    events: toArray(payload.events || inputData.events),
    locations: toArray(payload.locations || inputData.locations),
    consistencyRisks: toArray(payload.consistencyRisks || inputData.consistencyRisks),
  };
}

export async function processIncidentAnalysisJob(
  job,
  onProgress,
  { signal, attempt = 0 } = {},
) {
  throwIfCancelled(signal);

  const inputData = toObject(job?.inputData);
  const corpusId = String(inputData.corpusId || '').trim();
  const analysisId = String(inputData.analysisId || '').trim() || null;

  if (!corpusId) {
    const error = new Error('Missing required inputData.corpusId');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  if (inputData?.simulateErrorCode) {
    const simulatedError = new Error(
      inputData?.simulateErrorMessage || 'Simulated incident analysis failure',
    );
    simulatedError.code = inputData.simulateErrorCode;
    throw simulatedError;
  }

  if (inputData?.failOnce === true && attempt === 0) {
    const transientError = new Error('Simulated transient failure');
    transientError.code = 'AI_SERVICE_UNAVAILABLE';
    throw transientError;
  }

  const mode = String(inputData.mode || inputData.runMode || 'balanced').toLowerCase();
  const payload = normalizePayload(inputData);

  await emitStep(onProgress, 5, 'Preparing incident-first analysis payload', 'prepare', 20);
  throwIfCancelled(signal);

  const result = await runAnalysisJob({
    corpusId,
    payload,
    options: {
      mode,
      analysisId,
      provider: inputData.provider,
      model: inputData.model,
      apiKey: inputData.apiKey,
      apiKeys: inputData.apiKeys,
      proxyUrl: inputData.proxyUrl,
      directUrl: inputData.directUrl,
      temperature: inputData.temperature,
      ai: toObject(inputData.ai),
      onProgress: async (state = {}) => {
        const phase = String(state.phase || 'processing');
        const progress = Math.max(0, Math.min(1, Number(state.progress) || 0));
        const overall = Math.max(6, Math.min(96, Math.round(6 + (progress * 90))));

        await emitStep(
          onProgress,
          overall,
          String(state.message || `Incident analysis: ${phase}`),
          phase,
          Math.round(progress * 100),
        );
      },
    },
    signal,
  });

  throwIfCancelled(signal);
  await emitStep(
    onProgress,
    100,
    'Incident-first analysis completed',
    'incident_analysis',
    100,
    'step_complete',
  );

  return {
    incidentAnalysisComplete: true,
    corpusId,
    analysisId,
    mode,
    generatedAt: Date.now(),
    ...result,
  };
}
