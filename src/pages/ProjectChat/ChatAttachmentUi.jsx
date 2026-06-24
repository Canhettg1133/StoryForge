import React from 'react';
import {
  BookOpen,
  FileText,
  Loader2,
  MessageCircle,
  Trash2,
  X,
} from 'lucide-react';
import { CHAT_ATTACHMENT_STATUSES } from '../../services/chatAttachments/fileSafety.js';

export const CHAT_ATTACHMENT_COPY = Object.freeze([
  'Thêm tệp',
  'Xem tệp trong chat',
  'Tệp trong chat',
  'Đọc kỹ',
  'Đọc kỹ toàn bộ',
  'Đọc lại toàn bộ',
  'Đọc lại từ đầu',
  'Hỏi thử về file',
  'Xóa',
  'Chỉ gửi lượt này',
  'Đã lập chỉ mục',
  'Đã đọc kỹ',
  'Đang đọc',
  'Không thể đọc tệp',
]);

export function formatAttachmentSize(bytes = 0) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${Math.max(0, size)} B`;
}

export function getAttachmentStatusLabel(status = '') {
  switch (status) {
    case CHAT_ATTACHMENT_STATUSES.VALIDATING:
      return 'Đang kiểm tra';
    case CHAT_ATTACHMENT_STATUSES.EXTRACTING:
      return 'Đang trích xuất';
    case CHAT_ATTACHMENT_STATUSES.INDEXED:
      return 'Đã lập chỉ mục';
    case CHAT_ATTACHMENT_STATUSES.READING:
      return 'Đang đọc kỹ';
    case CHAT_ATTACHMENT_STATUSES.READY:
      return 'Đã đọc kỹ';
    case CHAT_ATTACHMENT_STATUSES.FAILED:
      return 'Không thể đọc tệp';
    default:
      return 'Đang chờ';
  }
}

function isBusy(status = '') {
  return status === CHAT_ATTACHMENT_STATUSES.VALIDATING
    || status === CHAT_ATTACHMENT_STATUSES.EXTRACTING
    || status === CHAT_ATTACHMENT_STATUSES.READING;
}

function isExtracting(status = '') {
  return status === CHAT_ATTACHMENT_STATUSES.VALIDATING
    || status === CHAT_ATTACHMENT_STATUSES.EXTRACTING;
}

function canStartFullRead(status = '') {
  return status === CHAT_ATTACHMENT_STATUSES.INDEXED
    || status === CHAT_ATTACHMENT_STATUSES.READY
    || status === CHAT_ATTACHMENT_STATUSES.READING;
}

function getFullReadActionLabel(status = '') {
  if (status === CHAT_ATTACHMENT_STATUSES.READY) return 'Đọc lại toàn bộ';
  if (status === CHAT_ATTACHMENT_STATUSES.READING) return 'Đọc lại từ đầu';
  return 'Đọc kỹ toàn bộ';
}

export function ChatAttachmentChips({
  attachments = [],
  onReadFull,
  onRemove,
  compact = false,
  disabled = false,
}) {
  const items = (attachments || []).filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div className={`project-chat-attachments ${compact ? 'is-compact' : ''}`}>
      {items.map((attachment) => (
        <div
          key={attachment.id || attachment.temp_id || attachment.file_name}
          className={`project-chat-attachment-chip ${attachment.status === CHAT_ATTACHMENT_STATUSES.FAILED ? 'is-error' : ''}`}
          title={attachment.error_message || attachment.file_name}
        >
          <FileText size={15} />
          <span className="project-chat-attachment-chip__name">
            {attachment.file_name || attachment.fileName || 'Tệp đính kèm'}
          </span>
          <span className="project-chat-attachment-chip__meta">
            {attachment.file_type || attachment.fileType || 'file'} · {formatAttachmentSize(attachment.size_bytes || attachment.sizeBytes)}
          </span>
          <span className="project-chat-attachment-chip__status">
            {isBusy(attachment.status) ? <Loader2 size={12} className="project-chat-attachment-spin" /> : null}
            {getAttachmentStatusLabel(attachment.status)}
            {attachment.turn_only ? ' · Chỉ lượt này' : ''}
          </span>
          {!compact && onReadFull && canStartFullRead(attachment.status) ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm project-chat-attachment-chip__read"
              onClick={() => onReadFull(attachment)}
              disabled={disabled}
              title={getFullReadActionLabel(attachment.status)}
            >
              <BookOpen size={13} />
              {attachment.status === CHAT_ATTACHMENT_STATUSES.READY ? 'Đọc lại' : 'Đọc kỹ'}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm project-chat-attachment-chip__remove"
              onClick={() => onRemove(attachment)}
              disabled={disabled || isExtracting(attachment.status)}
              title="Gỡ tệp"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ChatAttachmentReadingStatus({ job = null } = {}) {
  if (!job) return null;

  const total = Math.max(1, Number(job.totalChunks || 1));
  const current = Math.min(total, Math.max(0, Number(job.currentChunk || 0)));
  const isMerging = job.phase === 'merging';

  return (
    <div className="project-chat-reading-status" role="status" aria-live="polite">
      <Loader2 size={16} className="project-chat-attachment-spin" />
      <div>
        <strong>{isMerging ? 'Đang lập hồ sơ tệp' : 'Đang đọc kỹ toàn bộ tệp'}</strong>
        <span>
          {job.fileName || 'Tệp đính kèm'} · {isMerging ? 'Đang tổng hợp' : `${current}/${total} đoạn`}
        </span>
      </div>
    </div>
  );
}

export function ChatAttachmentDrawer({
  open = false,
  attachments = [],
  onClose,
  onReadFull,
  onAskSample,
  onRemove,
  disabled = false,
}) {
  if (!open) return null;
  const items = (attachments || []).filter(Boolean);

  return (
    <>
      <button
        type="button"
        className="project-chat-drawer-backdrop"
        onClick={onClose}
        aria-label="Đóng tệp trong chat"
      />
      <aside className="project-chat-drawer project-chat-attachment-drawer">
        <div className="project-chat-drawer__header">
          <div>
            <div className="project-chat-drawer__kicker">Tệp trong chat</div>
            <h3>Quản lý tệp của cuộc chat</h3>
            <p>
              Các tệp ở đây đã được trích xuất thành đoạn để AI dùng khi trả lời.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="project-chat-attachment-list">
          {items.length === 0 ? (
            <div className="project-chat-attachment-empty">
              <FileText size={24} />
              <span>Chưa có tệp nào trong cuộc chat này.</span>
            </div>
          ) : items.map((attachment) => {
            const readDisabled = disabled || !canStartFullRead(attachment.status);
            const askDisabled = disabled || attachment.status === CHAT_ATTACHMENT_STATUSES.FAILED;
            const removeDisabled = disabled || isExtracting(attachment.status);
            const readTitle = disabled
              ? 'Đang có thao tác khác, hãy chờ hoàn tất'
              : readDisabled
                ? 'Tệp chưa sẵn sàng để đọc kỹ'
                : getFullReadActionLabel(attachment.status);
            const removeTitle = disabled
              ? 'Đang có thao tác khác, hãy chờ hoàn tất rồi xóa'
              : removeDisabled
                ? 'Tệp đang trích xuất, hãy chờ hoàn tất rồi xóa'
                : 'Xóa tệp';
            return (
              <article key={attachment.id} className="project-chat-attachment-row">
                <div className="project-chat-attachment-row__icon">
                  <FileText size={18} />
                </div>
                <div className="project-chat-attachment-row__main">
                  <strong>{attachment.file_name}</strong>
                  <span>
                    {(attachment.file_type || 'file').toUpperCase()} · {formatAttachmentSize(attachment.size_bytes)} · {Number(attachment.chunk_count || 0)} đoạn
                    {attachment.turn_only ? ' · Chỉ lượt này' : ''}
                  </span>
                  <span className={`project-chat-attachment-row__status ${isBusy(attachment.status) ? 'is-busy' : ''}`}>
                    {isBusy(attachment.status) ? <Loader2 size={12} className="project-chat-attachment-spin" /> : null}
                    {getAttachmentStatusLabel(attachment.status)}
                  </span>
                  {attachment.error_message ? (
                    <em>{attachment.error_message}</em>
                  ) : null}
                </div>
                <div className="project-chat-attachment-row__actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onReadFull?.(attachment)}
                    disabled={readDisabled}
                    title={readTitle}
                  >
                    <BookOpen size={14} />
                    {getFullReadActionLabel(attachment.status)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onAskSample?.(attachment)}
                    disabled={askDisabled}
                    title={askDisabled ? 'Tệp này đang lỗi nên chưa thể hỏi thử' : 'Hỏi thử về file'}
                  >
                    <MessageCircle size={14} />
                    Hỏi thử về file
                  </button>
                  {onRemove ? (
                    <button
                      type="button"
                    className="btn btn-ghost btn-sm project-chat-attachment-row__delete"
                    onClick={() => onRemove(attachment)}
                    disabled={removeDisabled}
                    title={removeTitle}
                      aria-label={`Xóa tệp ${attachment.file_name || ''}`.trim()}
                    >
                      <Trash2 size={14} />
                      Xóa
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </aside>
    </>
  );
}
