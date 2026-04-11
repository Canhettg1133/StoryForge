import { create } from 'zustand';
import { jobsApi } from '../services/api/jobsApi';
import { JOB_CONFIG } from '../services/jobs/config';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['pending', 'running']);

function mergeSteps(existingSteps = [], stepPayload) {
  if (!stepPayload?.name) {
    return existingSteps;
  }

  const nextSteps = [...existingSteps];
  const index = nextSteps.findIndex((step) => step.name === stepPayload.name);

  if (index === -1) {
    nextSteps.push({
      name: stepPayload.name,
      status: stepPayload.status || 'pending',
      progress: stepPayload.progress ?? 0,
      message: stepPayload.message || null,
    });
    return nextSteps;
  }

  nextSteps[index] = {
    ...nextSteps[index],
    ...stepPayload,
  };
  return nextSteps;
}

function normalizeIncomingJob(existing, payload = {}) {
  const merged = {
    ...existing,
    ...payload,
    id: payload.id || existing?.id,
  };

  if (payload.message && !payload.progressMessage) {
    merged.progressMessage = payload.message;
  }

  if (payload.step) {
    merged.steps = mergeSteps(existing?.steps, payload.step);
  }

  if (!Array.isArray(merged.steps)) {
    merged.steps = [];
  }

  return merged;
}

function maybeNotifyBrowser(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

export const useJobStore = create(
  (set, get) => ({
    jobs: {},
    activeJobs: [],
    jobHistory: [],
    notifications: [],
    streams: {},
    reconnectTimers: {},

    hydrateJobsFromApi: async () => {
      const result = await jobsApi.list({ limit: 50 });
      const rows = Array.isArray(result?.jobs) ? result.jobs : [];

      set((state) => {
        const nextJobs = { ...state.jobs };
        const nextActiveJobs = [];
        const nextHistory = [];

        rows.forEach((job) => {
          const normalized = normalizeIncomingJob(state.jobs[job.id], job);
          nextJobs[job.id] = normalized;

          if (ACTIVE_STATUSES.has(normalized.status)) {
            nextActiveJobs.push(normalized.id);
          } else if (TERMINAL_STATUSES.has(normalized.status)) {
            nextHistory.push(normalized.id);
          }
        });

        return {
          jobs: nextJobs,
          activeJobs: nextActiveJobs,
          jobHistory: nextHistory.slice(0, 50),
        };
      });
    },

    resumeActiveSubscriptions: () => {
      const { activeJobs, subscribeToJob } = get();
      activeJobs.forEach((jobId) => subscribeToJob(jobId));
    },

    createJob: async (type, inputData, options = {}) => {
      const response = await jobsApi.create(type, inputData, options);
      const initialJob = {
        id: response.id,
        type,
        status: response.status,
        progress: 0,
        progressMessage: 'Queued',
        inputData,
        createdAt: response.createdAt,
        steps: [],
      };

      set((state) => ({
        jobs: {
          ...state.jobs,
          [response.id]: initialJob,
        },
        activeJobs: state.activeJobs.includes(response.id)
          ? state.activeJobs
          : [...state.activeJobs, response.id],
      }));

      get().subscribeToJob(response.id);

      return response;
    },

    trackExternalJob: (job) => {
      if (!job?.id) {
        return;
      }

      set((state) => ({
        jobs: {
          ...state.jobs,
          [job.id]: normalizeIncomingJob(state.jobs[job.id], {
            id: job.id,
            type: job.type,
            status: job.status || 'pending',
            progress: job.progress ?? 0,
            progressMessage: job.progressMessage || 'Queued',
            inputData: job.inputData || {},
            createdAt: job.createdAt || Date.now(),
          }),
        },
        activeJobs: state.activeJobs.includes(job.id)
          ? state.activeJobs
          : [...state.activeJobs, job.id],
      }));

      get().subscribeToJob(job.id);
    },

    subscribeToJob: (jobId) => {
      const currentStream = get().streams[jobId];
      if (currentStream) {
        return;
      }

      const reconnectTimer = get().reconnectTimers[jobId];
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        set((state) => ({
          reconnectTimers: {
            ...state.reconnectTimers,
            [jobId]: null,
          },
        }));
      }

      const eventSource = jobsApi.subscribeProgress(jobId);
      const trackEvent = (eventType) => {
        eventSource.addEventListener(eventType, (event) => {
          const data = JSON.parse(event.data);
          get().handleJobUpdate(jobId, {
            ...data,
            type: eventType,
          });
        });
      };

      trackEvent('snapshot');
      trackEvent('progress');
      trackEvent('step_complete');
      trackEvent('error');
      trackEvent('complete');
      trackEvent('cancelled');

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          get().handleJobUpdate(jobId, data);
        } catch {
          // Ignore non-JSON frames.
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        set((state) => {
          const nextStreams = { ...state.streams };
          delete nextStreams[jobId];

          return {
            streams: nextStreams,
          };
        });

        const job = get().jobs[jobId];
        if (job && !TERMINAL_STATUSES.has(job.status)) {
          const timeoutId = setTimeout(
            () => get().subscribeToJob(jobId),
            JOB_CONFIG.SSE_RECONNECT_DELAY,
          );
          set((state) => ({
            reconnectTimers: {
              ...state.reconnectTimers,
              [jobId]: timeoutId,
            },
          }));
        }
      };

      set((state) => ({
        streams: {
          ...state.streams,
          [jobId]: eventSource,
        },
      }));
    },

    unsubscribeFromJob: (jobId) => {
      const stream = get().streams[jobId];
      if (stream) {
        stream.close();
      }

      const timer = get().reconnectTimers[jobId];
      if (timer) {
        clearTimeout(timer);
      }

      set((state) => {
        const nextStreams = { ...state.streams };
        const nextTimers = { ...state.reconnectTimers };
        delete nextStreams[jobId];
        delete nextTimers[jobId];

        return {
          streams: nextStreams,
          reconnectTimers: nextTimers,
        };
      });
    },

    handleJobUpdate: (jobId, payload) => {
      let nextJob = null;

      set((state) => {
        const existing = state.jobs[jobId] || { id: jobId, steps: [] };
        nextJob = normalizeIncomingJob(existing, payload);

        const activeJobs = ACTIVE_STATUSES.has(nextJob.status)
          ? state.activeJobs.includes(jobId)
            ? state.activeJobs
            : [...state.activeJobs, jobId]
          : state.activeJobs.filter((id) => id !== jobId);

        return {
          jobs: {
            ...state.jobs,
            [jobId]: nextJob,
          },
          activeJobs,
        };
      });

      if (payload?.type === 'complete' || nextJob?.status === 'completed') {
        get().handleJobComplete(jobId);
        return;
      }

      if (payload?.type === 'cancelled' || nextJob?.status === 'cancelled') {
        get().handleJobCancelled(jobId);
        return;
      }

      if (payload?.type === 'error' && payload?.retrying === false) {
        get().handleJobFailed(jobId, payload.message);
      }
    },

    handleJobComplete: (jobId) => {
      const job = get().jobs[jobId];
      if (!job) {
        return;
      }

      get().unsubscribeFromJob(jobId);

      const notification = {
        id: `${jobId}-complete-${Date.now()}`,
        jobId,
        status: 'success',
        title: 'Job Complete',
        message: job.progressMessage || `${job.type} completed`,
        createdAt: Date.now(),
      };

      maybeNotifyBrowser(notification.title, notification.message);

      set((state) => ({
        activeJobs: state.activeJobs.filter((id) => id !== jobId),
        jobHistory: [jobId, ...state.jobHistory.filter((id) => id !== jobId)].slice(
          0,
          50,
        ),
        notifications: [notification, ...state.notifications].slice(0, 5),
      }));
    },

    handleJobCancelled: (jobId) => {
      get().unsubscribeFromJob(jobId);

      const notification = {
        id: `${jobId}-cancelled-${Date.now()}`,
        jobId,
        status: 'warning',
        title: 'Job Cancelled',
        message: 'Job was cancelled.',
        createdAt: Date.now(),
      };

      set((state) => ({
        activeJobs: state.activeJobs.filter((id) => id !== jobId),
        notifications: [notification, ...state.notifications].slice(0, 5),
      }));
    },

    handleJobFailed: (jobId, message) => {
      get().unsubscribeFromJob(jobId);

      const notification = {
        id: `${jobId}-failed-${Date.now()}`,
        jobId,
        status: 'error',
        title: 'Job Failed',
        message: message || 'Job failed.',
        createdAt: Date.now(),
      };

      set((state) => ({
        activeJobs: state.activeJobs.filter((id) => id !== jobId),
        notifications: [notification, ...state.notifications].slice(0, 5),
      }));
    },

    cancelJob: async (jobId) => {
      await jobsApi.cancel(jobId);
      get().handleJobUpdate(jobId, {
        id: jobId,
        status: 'cancelled',
        progressMessage: 'Job cancelled',
        type: 'cancelled',
      });
    },

    dismissNotification: (notificationId) =>
      set((state) => ({
        notifications: state.notifications.filter(
          (notification) => notification.id !== notificationId,
        ),
      })),

    clearHistory: () => set({ jobHistory: [] }),

    clearPanel: async () => {
      const { jobs, activeJobs, jobHistory } = get();
      const activeSet = new Set(activeJobs);
      const idsToRemove = new Set(jobHistory);

      Object.values(jobs).forEach((job) => {
        if (!job?.id) {
          return;
        }

        if (activeSet.has(job.id)) {
          return;
        }

        if (TERMINAL_STATUSES.has(job.status)) {
          idsToRemove.add(job.id);
        }
      });

      set((state) => {
        const nextJobs = { ...state.jobs };
        idsToRemove.forEach((id) => {
          delete nextJobs[id];
        });

        return {
          jobs: nextJobs,
          jobHistory: [],
          notifications: [],
        };
      });
    },
  }),
);
