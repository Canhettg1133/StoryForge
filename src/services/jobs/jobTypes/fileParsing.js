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
  { name: 'read_file', weight: 35, durationMs: 400 },
  { name: 'tokenize_content', weight: 35, durationMs: 500 },
  { name: 'build_document_model', weight: 30, durationMs: 500 },
];

export async function processFileParsingJob(job, onProgress, { signal } = {}) {
  throwIfCancelled(signal);

  if (job.inputData?.simulateErrorCode) {
    const simulatedError = new Error(
      job.inputData?.simulateErrorMessage || 'Simulated file parsing failure',
    );
    simulatedError.code = job.inputData.simulateErrorCode;
    throw simulatedError;
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

    const ticks = 4;
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
    parseComplete: true,
    summary: 'Phase 1 placeholder file parsing completed.',
    source: job.inputData?.filePath || null,
    generatedAt: Date.now(),
  };
}

