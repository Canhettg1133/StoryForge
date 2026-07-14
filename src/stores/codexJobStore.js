import { create } from 'zustand';
import db from '../services/db/database.js';
import {
  CODEX_JOB_TYPE,
  resumeCodexExtractionJobs,
  retryCodexExtractionJob,
} from '../services/codex/codexExtractionJobs.js';

const resumedProjectIds = new Set();
let latestLoadRequest = 0;

const useCodexJobStore = create((set, get) => ({
  jobs: [],
  loading: false,
  errorCode: '',

  loadJobs: async (projectId) => {
    if (!projectId) return [];
    const requestId = ++latestLoadRequest;
    set({ loading: true, errorCode: '' });
    try {
      if (!resumedProjectIds.has(projectId)) {
        await resumeCodexExtractionJobs(projectId);
        resumedProjectIds.add(projectId);
      }
      const jobs = await db.aiJobs.where('project_id').equals(projectId)
        .filter((job) => job.job_type === CODEX_JOB_TYPE)
        .toArray();
      jobs.sort((left, right) => Number(right.id) - Number(left.id));
      if (requestId === latestLoadRequest) set({ jobs, loading: false, errorCode: '' });
      return jobs;
    } catch {
      if (requestId === latestLoadRequest) {
        set({
          jobs: [],
          loading: false,
          errorCode: 'CODEX_JOB_STORE_UNAVAILABLE',
        });
      }
      return [];
    }
  },

  retryJob: async (jobId) => {
    try {
      const job = await retryCodexExtractionJob(jobId);
      if (job?.project_id) await get().loadJobs(job.project_id);
      return job;
    } catch {
      set({ errorCode: 'CODEX_JOB_STORE_UNAVAILABLE' });
      return null;
    }
  },

  getLatestForChapter: (chapterId) => (
    get().jobs.find((job) => job.chapter_id === chapterId) || null
  ),
}));

export default useCodexJobStore;
