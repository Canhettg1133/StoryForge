import React from 'react';

function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function formatDuration(preview) {
  if (!preview) {
    return '--';
  }

  if (preview.estimatedMinutes < 60) {
    return `~${preview.estimatedMinutes} phút`;
  }

  return `~${preview.estimatedHours} giờ`;
}

export default function ChunkPreview({ preview, loading }) {
  if (loading && !preview) {
    return (
      <div className="chunk-preview">
        <h4>Xem trước cấu hình</h4>
        <p className="muted">Đang tính toán...</p>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  return (
    <div className="chunk-preview">
      <h4>Xem trước cấu hình</h4>
      <div className="chunk-preview-grid">
        <div className="chunk-stat">
          <span className="label">Corpus</span>
          <strong>{formatNumber(preview.corpusWordCount)} từ</strong>
        </div>
        <div className="chunk-stat highlight">
          <span className="label">Số chunk mới</span>
          <strong>{formatNumber(preview.newChunkCount)}</strong>
        </div>
        <div className="chunk-stat">
          <span className="label">Tổng output</span>
          <strong>{formatNumber(preview.totalOutputs)}</strong>
        </div>
        <div className="chunk-stat highlight">
          <span className="label">Thời gian ước tính</span>
          <strong>{formatDuration(preview)}</strong>
        </div>
      </div>

      <div className="chunk-preview-meta">
        <span>Token output/chunk: khoảng {formatNumber(preview.outputTokens)}</span>
        <span>Số phần/chunk: {formatNumber(preview.partsPerChunk)}</span>
      </div>
    </div>
  );
}
