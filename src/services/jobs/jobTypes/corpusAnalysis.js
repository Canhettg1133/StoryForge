function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('Job cancelled');
  error.code = 'JOB_CANCELLED';
  throw error;
}

const STEPS = [
  { name: 'parse_chapters', weight: 15, durationMs: 500 },
  { name: 'extract_characters', weight: 20, durationMs: 700 },
  { name: 'extract_events', weight: 25, durationMs: 700 },
  { name: 'analyze_worldbuilding', weight: 20, durationMs: 700 },
  { name: 'analyze_relationships', weight: 10, durationMs: 500 },
  { name: 'analyze_craft', weight: 10, durationMs: 500 },
];

export async function processCorpusAnalysisJob(
  job,
  onProgress,
  { signal, attempt = 0 } = {},
) {
  throwIfCancelled(signal);

  if (job.inputData?.simulateErrorCode) {
    const simulatedError = new Error(
      job.inputData?.simulateErrorMessage || 'Simulated corpus analysis failure',
    );
    simulatedError.code = job.inputData.simulateErrorCode;
    throw simulatedError;
  }

  if (job.inputData?.failOnce === true && attempt === 0) {
    const transientError = new Error('Simulated transient failure');
    transientError.code = 'AI_SERVICE_UNAVAILABLE';
    throw transientError;
  }

  let completedWeight = 0;

  for (const step of STEPS) {
    throwIfCancelled(signal);

    onProgress(completedWeight, `Starting ${step.name}`, {
      step: {
        name: step.name,
        status: 'running',
        progress: 0,
        message: `Starting ${step.name}`,
      },
    });

    const ticks = 5;
    for (let tick = 1; tick <= ticks; tick += 1) {
      await sleep(step.durationMs / ticks);
      throwIfCancelled(signal);

      const stepProgress = Math.round((tick / ticks) * 100);
      const overallProgress = Math.min(
        99,
        Math.round(completedWeight + (step.weight * stepProgress) / 100),
      );

      onProgress(overallProgress, `${step.name}: ${stepProgress}%`, {
        step: {
          name: step.name,
          status: 'running',
          progress: stepProgress,
          message: `${step.name}: ${stepProgress}%`,
        },
      });
    }

    completedWeight += step.weight;

    onProgress(completedWeight, `${step.name} completed`, {
      event: 'step_complete',
      step: {
        name: step.name,
        status: 'completed',
        progress: 100,
        message: `${step.name} completed`,
      },
    });
  }

  return {
    analysisComplete: true,
    summary: 'Phase 1 placeholder corpus analysis completed.',
    corpusId: job.inputData?.corpusId || null,
    generatedAt: Date.now(),
  };
}

