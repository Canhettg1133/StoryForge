import React from 'react';

function formatBoundary(item = {}) {
  const lineNumber = Number(item?.lineNumber || 0);
  const text = String(item?.text || '').trim();
  if (!text) {
    return lineNumber > 0 ? `Dòng ${lineNumber}` : 'Boundary nghi ngờ';
  }

  return lineNumber > 0 ? `Dòng ${lineNumber}: ${text}` : text;
}

export default function ChapterParsePreview({ corpus }) {
  const frontMatter = String(corpus?.frontMatter?.content || '').trim();
  const diagnostics = corpus?.parseDiagnostics || null;
  const suspiciousBoundaries = Array.isArray(diagnostics?.rejectedBoundaries)
    ? diagnostics.rejectedBoundaries.slice(0, 8)
    : [];
  const headingCandidates = Array.isArray(diagnostics?.headingCandidates)
    ? diagnostics.headingCandidates.length
    : 0;

  if (!corpus) {
    return null;
  }

  return (
    <div className="corpus-card parse-preview">
      <div className="parse-preview-header">
        <div>
          <h3>Preview tách chương</h3>
          <p className="muted">
            Xem nhanh front matter, số chương đã tách và các boundary bị loại để biết parser có đang hiểu đúng truyện không.
          </p>
        </div>
        <div className="parse-preview-stats">
          <span>{Number(corpus.chapterCount || corpus.chapters?.length || 0)} chương</span>
          <span>{headingCandidates} candidate</span>
        </div>
      </div>

      {frontMatter && (
        <div className="parse-preview-block">
          <h4>Front Matter</h4>
          <pre>{frontMatter}</pre>
        </div>
      )}

      {!frontMatter && (
        <div className="parse-preview-block">
          <h4>Front Matter</h4>
          <p className="muted">Không phát hiện front matter rõ ràng.</p>
        </div>
      )}

      <div className="parse-preview-block">
        <h4>Boundary nghi ngờ / đã loại</h4>
        {suspiciousBoundaries.length > 0 ? (
          <ul className="parse-preview-list">
            {suspiciousBoundaries.map((item, index) => (
              <li key={`${item.lineNumber || 'line'}-${index}`}>
                <strong>{formatBoundary(item)}</strong>
                {item?.rejectedReason ? <span>{item.rejectedReason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Chưa thấy boundary đáng ngờ nào trong lần parse này.</p>
        )}
      </div>
    </div>
  );
}
