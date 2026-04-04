import React from 'react';
import { BookOpen, FileText, Hash, Sparkles } from 'lucide-react';

function formatNumber(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

export default function FilePreview({ file, corpus }) {
  if (!file && !corpus) {
    return null;
  }

  const chapterCount = corpus?.chapterCount || corpus?.chapters?.length || 0;
  const wordCount = corpus?.wordCount || 0;

  return (
    <div className="corpus-card file-preview">
      <h3>Xem trước file</h3>

      <div className="preview-row">
        <FileText size={16} />
        <span>{file?.name || corpus?.sourceFile || 'Chưa có file'}</span>
      </div>

      <div className="preview-row">
        <BookOpen size={16} />
        <span>{formatNumber(chapterCount)} chương</span>
      </div>

      <div className="preview-row">
        <Hash size={16} />
        <span>{formatNumber(wordCount)} từ</span>
      </div>

      {(corpus?.fandom || corpus?.fandomSuggestion?.label) && (
        <div className="preview-row">
          <Sparkles size={16} />
          <span>
            {corpus?.fandomSuggestion?.label || corpus?.fandom}
            {corpus?.fandomSuggestion?.confidence != null && (
              <> ({Math.round(corpus.fandomSuggestion.confidence * 100)}%)</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
