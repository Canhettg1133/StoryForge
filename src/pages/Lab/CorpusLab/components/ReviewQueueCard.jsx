function getPriorityLabel(priority) {
  if (priority === 'P0') return 'Khẩn cấp';
  if (priority === 'P1') return 'Quan trọng';
  return 'Theo dõi';
}

function getItemTypeLabel(type) {
  if (type === 'incident') return 'Incident';
  if (type === 'event') return 'Event';
  if (type === 'location') return 'Địa điểm';
  if (type === 'consistency_risk') return 'Consistency';
  return type || 'Item';
}

export default function ReviewQueueCard({ item, rank, onResolve }) {
  return (
    <article className={`review-queue-card ${item.priority || 'P2'} ${item.status || 'pending'}`}>
      <header className="review-queue-header">
        <div className="review-queue-rank">#{rank}</div>
        <div className="review-queue-title">
          <span className={`review-priority-badge ${item.priority || 'P2'}`}>{item.priority || 'P2'}</span>
          <strong>{getPriorityLabel(item.priority)}</strong>
          <span className="review-item-type">{getItemTypeLabel(item.itemType)}</span>
        </div>
        <div className="review-score">Điểm {Math.round((Number(item.priorityScore || 0)) * 100)}%</div>
      </header>

      {Array.isArray(item.reason) && item.reason.length > 0 && (
        <ul className="review-reasons">
          {item.reason.slice(0, 3).map((reason) => (
            <li key={`${item.id}_${reason}`}>{reason}</li>
          ))}
        </ul>
      )}

      {Array.isArray(item.suggestions) && item.suggestions.length > 0 && (
        <div className="review-suggestions">
          {item.suggestions.slice(0, 2).map((suggestion) => (
            <span key={`${item.id}_${suggestion}`} className="review-suggestion-chip">{suggestion}</span>
          ))}
        </div>
      )}

      <footer className="review-actions">
        <span className={`review-status-badge ${item.status || 'pending'}`}>
          {item.status === 'resolved' ? 'Đã xử lý' : item.status === 'ignored' ? 'Đã bỏ qua' : 'Đang chờ'}
        </span>

        {item.status === 'pending' && (
          <div className="review-action-buttons">
            <button
              type="button"
              className="review-btn resolve"
              onClick={() => onResolve?.(item.id, { status: 'resolved', resolution: 'Accepted as-is' })}
            >
              Đánh dấu xong
            </button>
            <button
              type="button"
              className="review-btn ignore"
              onClick={() => onResolve?.(item.id, { status: 'ignored', resolution: 'Ignored' })}
            >
              Bỏ qua
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
