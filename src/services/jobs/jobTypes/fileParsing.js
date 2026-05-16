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
  { name: 'read_file', label: 'Đọc file', weight: 35, durationMs: 400 },
  { name: 'tokenize_content', label: 'Tách nội dung', weight: 35, durationMs: 500 },
  { name: 'build_document_model', label: 'Dựng mô hình tài liệu', weight: 30, durationMs: 500 },
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

    await onProgress(completedWeight, `Bắt đầu: ${step.label}`, {
      step: {
        name: step.name,
        status: 'running',
        progress: 0,
        message: `Bắt đầu: ${step.label}`,
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
    parseComplete: true,
    summary: 'Tách file phase 1 đã hoàn tất.',
    source: job.inputData?.filePath || null,
    generatedAt: Date.now(),
  };
}
