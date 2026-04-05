import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_CONFIG,
  JOB_STATUS,
  JOB_TYPES,
} from '../../services/jobs/config.js';
import { processCoherenceJob } from '../../services/jobs/jobTypes/coherenceJob.js';
import { processCorpusAnalysisJob } from '../../services/jobs/jobTypes/corpusAnalysis.js';
import { processFileParsingJob } from '../../services/jobs/jobTypes/fileParsing.js';
import { processIncidentAnalysisJob } from '../../services/jobs/jobTypes/incidentAnalysisJob.js';

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
    expect(JOB_TYPES.INCIDENT_ANALYSIS).toBe('incident_analysis');
    expect(JOB_TYPES.COHERENCE_PASS).toBe('coherence_pass');

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

  it('runs incident analysis job and returns incident-first payload', async () => {
    const onProgress = vi.fn();
    const result = await processIncidentAnalysisJob(
      {
        id: 'job-incident',
        inputData: {
          corpusId: 'corpus-incident-1',
          mode: 'balanced',
          incidents: [
            {
              id: 'inc-1',
              title: 'Incident test',
              startChapter: 1,
              endChapter: 1,
              confidence: 0.9,
            },
          ],
          events: [
            {
              id: 'evt-1',
              description: 'Event for incident test',
              chapterIndex: 1,
              incidentId: 'inc-1',
              severity: 0.8,
              evidence: ['sample'],
            },
          ],
          locations: [
            {
              id: 'loc-1',
              name: 'Test Location',
              incidentIds: ['inc-1'],
              eventIds: ['evt-1'],
              evidence: ['sample'],
            },
          ],
        },
      },
      onProgress,
      { attempt: 1 },
    );

    expect(result.incidentAnalysisComplete).toBe(true);
    expect(result.corpusId).toBe('corpus-incident-1');
    expect(Array.isArray(result.incidents)).toBe(true);
    expect(onProgress).toHaveBeenCalled();
  });

  it('runs coherence pass job with merge/split output metadata', async () => {
    const onProgress = vi.fn();
    const result = await processCoherenceJob(
      {
        id: 'job-coherence',
        inputData: {
          mode: 'balanced',
          incidents: [
            {
              id: 'inc-1',
              title: 'Incident A',
              startChapter: 1,
              endChapter: 2,
              confidence: 0.85,
            },
            {
              id: 'inc-2',
              title: 'Incident A duplicate',
              startChapter: 2,
              endChapter: 3,
              confidence: 0.8,
            },
          ],
          events: [
            { id: 'evt-1', incidentId: 'inc-1', chapterIndex: 1, severity: 0.7 },
            { id: 'evt-2', incidentId: 'inc-2', chapterIndex: 2, severity: 0.7 },
          ],
          locations: [
            { id: 'loc-1', name: 'School' },
          ],
        },
      },
      onProgress,
      {},
    );

    expect(result.coherenceComplete).toBe(true);
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.incidents)).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(
      100,
      expect.stringContaining('completed'),
      expect.objectContaining({
        event: 'step_complete',
      }),
    );
  });
});
