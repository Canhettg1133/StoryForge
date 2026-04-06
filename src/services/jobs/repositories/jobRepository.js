import {
  pgCountQueuedAndRunningJobs,
  pgGetJobById,
  pgGetRunningJobStats,
  pgListJobs,
  pgListRunnablePendingJobs,
} from '../../storage/postgres/read.js';
import {
  pgAssignJobToWorker,
  pgCreateJobRecord,
  pgResetRunningJobs,
  pgUpdateJobRecord,
  pgUpsertJobStep,
} from '../../storage/postgres/write.js';

export const jobRepository = {
  async createJob(payload) {
    return pgCreateJobRecord(payload);
  },

  async getJobByIdAsync(jobId) {
    return pgGetJobById(jobId);
  },

  async listJobsAsync(filters = {}) {
    return pgListJobs(filters);
  },

  async updateJob(jobId, updates = {}) {
    return pgUpdateJobRecord(jobId, updates);
  },

  async upsertJobStep(payload) {
    await pgUpsertJobStep(payload);
  },

  async listRunnablePendingJobs(limit = 100) {
    return pgListRunnablePendingJobs(limit);
  },

  async assignJobToWorker(jobId, workerId) {
    return pgAssignJobToWorker(jobId, workerId);
  },

  async getRunningJobStats() {
    return pgGetRunningJobStats();
  },

  async countQueuedAndRunningJobs() {
    return pgCountQueuedAndRunningJobs();
  },

  async recoverInterruptedJobs() {
    await pgResetRunningJobs();
  },
};
