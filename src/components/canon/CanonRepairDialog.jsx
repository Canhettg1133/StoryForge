import React from 'react';
import { Copy, Loader2, Sparkles, X } from 'lucide-react';
import { getCanonReportTitle } from '../../services/canon/reportLabels';
import './CanonRepairDialog.css';

export default function CanonRepairDialog({
  open = false,
  preview = null,
  saving = false,
  outcome = null,
  onClose,
  onRetry,
  onCopy,
  onSaveDraft,
}) {
  if (!open || !preview) return null;
  const reports = Array.isArray(preview.reports) && preview.reports.length > 0
    ? preview.reports
    : (preview.report ? [preview.report] : []);
  const isBulkRepair = !preview.reportId && reports.length > 1;
  const isSaved = Boolean(preview.savedRevisionId);
  const outcomeTone = outcome?.ok
    ? 'success'
    : outcome?.kind === 'blocked'
      ? 'warning'
      : 'error';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal canon-repair-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header canon-repair-dialog__header">
          <div>
            <div className="canon-repair-dialog__eyebrow">
              <Sparkles size={14} />
              Gợi ý sửa
            </div>
            <h3 className="canon-repair-dialog__title">
              {isBulkRepair ? 'Bản sửa đề xuất cho tất cả lỗi canon' : 'Bản sửa đề xuất cho báo cáo đã chọn'}
            </h3>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Đóng gợi ý sửa">
            <X size={16} />
          </button>
        </div>

        <div className="canon-repair-dialog__body">
          {reports.length > 0 && (
            <div className="canon-repair-dialog__reports">
              {reports.map((report) => (
                <div
                  key={report.id || `${report.rule_code}-${report.message}`}
                  className={`canon-repair-dialog__report canon-repair-dialog__report--${report.severity || 'warning'}`}
                >
                  <strong>{getCanonReportTitle(report)}</strong>
                  <p>{report.message}</p>
                </div>
              ))}
            </div>
          )}

          {preview.loading && (
            <div className="canon-repair-dialog__state">
              <Loader2 size={16} className="spin" />
              Đang tạo gợi ý sửa...
            </div>
          )}

          {!preview.loading && preview.error && (
            <>
              <div className="canon-repair-dialog__state canon-repair-dialog__state--error" role="alert">
                {preview.error}
              </div>
              <div className="modal-actions canon-repair-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Đóng
                </button>
                {onRetry && (
                  <button type="button" className="btn btn-primary" onClick={onRetry}>
                    <Sparkles size={16} />
                    Thử lại
                  </button>
                )}
              </div>
            </>
          )}

          {!preview.loading && !preview.error && (
            <>
              <textarea
                className="canon-repair-dialog__textarea"
                value={preview.text || ''}
                readOnly
                spellCheck={false}
              />
              <p className="canon-repair-dialog__draft-note">
                Bản nháp được lưu thành một phiên bản mới trong lịch sử canon; thao tác này không thay nội dung chương đang mở trong trình soạn thảo và chưa biến nó thành canon chính thức.
              </p>
              {outcome?.message && (
                <div
                  className={`canon-repair-dialog__outcome canon-repair-dialog__outcome--${outcomeTone}`}
                  role="status"
                  aria-live="polite"
                >
                  {outcome.message}
                </div>
              )}
              <div className="modal-actions canon-repair-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={onCopy} disabled={!preview.text}>
                  <Copy size={16} />
                  Sao chép
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSaveDraft}
                  disabled={!preview.text || saving || isSaved}
                >
                  {saving ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  {isSaved ? 'Đã lưu bản nháp' : 'Lưu thành bản nháp'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
