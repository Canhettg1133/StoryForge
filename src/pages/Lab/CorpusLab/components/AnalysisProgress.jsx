import React, { useEffect, useState } from 'react';

const STATUS_LABELS = {
  pending: 'Đang chờ',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

function toPercent(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function prettyPhase(phase) {
  const normalized = String(phase || '').replace(/_/g, ' ').trim();
  if (!normalized) {
    return 'đang xử lý';
  }
  return normalized;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDuration(durationMs) {
  const safeMs = Math.max(0, Number(durationMs) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}g ${String(minutes).padStart(2, '0')}p ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}p ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export default function AnalysisProgress({ analysis }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const isActive = ['pending', 'processing'].includes(String(analysis?.status || '').toLowerCase());
    if (!isActive) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [analysis?.status]);

  if (!analysis) {
    return null;
  }

  const percent = toPercent(analysis.progress);
  const partsGenerated = Number(analysis.partsGenerated || 0);
  const sessionIndex = Number(analysis.sessionIndex || 0);
  const totalSessions = Number(analysis.totalSessions || 0);
  const passStatus = analysis.passStatus || analysis.result?.pass_status || {};
  const runningPass = Object.values(passStatus).find((item) => item?.status === 'running');
  const degradedPasses = Object.values(passStatus).filter((item) => item?.status === 'degraded').length;
  const retryCount = Object.values(passStatus).reduce((sum, item) => sum + toNumber(item?.retries, 0), 0);
  const validationFailures = Object.values(passStatus).reduce((sum, item) => {
    const metrics = item?.metrics || {};
    return sum + toNumber(
      metrics.validationFailures
      ?? metrics.validationFailed
      ?? metrics.validation_errors
      ?? 0,
      0,
    );
  }, 0);
  const startedAt = toNumber(analysis.startedAt || analysis.createdAt, 0);
  const completedAt = toNumber(analysis.completedAt, 0);
  const elapsedMs = startedAt > 0
    ? Math.max(0, (completedAt || now) - startedAt)
    : 0;

  return (
    <div className="analysis-progress">
      <div className="analysis-progress-header">
        <strong>Trạng thái: {STATUS_LABELS[analysis.status] || analysis.status}</strong>
        <span>{percent}%</span>
      </div>

      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${percent}%` }} />
      </div>

      <div className="analysis-progress-meta">
        <span>Giai đoạn: {prettyPhase(analysis.currentPhase)}</span>
        <span>Đã chạy: {formatDuration(elapsedMs)}</span>
        <span>Số phần output: {partsGenerated}</span>
        {sessionIndex > 0 && totalSessions > 0 && (
          <span>
            Session đang chạy: {sessionIndex}/{totalSessions}
          </span>
        )}
        {analysis.processedChunks != null && analysis.totalChunks != null && (
          <span>
            Chunk đã xử lý: {analysis.processedChunks}/{analysis.totalChunks}
          </span>
        )}
        {runningPass && (
          <span>Pass dang chay: {runningPass.title || runningPass.id}</span>
        )}
        {Object.keys(passStatus).length > 0 && (
          <span>Pass degraded: {degradedPasses}</span>
        )}
        {retryCount > 0 && (
          <span>Retry: {retryCount}</span>
        )}
        {validationFailures > 0 && (
          <span>Validation fail: {validationFailures}</span>
        )}
      </div>

      {analysis.progressMessage && (
        <p className="muted">{analysis.progressMessage}</p>
      )}

      {analysis.errorMessage && (
        <p className="corpus-error">{analysis.errorMessage}</p>
      )}
    </div>
  );
}
