function formatChapterRange(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (a === b) return `Chương ${a}`;
    return `Chương ${a} - ${b}`;
  }
  if (Number.isFinite(a)) return `Chương ${a}`;
  return 'Chưa rõ chương';
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n * 100)}%`;
}

function getTypeLabel(type) {
  if (type === 'major_plot_point') return 'Điểm nút chính';
  if (type === 'pov_thread') return 'Tuyến góc nhìn';
  return 'Tuyến phụ';
}

export default function IncidentCard({
  incident,
  events = [],
  expanded = false,
  onToggle,
  onOpen,
  onUpdate,
  onRerun,
}) {
  const previewEvents = expanded ? events : events.slice(0, 3);
  const description = incident.detailedSummary || incident.description || '';
  const consequences = Array.isArray(incident.consequences) ? incident.consequences : [];

  return (
    <article className={`incident-first-card ${expanded ? 'expanded' : ''}`}>
      <header className="incident-first-header">
        <div className="incident-first-main">
          <h3 className="incident-first-title" onClick={() => onOpen?.(incident)}>
            {incident.title || 'Sự kiện lớn chưa đặt tên'}
          </h3>
          <p className="incident-first-meta">
            <span>{formatChapterRange(incident.chapterStart, incident.chapterEnd)}</span>
            <span>Tin cậy {formatPercent(incident.confidence)}</span>
            <span>{incident.eventCount ?? events.length} nhịp</span>
          </p>
        </div>

        <div className="incident-first-badges">
          <span className={`incident-type-badge ${incident.type || 'subplot'}`}>{getTypeLabel(incident.type)}</span>
          {incident.priority && (
            <span className={`incident-priority-badge ${incident.priority}`}>{incident.priority}</span>
          )}
          <span className={`incident-review-badge ${incident.reviewStatus || 'needs_review'}`}>
            {incident.reviewStatus === 'auto_accepted' ? 'Đã tự duyệt' : 'Cần duyệt'}
          </span>
        </div>
      </header>

      {description && (
        <p className="incident-first-description">{description}</p>
      )}

      {incident.boundaryNote && (
        <p className="incident-first-boundary-note">{incident.boundaryNote}</p>
      )}

      {(incident.climax || incident.outcome || consequences.length > 0) && (
        <div className="incident-first-events">
          {incident.climax && (
            <div className="incident-event-item">
              <span className="incident-event-title">Cao trào</span>
              <span>{incident.climax}</span>
            </div>
          )}
          {incident.outcome && (
            <div className="incident-event-item">
              <span className="incident-event-title">Kết quả</span>
              <span>{incident.outcome}</span>
            </div>
          )}
          {consequences.slice(0, 2).map((item) => (
            <div key={`${incident.id}_${item}`} className="incident-event-item">
              <span className="incident-event-title">Hệ quả</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      <div className="incident-first-events">
        {previewEvents.length === 0 && (
          <p className="incident-empty-events">Chưa có nhịp liên kết.</p>
        )}
        {previewEvents.map((event) => (
          <div key={event.id} className="incident-event-item">
            <span className="incident-event-title">{event.title || event.description || 'Nhịp'}</span>
            <span className="incident-event-chapter">
              {Number.isFinite(Number(event.chapterIndex ?? event.chapter))
                ? `Ch. ${Number(event.chapterIndex ?? event.chapter)}`
                : 'Chưa rõ chương'}
            </span>
          </div>
        ))}
      </div>

      <footer className="incident-first-actions">
        {events.length > 3 && (
          <button type="button" className="incident-first-btn ghost" onClick={onToggle}>
            {expanded ? 'Thu gọn' : `Xem thêm ${events.length - 3}`}
          </button>
        )}
        <button type="button" className="incident-first-btn" onClick={() => onOpen?.(incident)}>
          Chi tiết
        </button>
        <button
          type="button"
          className="incident-first-btn ghost"
          onClick={() => onRerun?.(incident)}
        >
          Chạy lại sự kiện lớn
        </button>
        {incident.reviewStatus !== 'auto_accepted' && (
          <button
            type="button"
            className="incident-first-btn success"
            onClick={() => onUpdate?.(incident.id, { reviewStatus: 'auto_accepted' })}
          >
            Duyệt nhanh
          </button>
        )}
      </footer>
    </article>
  );
}
