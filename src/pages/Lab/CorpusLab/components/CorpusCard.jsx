import React from 'react';
import { BookText, Calendar, Layers, Trash2 } from 'lucide-react';

const STATUS_LABELS = {
  uploaded: 'Đã tải lên',
  parsed: 'Đã tách chương',
  analyzing: 'Đang phân tích',
  analyzed: 'Đã phân tích xong',
};

function formatDate(timestamp) {
  if (!timestamp) {
    return '--';
  }
  return new Date(timestamp).toLocaleDateString('vi-VN');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

export default function CorpusCard({ corpus, active, onOpen, onDelete }) {
  return (
    <article className={`corpus-list-card ${active ? 'is-active' : ''}`}>
      <button type="button" className="corpus-list-main" onClick={() => onOpen?.(corpus)}>
        <h4>{corpus.title || 'Corpus chưa đặt tên'}</h4>
        <p>{corpus.author || 'Chưa rõ tác giả'}</p>

        <div className="corpus-card-meta">
          <span><BookText size={14} /> {formatNumber(corpus.chapterCount)} chương</span>
          <span>{formatNumber(corpus.wordCount)} từ</span>
          <span><Layers size={14} /> {formatNumber(corpus.chunkCount)} chunk</span>
          <span><Calendar size={14} /> {formatDate(corpus.createdAt)}</span>
        </div>

        <div className="corpus-card-tags">
          {corpus.fandom && <span>{corpus.fandom}</span>}
          {corpus.fileType && <span>{String(corpus.fileType).toUpperCase()}</span>}
          {corpus.status && <span>{STATUS_LABELS[corpus.status] || corpus.status}</span>}
        </div>
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-sm corpus-delete-btn"
        onClick={() => onDelete?.(corpus)}
        title="Xóa corpus"
      >
        <Trash2 size={14} />
      </button>
    </article>
  );
}
