import React from 'react';

const PHASE_LABELS = {
  idle: 'Sẵn sàng',
  preparing: 'Đang chuẩn bị dữ liệu',
  splitting: 'Đang tạo chunk mới',
  completed: 'Đã hoàn tất',
  failed: 'Đã thất bại',
};

export default function RechunkProgress({ progress, loading }) {
  if (!loading && (!progress || progress.phase === 'idle')) {
    return null;
  }

  const progressValue = Math.max(0, Math.min(100, Math.round((progress?.value || 0) * 100)));
  const phase = progress?.phase || 'idle';

  return (
    <div className="rechunk-progress">
      <div className="rechunk-progress-header">
        <span>{PHASE_LABELS[phase] || PHASE_LABELS.idle}</span>
        <span>{progressValue}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${progressValue}%` }} />
      </div>
    </div>
  );
}
