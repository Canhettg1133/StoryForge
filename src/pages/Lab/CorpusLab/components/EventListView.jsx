/**
 * EventListView - Filterable list of events
 */

import EventCard from './EventCard.jsx';

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

export default function EventListView({
  events,
  selectedIds,
  onToggle,
  onEdit,
  onAnnotate,
  onSelectAll,
}) {
  if (!events || events.length === 0) {
    return (
      <div className="event-list-empty">
        <div className="empty-icon">📭</div>
        <h3>Không tìm thấy sự kiện</h3>
        <p>Hãy điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.</p>
      </div>
    );
  }

  // Group events by severity for better organization
  const grouped = {
    crucial: events.filter((e) => e.severity === 'crucial'),
    major: events.filter((e) => e.severity === 'major'),
    moderate: events.filter((e) => e.severity === 'moderate'),
    minor: events.filter((e) => e.severity === 'minor'),
  };

  const allSelected = events.length > 0 && events.every((e) => selectedIds.has(e.id));
  const someSelected = events.some((e) => selectedIds.has(e.id));

  return (
    <div className="event-list-view">
      <div className="event-list-header">
        <label className="select-all-toggle">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected;
            }}
            onChange={() => {
              if (allSelected) {
                events.forEach((e) => selectedIds.has(e.id) && onToggle(e.id));
              } else {
                onSelectAll?.();
              }
            }}
          />
          Chọn tất cả ({events.length})
        </label>
      </div>

      {Object.entries(grouped).map(([severity, items]) => {
        if (items.length === 0) return null;

        return (
          <div key={severity} className={`event-list-group group-${severity}`}>
            <div className="event-list-group-header">
              <span className={`group-indicator severity-${severity}`} />
              <span className="group-label">{SEVERITY_LABELS[severity] || capitalize(severity)}</span>
              <span className="group-count">{items.length}</span>
            </div>

            <div className="event-list-group-items">
              {items.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  selected={selectedIds.has(event.id)}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onAnnotate={onAnnotate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
