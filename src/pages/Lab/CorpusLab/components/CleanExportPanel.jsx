import React from 'react';

const FORMATS = [
  { id: 'txt', label: 'TXT' },
  { id: 'epub', label: 'EPUB' },
  { id: 'docx', label: 'DOCX' },
  { id: 'pdf', label: 'PDF' },
];

export default function CleanExportPanel({
  corpus,
  onExport,
  exportState,
  exportError,
}) {
  if (!corpus) {
    return null;
  }

  return (
    <div className="corpus-card clean-export-panel">
      <div className="clean-export-header">
        <div>
          <h3>Clean Export</h3>
          <p className="muted">
            Tải bản truyện đã tách chương sạch để đọc tiếp trong app ebook hoặc kiểm tra trước khi phân tích truyện.
          </p>
        </div>
        <div className="clean-export-badge">
          {Number(corpus.chapterCount || corpus.chapters?.length || 0)} chương
        </div>
      </div>

      <div className="clean-export-actions">
        {FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            className="btn btn-secondary"
            onClick={() => onExport?.(format.id)}
            disabled={Boolean(exportState?.busy)}
          >
            {exportState?.busy && exportState.format === format.id ? `Đang xuất ${format.label}...` : `Tải ${format.label}`}
          </button>
        ))}
      </div>

      <p className="muted">
        EPUB sẽ có TOC chuẩn để Moon+ Reader và các app ebook nhảy đúng mục lục. TXT là văn bản sạch; DOCX/PDF phù hợp để đọc hoặc chỉnh sửa tiếp.
      </p>

      {exportError ? <p className="corpus-error">{exportError}</p> : null}
    </div>
  );
}
