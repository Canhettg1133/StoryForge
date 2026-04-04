import React from 'react';

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

export default function AnalysisProgress({ analysis }) {
  if (!analysis) {
    return null;
  }

  const percent = toPercent(analysis.progress);
  const partsGenerated = Number(analysis.partsGenerated || 0);
  const sessionIndex = Number(analysis.sessionIndex || 0);
  const totalSessions = Number(analysis.totalSessions || 0);

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
