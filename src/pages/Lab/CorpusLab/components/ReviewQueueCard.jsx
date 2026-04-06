function getPriorityLabel(priority) {
  if (priority === 'P0') return 'Khan cap';
  if (priority === 'P1') return 'Quan trong';
  return 'Theo doi';
}

function getItemTypeLabel(type) {
  if (type === 'incident') return 'Su kien lon';
  if (type === 'event') return 'Su kien';
  if (type === 'location') return 'Dia diem';
  if (type === 'consistency_risk') return 'Consistency';
  return type || 'Item';
}

function normalizeReasonList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export default function ReviewQueueCard({ item, rank, onResolve }) {
  const reasons = normalizeReasonList(item.reason);
  const suggestions = normalizeReasonList(item.suggestions);

  return (
    <article className={`review-queue-card ${item.priority || 'P2'} ${item.status || 'pending'}`}>
      <header className="review-queue-header">
        <div className="review-queue-rank">#{rank}</div>
        <div className="review-queue-title">
          <span className={`review-priority-badge ${item.priority || 'P2'}`}>{item.priority || 'P2'}</span>
          <strong>{getPriorityLabel(item.priority)}</strong>
          <span className="review-item-type">{getItemTypeLabel(item.itemType)}</span>
        </div>
        <div className="review-score">Diem duyet {Math.round((Number(item.priorityScore || 0)) * 100)}%</div>
      </header>

      {reasons.length > 0 && (
        <ul className="review-reasons">
          {reasons.slice(0, 3).map((reason) => (
            <li key={`${item.id}_${reason}`}>{reason}</li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="review-suggestions">
          {suggestions.slice(0, 2).map((suggestion) => (
            <span key={`${item.id}_${suggestion}`} className="review-suggestion-chip">{suggestion}</span>
          ))}
        </div>
      )}

      <footer className="review-actions">
        <span className={`review-status-badge ${item.status || 'pending'}`}>
          {item.status === 'resolved' ? 'Da xu ly' : item.status === 'ignored' ? 'Da bo qua' : 'Dang cho'}
        </span>

        {item.status === 'pending' && (
          <div className="review-action-buttons">
            <button
              type="button"
              className="review-btn resolve"
              onClick={() => onResolve?.(item.id, { status: 'resolved', resolution: 'Da xac nhan' })}
            >
              Danh dau xong
            </button>
            <button
              type="button"
              className="review-btn ignore"
              onClick={() => onResolve?.(item.id, { status: 'ignored', resolution: 'Bo qua' })}
            >
              Bo qua
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
