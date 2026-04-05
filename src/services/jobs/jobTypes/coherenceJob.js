import { runCoherenceJob } from '../../analysis/jobs/coherenceJob.js';

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

function emitStep(onProgress, overall, message, stepName, stepProgress, event = null) {
  onProgress(overall, message, {
    ...(event ? { event } : {}),
    step: {
      name: stepName,
      status: stepProgress >= 100 ? 'completed' : 'running',
      progress: Math.max(0, Math.min(100, Number(stepProgress) || 0)),
      message,
    },
  });
}

export async function processCoherenceJob(job, onProgress, { signal } = {}) {
  throwIfCancelled(signal);

  const inputData = toObject(job?.inputData);
  const incidents = toArray(inputData.incidents);
  const events = toArray(inputData.events);
  const locations = toArray(inputData.locations);
  const mode = String(inputData.mode || 'balanced').toLowerCase();

  if (!incidents.length && !events.length) {
    const error = new Error('Missing coherence input: incidents/events are empty.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  if (inputData?.simulateErrorCode) {
    const simulatedError = new Error(
      inputData?.simulateErrorMessage || 'Simulated coherence pass failure',
    );
    simulatedError.code = inputData.simulateErrorCode;
    throw simulatedError;
  }

  emitStep(onProgress, 10, 'Preparing coherence pass input', 'prepare', 40);
  throwIfCancelled(signal);

  emitStep(onProgress, 35, 'Running merge/split coherence rules', 'coherence', 30);
  const result = await runCoherenceJob({
    incidents,
    events,
    locations,
    options: {
      mode,
      provider: inputData.provider,
      model: inputData.model,
      apiKey: inputData.apiKey,
      apiKeys: inputData.apiKeys,
      proxyUrl: inputData.proxyUrl,
      directUrl: inputData.directUrl,
      temperature: inputData.temperature,
      ai: toObject(inputData.ai),
    },
    signal,
  });

  throwIfCancelled(signal);
  emitStep(onProgress, 75, 'Rebuilding normalized links', 'normalize', 85);

  const merged = Number(result?.changes?.merged || 0);
  const splitSuggestions = Number(result?.changes?.splitSuggestions || 0);
  const normalizedLocations = Number(result?.changes?.normalizedLocations || 0);

  emitStep(
    onProgress,
    100,
    'Coherence pass completed',
    'coherence_pass',
    100,
    'step_complete',
  );

  return {
    coherenceComplete: true,
    mode,
    generatedAt: Date.now(),
    summary: {
      merged,
      splitSuggestions,
      normalizedLocations,
    },
    ...result,
  };
}
