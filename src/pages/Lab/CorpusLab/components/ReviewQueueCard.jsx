function getPriorityLabel(priority) {
  if (priority === 'P0') return 'Khẩn cấp';
  if (priority === 'P1') return 'Quan trọng';
  return 'Theo dõi';
}

function getItemTypeLabel(type) {
  if (type === 'incident') return 'Sự kiện lớn';
  if (type === 'event') return 'Nhịp';
  if (type === 'location') return 'Địa điểm';
  if (type === 'consistency_risk') return 'Nhất quán';
  return type || 'Mục';
}

function normalizeReasonList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatScope(item) {
  const rerunScope = item.rerunScope || item.rerun_scope || 'incident';
  const incidentCount = Array.isArray(item.relatedIncidentIds || item.related_incident_ids)
    ? (item.relatedIncidentIds || item.related_incident_ids).length
    : 0;
  const windowCount = Array.isArray(item.relatedWindowIds || item.related_window_ids)
    ? (item.relatedWindowIds || item.related_window_ids).length
    : 0;
  const scopeLabelMap = {
    incident: 'sự kiện lớn',
    reducer: 'reducer',
    window: 'cửa sổ',
    graph_projection: 'đồ thị',
    character_canonicalizer: 'canonical hóa nhân vật',
    world_canonicalizer: 'canonical hóa thế giới',
  };
  const scopeLabel = scopeLabelMap[rerunScope] || rerunScope;
  return `${scopeLabel}${incidentCount ? `, ${incidentCount} sự kiện lớn` : ''}${windowCount ? `, ${windowCount} cửa sổ` : ''}`;
}

export default function ReviewQueueCard({ item, rank, onResolve, onRerun }) {
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
        <div className="review-score">Điểm duyệt {Math.round((Number(item.priorityScore || 0)) * 100)}%</div>
      </header>

      {(item.displayTitle || item.displayChapter) && (
        <div className="review-item-summary">
          {item.displayTitle && <strong>{item.displayTitle}</strong>}
          {item.displayChapter && <span>Ch.{item.displayChapter}</span>}
        </div>
      )}

      <div className="review-suggestions">
        <span className="review-suggestion-chip">Phạm vi: {formatScope(item)}</span>
        {item.suggestedAction && (
          <span className="review-suggestion-chip">{item.suggestedAction}</span>
        )}
      </div>

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
          {item.status === 'resolved' ? 'Đã xử lý' : item.status === 'ignored' ? 'Bỏ qua' : 'Chờ duyệt'}
        </span>

        <div className="review-action-buttons">
          {item.status === 'pending' && (
            <>
              <button
                type="button"
                className="review-btn resolve"
                onClick={() => onResolve?.(item.id, { status: 'resolved', resolution: 'Đã xác nhận bởi người duyệt' })}
              >
                Đánh dấu xong
              </button>
              <button
                type="button"
                className="review-btn ignore"
                onClick={() => onResolve?.(item.id, { status: 'ignored', resolution: 'Bỏ qua theo quyết định người duyệt' })}
              >
                Bỏ qua
              </button>
            </>
          )}
          <button
            type="button"
            className="review-btn"
            onClick={() => onRerun?.({
              phase: item.rerunScope || item.rerun_scope || 'incident',
              windowIds: item.relatedWindowIds || item.related_window_ids || [],
              incidentIds: item.relatedIncidentIds || item.related_incident_ids || [],
              canonicalizerKinds: item.rerunScope === 'character_canonicalizer'
                ? ['character']
                : (item.rerunScope === 'world_canonicalizer' ? ['location', 'object', 'term'] : []),
              reason: `Rerun từ review queue cho ${item.itemType || 'item'} ${item.itemId || item.id}`,
            })}
          >
            Chạy lại scope
          </button>
        </div>
      </footer>
    </article>
  );
}
