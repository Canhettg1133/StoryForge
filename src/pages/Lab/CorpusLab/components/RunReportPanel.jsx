import React, { useMemo, useState } from 'react';

function formatTimestamp(value) {
  if (!value) return 'Chưa có';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'Không hợp lệ';
  return date.toLocaleString('vi-VN');
}

function prettyStatus(status) {
  const normalized = String(status || '').replace(/_/g, ' ').trim();
  return normalized || 'chưa rõ';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function RunReportPanel({
  artifactVersion,
  manifest,
  passStatus,
  degradedReport,
}) {
  const [expanded, setExpanded] = useState(false);
  const passEntries = useMemo(() => Object.values(passStatus || {}), [passStatus]);
  const degradedItems = Array.isArray(degradedReport?.items) ? degradedReport.items : [];
  const repairedCount = passEntries.filter((item) => item?.repaired).length;
  const retryCount = passEntries.reduce((sum, item) => sum + toNumber(item?.retries, 0), 0);
  const validationFailureCount = passEntries.reduce((sum, item) => {
    const metrics = item?.metrics || {};
    return sum + toNumber(
      metrics.validationFailures
      ?? metrics.validationFailed
      ?? metrics.validation_errors
      ?? 0,
      0,
    );
  }, 0);

  if (!manifest && passEntries.length === 0 && degradedItems.length === 0) {
    return null;
  }

  return (
    <section className="run-report-panel">
      <div className="run-report-header">
        <div>
          <strong>Báo cáo run</strong>
          <span className="muted">
            {artifactVersion === 'v2' ? 'Artifact phân tích V2' : 'Artifact kế thừa'}
          </span>
        </div>
        <div className="run-report-meta">
          <span>Chế độ: {manifest?.runMode || 'chưa rõ'}</span>
          <span>Bắt đầu: {formatTimestamp(manifest?.startedAt)}</span>
          <span>Hoàn tất: {formatTimestamp(manifest?.completedAt)}</span>
          <span>Số lần thử lại: {retryCount}</span>
          <span>Đã repair schema: {repairedCount}</span>
          <span>Lỗi validate: {validationFailureCount}</span>
          <span>Mục degraded: {degradedItems.length}</span>
        </div>
      </div>

      <div className="run-report-actions">
        <button
          type="button"
          className="run-report-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Thu gọn báo cáo run' : 'Mở chi tiết báo cáo run'}
        </button>
      </div>

      {expanded && passEntries.length > 0 && (
        <div className="run-report-pass-grid">
          {passEntries.map((pass) => (
            <article key={pass.id} className={`run-report-pass ${pass.status || 'unknown'}`}>
              <header>
                <strong>{pass.title || pass.id}</strong>
                <span>{prettyStatus(pass.status)}</span>
              </header>
              <div className="run-report-pass-body">
                <span>Thử lại: {Number(pass.retries || 0)}</span>
                <span>Repair: {pass.repaired ? 'Có' : 'Không'}</span>
                {pass.metrics && Object.keys(pass.metrics).length > 0 && (
                  <span>
                    Chỉ số: {Object.entries(pass.metrics).map(([key, value]) => `${key}=${value}`).join(', ')}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {expanded && degradedItems.length > 0 && (
        <div className="run-report-degraded">
          <strong>Run bị degraded</strong>
          <ul>
            {degradedItems.map((item, index) => (
              <li key={`${item.passId || 'pass'}-${index}`}>
                [{item.passId || 'unknown'}] {item.reason || 'chưa rõ'}
                {item.fallback ? ` -> dùng fallback: ${item.fallback}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
