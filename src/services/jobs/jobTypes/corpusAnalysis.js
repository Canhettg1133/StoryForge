function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('Job đã bị hủy.');
  error.code = 'JOB_CANCELLED';
  throw error;
}

const STEPS = [
  { name: 'parse_chapters', label: 'Tách chương', weight: 15, durationMs: 500 },
  { name: 'extract_characters', label: 'Trích xuất nhân vật', weight: 20, durationMs: 700 },
  { name: 'extract_events', label: 'Trích xuất sự kiện', weight: 25, durationMs: 700 },
  { name: 'analyze_worldbuilding', label: 'Phân tích thế giới', weight: 20, durationMs: 700 },
  { name: 'analyze_relationships', label: 'Phân tích quan hệ', weight: 10, durationMs: 500 },
  { name: 'analyze_craft', label: 'Phân tích kỹ thuật viết', weight: 10, durationMs: 500 },
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

    await onProgress(completedWeight, `Bắt đầu: ${step.label}`, {
      step: {
        name: step.name,
        status: 'running',
        progress: 0,
        message: `Bắt đầu: ${step.label}`,
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

      await onProgress(overallProgress, `${step.label}: ${stepProgress}%`, {
        step: {
          name: step.name,
          status: 'running',
          progress: stepProgress,
          message: `${step.label}: ${stepProgress}%`,
        },
      });
    }

    completedWeight += step.weight;

    await onProgress(completedWeight, `${step.label} hoàn tất`, {
      event: 'step_complete',
      step: {
        name: step.name,
        status: 'completed',
        progress: 100,
        message: `${step.label} hoàn tất`,
      },
    });
  }

  return {
    analysisComplete: true,
    summary: 'Phân tích corpus phase 1 đã hoàn tất.',
    corpusId: job.inputData?.corpusId || null,
    generatedAt: Date.now(),
  };
}
