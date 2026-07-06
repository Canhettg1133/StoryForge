import React from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  RefreshCw,
  X,
} from 'lucide-react';

export function Badge({ tone = 'neutral', children }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <ClipboardList size={22} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="button button--ghost" onClick={onRetry}>
          <RefreshCw size={15} />
          Tải lại
        </button>
      ) : null}
    </div>
  );
}

export function ConfirmDialog({ pending, onCancel, onConfirm }) {
  if (!pending) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header>
          <AlertTriangle size={20} />
          <h2 id="confirm-title">{pending.title}</h2>
        </header>
        <p>{pending.message}</p>
        <footer>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            <X size={16} />
            Hủy
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            <Check size={16} />
            Xác nhận
          </button>
        </footer>
      </div>
    </div>
  );
}

export function Metric({ label, value, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`metric metric--${tone}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
