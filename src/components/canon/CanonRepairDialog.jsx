import React from 'react';
import { Copy, Loader2, Sparkles, X } from 'lucide-react';
import { getCanonReportTitle } from '../../services/canon/reportLabels';
import './CanonRepairDialog.css';

export default function CanonRepairDialog({
  open = false,
  preview = null,
  saving = false,
  onClose,
  onCopy,
  onSaveDraft,
}) {
  if (!open || !preview) return null;
  const reports = Array.isArray(preview.reports) && preview.reports.length > 0
    ? preview.reports
    : (preview.report ? [preview.report] : []);
  const isBulkRepair = !preview.reportId && reports.length > 1;

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
            <div className="canon-repair-dialog__state canon-repair-dialog__state--error">
              {preview.error}
            </div>
          )}

          {!preview.loading && !preview.error && (
            <>
              <textarea
                className="canon-repair-dialog__textarea"
                value={preview.text || ''}
                readOnly
                spellCheck={false}
              />
              <div className="modal-actions canon-repair-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={onCopy} disabled={!preview.text}>
                  <Copy size={16} />
                  Sao chép
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSaveDraft}
                  disabled={!preview.text || saving}
                >
                  {saving ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  Lưu thành bản nháp
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
