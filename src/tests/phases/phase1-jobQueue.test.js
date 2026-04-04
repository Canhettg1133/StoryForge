import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_CONFIG,
  JOB_STATUS,
  JOB_TYPES,
} from '../../services/jobs/config.js';
import { processCorpusAnalysisJob } from '../../services/jobs/jobTypes/corpusAnalysis.js';
import { processFileParsingJob } from '../../services/jobs/jobTypes/fileParsing.js';

describe('Phase 1 - Job Queue Core', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('exposes expected queue config and job types', () => {
    expect(JOB_CONFIG.MAX_CONCURRENT_JOBS).toBeGreaterThan(0);
    expect(JOB_CONFIG.MAX_QUEUE_SIZE).toBeGreaterThan(0);
    expect(JOB_CONFIG.MAX_RETRIES).toBeGreaterThan(0);

    expect(JOB_TYPES.CORPUS_ANALYSIS).toBe('corpus_analysis');
    expect(JOB_TYPES.FILE_PARSING).toBe('file_parsing');

    expect(JOB_STATUS.PENDING).toBe('pending');
    expect(JOB_STATUS.RUNNING).toBe('running');
    expect(JOB_STATUS.COMPLETED).toBe('completed');
  });

  it('runs corpus analysis worker and emits step progress', async () => {
    const onProgress = vi.fn();

    const run = processCorpusAnalysisJob(
      {
        id: 'job-1',
        inputData: { corpusId: 'corpus-1' },
      },
      onProgress,
      { attempt: 1 },
    );

    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.analysisComplete).toBe(true);
    expect(result.corpusId).toBe('corpus-1');

    const stepCompleteCalls = onProgress.mock.calls.filter(
      (call) => call?.[2]?.event === 'step_complete',
    );

    expect(stepCompleteCalls).toHaveLength(6);
    expect(onProgress).toHaveBeenCalledWith(
      100,
      expect.stringContaining('completed'),
      expect.objectContaining({
        event: 'step_complete',
        step: expect.objectContaining({
          status: 'completed',
          progress: 100,
        }),
      }),
    );
  });

  it('handles fail-once behavior based on attempt number', async () => {
    const job = {
      id: 'job-fail-once',
      inputData: { failOnce: true },
    };

    await expect(
      processCorpusAnalysisJob(job, vi.fn(), { attempt: 0 }),
    ).rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE' });

    const retry = processCorpusAnalysisJob(job, vi.fn(), { attempt: 1 });
    await vi.runAllTimersAsync();

    await expect(retry).resolves.toMatchObject({
      analysisComplete: true,
    });
  });

  it('supports cancellation via abort signal for both workers', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      processCorpusAnalysisJob(
        { id: 'job-cancel-analysis', inputData: {} },
        vi.fn(),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'JOB_CANCELLED' });

    await expect(
      processFileParsingJob(
        { id: 'job-cancel-parse', inputData: {} },
        vi.fn(),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'JOB_CANCELLED' });
  });

  it('runs file parsing worker and reports completion metadata', async () => {
    const onProgress = vi.fn();

    const run = processFileParsingJob(
      {
        id: 'job-parse',
        inputData: { filePath: 'demo.txt' },
      },
      onProgress,
    );

    await vi.runAllTimersAsync();
    const result = await run;

    expect(result.parseComplete).toBe(true);
    expect(result.source).toBe('demo.txt');

    const stepCompleteCalls = onProgress.mock.calls.filter(
      (call) => call?.[2]?.event === 'step_complete',
    );
    expect(stepCompleteCalls).toHaveLength(3);
  });
});