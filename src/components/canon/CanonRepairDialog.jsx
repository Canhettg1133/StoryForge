import React from 'react';
import { Copy, Loader2, Sparkles, X } from 'lucide-react';
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal canon-repair-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header canon-repair-dialog__header">
          <div>
            <div className="canon-repair-dialog__eyebrow">
              <Sparkles size={14} />
              Goi y sua
            </div>
            <h3 className="canon-repair-dialog__title">Ban sua de xuat cho report da chon</h3>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Dong goi y sua">
            <X size={16} />
          </button>
        </div>

        <div className="canon-repair-dialog__body">
          {preview.report && (
            <div className={`canon-repair-dialog__report canon-repair-dialog__report--${preview.report.severity || 'warning'}`}>
              <strong>{preview.report.rule_code || preview.report.severity || 'Bao cao'}</strong>
              <p>{preview.report.message}</p>
            </div>
          )}

          {preview.loading && (
            <div className="canon-repair-dialog__state">
              <Loader2 size={16} className="spin" />
              Dang tao goi y sua...
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
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSaveDraft}
                  disabled={!preview.text || saving}
                >
                  {saving ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  Luu thanh draft
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
