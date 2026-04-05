import { EventEmitter } from 'node:events';
import {
  ANALYSIS_JOB_TYPES,
  JOB_CONFIG,
  JOB_PRIORITY,
  JOB_STATUS,
  JOB_TYPES,
  NO_RETRY_ERRORS,
  RETRY_ON_ERRORS,
} from './config.js';
import {
  assignJobToWorker,
  countQueuedAndRunningJobs,
  createJobRecord,
  getJobById,
  getRunningJobStats,
  listJobs,
  listRunnablePendingJobs,
  updateJobRecord,
  upsertJobStep,
} from './db/queries.js';
import { initJobSchema } from './db/schema.js';
import { processCorpusAnalysisJob } from './jobTypes/corpusAnalysis.js';
import { processCoherenceJob } from './jobTypes/coherenceJob.js';
import { processFileParsingJob } from './jobTypes/fileParsing.js';
import { processIncidentAnalysisJob } from './jobTypes/incidentAnalysisJob.js';
import { JobWorker } from './workers/index.js';

const TERMINAL_STATUSES = new Set([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED,
]);

function clampProgress(progress) {
  const parsed = Number(progress);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizePriority(priorityInput) {
  if (Number.isFinite(priorityInput)) {
    return Math.max(0, Math.min(3, Number(priorityInput)));
  }

  if (typeof priorityInput === 'string') {
    const key = priorityInput.trim().toUpperCase();
    if (key in JOB_PRIORITY) {
      return JOB_PRIORITY[key];
    }
  }

  return JOB_PRIORITY.NORMAL;
}

class JobQueue extends EventEmitter {
  constructor() {
    super();

    this.handlers = new Map([
      [JOB_TYPES.CORPUS_ANALYSIS, processCorpusAnalysisJob],
      [JOB_TYPES.FILE_PARSING, processFileParsingJob],
      [JOB_TYPES.INCIDENT_ANALYSIS, processIncidentAnalysisJob],
      [JOB_TYPES.COHERENCE_PASS, processCoherenceJob],
    ]);
    this.workers = [];
    this.runningJobs = new Map();
    this.retryState = new Map();
    this.started = false;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.workers = [];

    for (let index = 0; index < JOB_CONFIG.MAX_CONCURRENT_JOBS; index += 1) {
      const worker = new JobWorker(`worker-${index + 1}`, this);
      this.workers.push(worker);
      worker.start();
    }
  }

  async stop() {
    this.started = false;
    await Promise.all(this.workers.map((worker) => worker.stop()));
    this.workers = [];
  }

  createJob({ type, inputData, dependsOn = [], priority }) {
    if (!Object.values(JOB_TYPES).includes(type)) {
      const error = new Error(`Unsupported job type: ${type}`);
      error.code = 'INVALID_INPUT';
      throw error;
    }

    if (countQueuedAndRunningJobs() >= JOB_CONFIG.MAX_QUEUE_SIZE) {
      const error = new Error('Job queue is full');
      error.code = 'QUEUE_FULL';
      throw error;
    }

    const job = createJobRecord({
      type,
      inputData,
      dependsOn,
      priority: normalizePriority(priority),
    });

    this.emitJobEvent(job.id, 'progress', {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage || 'Queued',
      createdAt: job.createdAt,
    });

    return job;
  }

  getJob(jobId) {
    return getJobById(jobId);
  }

  listJobs(filters = {}) {
    return listJobs(filters);
  }

  cancelJob(jobId) {
    const job = getJobById(jobId);

    if (!job) {
      return null;
    }

    if (TERMINAL_STATUSES.has(job.status)) {
      return job;
    }

    const running = this.runningJobs.get(jobId);
    if (running?.abortController) {
      running.abortController.abort();
    }

    this.retryState.delete(jobId);

    const updated = updateJobRecord(jobId, {
      status: JOB_STATUS.CANCELLED,
      progressMessage: 'Job cancelled',
      completedAt: Date.now(),
      workerId: null,
    });

    this.emitJobEvent(jobId, 'cancelled', {
      id: jobId,
      status: JOB_STATUS.CANCELLED,
      progress: updated?.progress ?? job.progress,
      progressMessage: 'Job cancelled',
    });

    return updated;
  }

  claimNextJob(workerId) {
    if (!this.started) {
      return null;
    }

    const { runningCount, runningAnalysisCount } = getRunningJobStats();
    if (runningCount >= JOB_CONFIG.MAX_CONCURRENT_JOBS) {
      return null;
    }

    const pendingJobs = listRunnablePendingJobs(JOB_CONFIG.MAX_QUEUE_SIZE);
    const now = Date.now();

    for (const candidate of pendingJobs) {
      const retryInfo = this.retryState.get(candidate.id);

      if (retryInfo && retryInfo.nextAttemptAt > now) {
        continue;
      }

      if (
        ANALYSIS_JOB_TYPES.includes(candidate.type)
        && runningAnalysisCount >= JOB_CONFIG.MAX_CONCURRENT_ANALYSIS
      ) {
        continue;
      }

      const claimedJob = assignJobToWorker(candidate.id, workerId);
      if (!claimedJob) {
        continue;
      }

      this.emitJobEvent(claimedJob.id, 'progress', {
        id: claimedJob.id,
        status: JOB_STATUS.RUNNING,
        progress: claimedJob.progress,
        progressMessage: claimedJob.progressMessage || 'Job started',
        workerId,
      });

      return claimedJob;
    }

    return null;
  }

  getHandler(jobType) {
    return this.handlers.get(jobType);
  }

  getRetryAttempt(jobId) {
    return this.retryState.get(jobId)?.attempts ?? 0;
  }

  registerRunningJob(jobId, workerId, abortController) {
    this.runningJobs.set(jobId, {
      workerId,
      abortController,
    });
  }

  clearRunningJob(jobId) {
    this.runningJobs.delete(jobId);
  }

  handleProgressUpdate(jobId, progress, message, meta = {}) {
    const nextProgress = clampProgress(progress);

    updateJobRecord(jobId, {
      status: JOB_STATUS.RUNNING,
      progress: nextProgress,
      progressMessage: message,
    });

    if (meta.step?.name) {
      upsertJobStep({
        jobId,
        stepName: meta.step.name,
        status: meta.step.status || 'running',
        progress: meta.step.progress ?? 0,
        message: meta.step.message || message || null,
      });
    }

    const eventName = meta.event || 'progress';

    this.emitJobEvent(jobId, eventName, {
      id: jobId,
      status: JOB_STATUS.RUNNING,
      progress: nextProgress,
      progressMessage: message,
      message,
      step: meta.step || null,
    });
  }

  handleJobSuccess(jobId, outputData) {
    this.retryState.delete(jobId);

    const updated = updateJobRecord(jobId, {
      status: JOB_STATUS.COMPLETED,
      progress: 100,
      progressMessage: 'Job completed',
      outputData,
      errorMessage: null,
      errorStack: null,
      completedAt: Date.now(),
      workerId: null,
    });

    this.emitJobEvent(jobId, 'complete', {
      id: jobId,
      status: JOB_STATUS.COMPLETED,
      progress: 100,
      progressMessage: updated?.progressMessage || 'Job completed',
      outputData,
    });

    return updated;
  }

  handleJobError(job, error) {
    const currentJob = getJobById(job.id);
    if (!currentJob) {
      return null;
    }

    if (
      error?.code === 'JOB_CANCELLED' ||
      currentJob.status === JOB_STATUS.CANCELLED
    ) {
      this.retryState.delete(job.id);

      const cancelled = currentJob.status === JOB_STATUS.CANCELLED
        ? currentJob
        : updateJobRecord(job.id, {
          status: JOB_STATUS.CANCELLED,
          progressMessage: 'Job cancelled',
          completedAt: Date.now(),
          workerId: null,
        });

      this.emitJobEvent(job.id, 'cancelled', {
        id: job.id,
        status: JOB_STATUS.CANCELLED,
        progress: cancelled?.progress ?? currentJob.progress,
        progressMessage: 'Job cancelled',
      });

      return cancelled;
    }

    const previousState = this.retryState.get(job.id) || {
      attempts: 0,
      nextAttemptAt: 0,
    };
    const nextAttempt = previousState.attempts + 1;
    const canRetry =
      this.isRetryableError(error) && nextAttempt <= JOB_CONFIG.MAX_RETRIES;

    if (canRetry) {
      const delay =
        JOB_CONFIG.RETRY_DELAYS[
          Math.min(nextAttempt - 1, JOB_CONFIG.RETRY_DELAYS.length - 1)
        ];

      this.retryState.set(job.id, {
        attempts: nextAttempt,
        nextAttemptAt: Date.now() + delay,
      });

      const pending = updateJobRecord(job.id, {
        status: JOB_STATUS.PENDING,
        workerId: null,
        errorMessage: error?.message || 'Unknown processing error',
        errorStack: error?.stack || null,
        progressMessage: `Retrying in ${Math.round(delay / 1000)}s (${nextAttempt}/${JOB_CONFIG.MAX_RETRIES})`,
      });

      this.emitJobEvent(job.id, 'error', {
        id: job.id,
        status: pending?.status || JOB_STATUS.PENDING,
        message: error?.message || 'Unknown processing error',
        stack: error?.stack || null,
        retrying: true,
        attempt: nextAttempt,
        delay,
      });

      return pending;
    }

    this.retryState.delete(job.id);

    const failed = updateJobRecord(job.id, {
      status: JOB_STATUS.FAILED,
      workerId: null,
      completedAt: Date.now(),
      errorMessage: error?.message || 'Unknown processing error',
      errorStack: error?.stack || null,
      progressMessage: error?.message || 'Job failed',
    });

    this.emitJobEvent(job.id, 'error', {
      id: job.id,
      status: JOB_STATUS.FAILED,
      message: error?.message || 'Unknown processing error',
      stack: error?.stack || null,
      retrying: false,
      attempt: nextAttempt,
    });

    return failed;
  }

  isRetryableError(error) {
    const code = error?.code;

    if (!code) {
      return false;
    }

    if (NO_RETRY_ERRORS.includes(code)) {
      return false;
    }

    return RETRY_ON_ERRORS.includes(code);
  }

  emitJobEvent(jobId, event, data) {
    this.emit('job_event', {
      jobId,
      event,
      data: {
        ...data,
        type: event,
        timestamp: Date.now(),
      },
    });
  }
}

let queueInstance = null;

export function getJobQueue() {
  if (queueInstance) {
    return queueInstance;
  }

  initJobSchema();
  queueInstance = new JobQueue();
  return queueInstance;
}
