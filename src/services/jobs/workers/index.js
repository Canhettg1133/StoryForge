function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JobWorker {
  constructor(workerId, queue) {
    this.workerId = workerId;
    this.queue = queue;
    this.isProcessing = false;
    this.currentJob = null;
    this.abortController = null;
    this.keepRunning = false;
    this.loopPromise = null;
  }

  start() {
    if (this.keepRunning) {
      return;
    }

    this.keepRunning = true;
    this.loopPromise = this.runLoop();
  }

  async stop() {
    this.keepRunning = false;

    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  async runLoop() {
    while (this.keepRunning) {
      const job = await this.queue.claimNextJob(this.workerId);

      if (!job) {
        await sleep(1000);
        continue;
      }

      await this.processJob(job);
    }
  }

  async processJob(job) {
    this.isProcessing = true;
    this.currentJob = job.id;
    this.abortController = new AbortController();

    this.queue.registerRunningJob(
      job.id,
      this.workerId,
      this.abortController,
    );

    try {
      const handler = this.queue.getHandler(job.type);

      if (!handler) {
        const error = new Error(`Unsupported job type: ${job.type}`);
        error.code = 'INVALID_INPUT';
        throw error;
      }

      const attempt = this.queue.getRetryAttempt(job.id);

      const outputData = await handler(
        job,
        (progress, message, meta) =>
          this.queue.handleProgressUpdate(job.id, progress, message, meta),
        {
          signal: this.abortController.signal,
          attempt,
        },
      );

      if (this.abortController.signal.aborted) {
        const cancelledError = new Error('Job cancelled');
        cancelledError.code = 'JOB_CANCELLED';
        throw cancelledError;
      }

      await this.queue.handleJobSuccess(job.id, outputData);
    } catch (error) {
      await this.queue.handleJobError(job, error);
    } finally {
      this.queue.clearRunningJob(job.id);
      this.isProcessing = false;
      this.currentJob = null;
      this.abortController = null;
    }
  }
}
