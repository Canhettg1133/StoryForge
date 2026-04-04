import React, { useMemo } from 'react';
import { useJobStore } from '../../stores/jobStore';
import './JobQueuePanel.css';

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return 'just now';
  }

  const elapsed = Date.now() - Number(timestamp);
  const minutes = Math.max(1, Math.round(elapsed / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function JobCard({ job, queueIndex, onCancel }) {
  const isRunning = job.status === 'running';
  const isPending = job.status === 'pending';

  return (
    <article className="job-queue-card">
      <header className="job-queue-card__header">
        <strong>{job.type === 'corpus_analysis' ? 'Analyzing' : 'Parsing'}</strong>
        <span className={`job-queue-status job-queue-status--${job.status}`}>
          {job.status}
        </span>
      </header>

      <p className="job-queue-card__title">{job.inputData?.title || job.id}</p>

      {isRunning ? (
        <>
          <div className="job-queue-progress">
            <div
              className="job-queue-progress__fill"
              style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }}
            />
          </div>
          <p className="job-queue-card__meta">
            {job.progressMessage || 'Processing...'} ({job.progress || 0}%)
          </p>
        </>
      ) : null}

      {isPending ? (
        <p className="job-queue-card__meta">
          Waiting in queue ({queueIndex + 1})
        </p>
      ) : null}

      {(isRunning || isPending) && (
        <button
          type="button"
          className="job-queue-card__cancel"
          onClick={() => onCancel(job.id)}
        >
          Cancel
        </button>
      )}
    </article>
  );
}

export default function JobQueuePanel() {
  const jobs = useJobStore((state) => state.jobs);
  const activeJobs = useJobStore((state) => state.activeJobs);
  const jobHistory = useJobStore((state) => state.jobHistory);
  const cancelJob = useJobStore((state) => state.cancelJob);
  const clearPanel = useJobStore((state) => state.clearPanel);
  const hydrateJobsFromIndexedDB = useJobStore(
    (state) => state.hydrateJobsFromIndexedDB,
  );
  const resumeActiveSubscriptions = useJobStore(
    (state) => state.resumeActiveSubscriptions,
  );

  React.useEffect(() => {
    hydrateJobsFromIndexedDB()
      .then(() => resumeActiveSubscriptions())
      .catch(() => {});

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, [hydrateJobsFromIndexedDB, resumeActiveSubscriptions]);

  const activeJobData = useMemo(
    () => activeJobs.map((id) => jobs[id]).filter(Boolean),
    [activeJobs, jobs],
  );

  const historyData = useMemo(
    () =>
      jobHistory
        .map((id) => jobs[id])
        .filter(Boolean)
        .slice(0, 5),
    [jobHistory, jobs],
  );

  const shouldShowPanel = activeJobData.length > 0 || historyData.length > 0;

  if (!shouldShowPanel) {
    return null;
  }

  return (
    <aside className="job-queue-panel glass">
      <header className="job-queue-panel__header">
        <h3>Job Queue</h3>
        <button type="button" onClick={() => clearPanel().catch(() => {})}>
          Clear
        </button>
      </header>

      <section className="job-queue-panel__section">
        {activeJobData.length === 0 ? (
          <p className="job-queue-empty">No active jobs.</p>
        ) : (
          activeJobData.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              queueIndex={index}
              onCancel={cancelJob}
            />
          ))
        )}
      </section>

      <section className="job-queue-panel__section">
        <h4>Completed (Recent)</h4>
        {historyData.length === 0 ? (
          <p className="job-queue-empty">No completed jobs yet.</p>
        ) : (
          <ul className="job-queue-history">
            {historyData.map((job) => (
              <li key={job.id}>
                <span>{job.inputData?.title || job.id}</span>
                <small>{formatRelativeTime(job.completedAt || job.updatedAt)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
