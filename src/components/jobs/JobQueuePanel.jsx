import React, { useEffect, useMemo, useState } from 'react';
import { useJobStore } from '../../stores/jobStore';
import './JobQueuePanel.css';

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return 'vừa xong';
  }

  const elapsed = Date.now() - Number(timestamp);
  const minutes = Math.max(1, Math.round(elapsed / 60000));
  if (minutes < 60) {
    return `${minutes} phút trước`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours} giờ trước`;
}

function getJobLabel(job) {
  if (job.type === 'corpus_analysis') return 'Phân tích kho truyện';
  if (job.type === 'incident_analysis') return 'Phân tích sự kiện lớn';
  if (job.type === 'coherence_pass') return 'Pass mạch truyện';
  if (job.type === 'scoped_rerun') return 'Chạy lại theo scope';
  if (job.type === 'analysis_window') return 'Xử lý cửa sổ';
  if (job.type === 'incident_reducer') return 'Gộp sự kiện lớn';
  if (job.type === 'incident_worker') return 'Phân tích chi tiết sự kiện lớn';
  if (job.type === 'character_canonicalizer') return 'Chuẩn hóa nhân vật';
  if (job.type === 'world_canonicalizer') return 'Chuẩn hóa thế giới';
  if (job.type === 'graph_projection') return 'Dựng đồ thị';
  if (job.type === 'review_intelligence') return 'Suy luận review';
  if (job.type === 'file_parsing') return 'Tách file';
  return job.type || 'Tác vụ';
}

function getStatusLabel(status) {
  if (status === 'running') return 'đang chạy';
  if (status === 'pending') return 'đang chờ';
  if (status === 'completed') return 'hoàn tất';
  if (status === 'failed') return 'thất bại';
  if (status === 'cancelled') return 'đã hủy';
  return status || 'chưa rõ';
}

function JobCard({ job, queueIndex, onCancel }) {
  const isRunning = job.status === 'running';
  const isPending = job.status === 'pending';
  const activeSteps = Array.isArray(job.steps)
    ? job.steps.filter((step) => step.status === 'running' || step.status === 'completed').slice(-2)
    : [];

  return (
    <article className="job-queue-card">
      <header className="job-queue-card__header">
        <strong>{getJobLabel(job)}</strong>
        <span className={`job-queue-status job-queue-status--${job.status}`}>
          {getStatusLabel(job.status)}
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
            {job.progressMessage || 'Đang xử lý...'} ({job.progress || 0}%)
          </p>
        </>
      ) : null}

      {isPending ? (
        <p className="job-queue-card__meta">
          Đang chờ trong hàng ({queueIndex + 1})
        </p>
      ) : null}

      {activeSteps.length > 0 ? (
        <div className="job-queue-card__meta">
          {activeSteps.map((step) => (
            <div key={`${job.id}-${step.name}`}>
              {step.name}: {step.message || `${step.progress || 0}%`}
            </div>
          ))}
        </div>
      ) : null}

      {(isRunning || isPending) && (
        <button
          type="button"
          className="job-queue-card__cancel"
          onClick={() => onCancel(job.id)}
        >
          Hủy
        </button>
      )}
    </article>
  );
}

export default function JobQueuePanel() {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const jobs = useJobStore((state) => state.jobs);
  const activeJobs = useJobStore((state) => state.activeJobs);
  const jobHistory = useJobStore((state) => state.jobHistory);
  const cancelJob = useJobStore((state) => state.cancelJob);
  const clearPanel = useJobStore((state) => state.clearPanel);
  const hydrateJobsFromApi = useJobStore((state) => state.hydrateJobsFromApi);
  const resumeActiveSubscriptions = useJobStore((state) => state.resumeActiveSubscriptions);

  useEffect(() => {
    hydrateJobsFromApi()
      .then(() => resumeActiveSubscriptions())
      .catch(() => {});

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, [hydrateJobsFromApi, resumeActiveSubscriptions]);

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

  const hasActiveJobs = activeJobData.length > 0;
  const hasHistory = historyData.length > 0;

  useEffect(() => {
    if (hasActiveJobs) {
      setHistoryExpanded(true);
    }
  }, [hasActiveJobs]);

  if (!hasActiveJobs && !hasHistory) {
    return null;
  }

  if (!hasActiveJobs && hasHistory && !historyExpanded) {
    return (
      <button
        type="button"
        className="job-queue-launcher glass"
        onClick={() => setHistoryExpanded(true)}
      >
        <strong>Job gần đây</strong>
        <span>{historyData.length} mục</span>
      </button>
    );
  }

  return (
    <aside className="job-queue-panel glass">
      <header className="job-queue-panel__header">
        <h3>Hàng đợi job</h3>
        <div className="job-queue-panel__actions">
          {!hasActiveJobs && hasHistory && (
            <button type="button" onClick={() => setHistoryExpanded(false)}>
              Thu gọn
            </button>
          )}
          <button type="button" onClick={() => clearPanel().catch(() => {})}>
            Xóa
          </button>
        </div>
      </header>

      <section className="job-queue-panel__section">
        {hasActiveJobs ? (
          activeJobData.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              queueIndex={index}
              onCancel={cancelJob}
            />
          ))
        ) : (
          <p className="job-queue-empty">Không có job đang chạy.</p>
        )}
      </section>

      <section className="job-queue-panel__section">
        <h4>Đã xong gần đây</h4>
        {hasHistory ? (
          <ul className="job-queue-history">
            {historyData.map((job) => (
              <li key={job.id}>
                <span>{job.inputData?.title || job.id}</span>
                <small>{formatRelativeTime(job.completedAt || job.updatedAt)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="job-queue-empty">Chưa có job nào hoàn tất.</p>
        )}
      </section>
    </aside>
  );
}
