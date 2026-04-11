/**
 * IncidentClusterView - Incident-first view (major event + location)
 */

import { useMemo, useState } from 'react';
import EventCard from './EventCard.jsx';

export default function IncidentClusterView({
  incidents = [],
  events = [],
  selectedIds,
  onToggle,
  onEdit,
  onAnnotate,
}) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  const eventMap = useMemo(() => {
    const map = new Map();
    for (const event of events || []) {
      if (!event?.id) continue;
      map.set(event.id, event);
    }
    return map;
  }, [events]);

  if (!incidents || incidents.length === 0) {
    return (
      <div className="event-list-empty">
        <div className="empty-icon">📍</div>
        <h3>Chưa có cụm sự kiện lớn</h3>
        <p>Hệ thống chưa đủ dữ liệu để gom cụm theo địa điểm và biến cố lớn.</p>
      </div>
    );
  }

  const toggleExpanded = (incidentId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(incidentId)) {
        next.delete(incidentId);
      } else {
        next.add(incidentId);
      }
      return next;
    });
  };

  const toggleIncidentSelection = (incident) => {
    const ids = Array.isArray(incident.filteredEventIds) && incident.filteredEventIds.length > 0
      ? incident.filteredEventIds
      : (incident.eventIds || []);

    if (!ids.length) return;

    const allSelected = ids.every((id) => selectedIds.has(id));
    if (allSelected) {
      ids.forEach((id) => selectedIds.has(id) && onToggle(id));
      return;
    }

    ids.forEach((id) => {
      if (!selectedIds.has(id)) {
        onToggle(id);
      }
    });
  };

  return (
    <div className="incident-view">
      {incidents.map((incident) => {
        const ids = Array.isArray(incident.filteredEventIds) && incident.filteredEventIds.length > 0
          ? incident.filteredEventIds
          : (incident.eventIds || []);
        const incidentEvents = ids.map((id) => eventMap.get(id)).filter(Boolean);
        if (incidentEvents.length === 0) {
          return null;
        }

        const expanded = expandedIds.has(incident.id);
        const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
        const chapterLabel = formatChapterRange(incident.chapterStart, incident.chapterEnd);
        const confidenceLabel = formatPercent(incident.confidence);
        const anchorEvent = incident.anchorEventId ? eventMap.get(incident.anchorEventId) : incidentEvents[0];

        return (
          <article key={incident.id} className="incident-card">
            <header className="incident-card-header">
              <div className="incident-title-wrap">
                <h3
                  className="incident-title"
                  role={anchorEvent ? 'button' : undefined}
                  tabIndex={anchorEvent ? 0 : undefined}
                  onClick={() => anchorEvent && onEdit?.(anchorEvent)}
                  onKeyDown={(e) => {
                    if (!anchorEvent) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEdit?.(anchorEvent);
                    }
                  }}
                >
                  {incident.title}
                </h3>
                <p className="incident-location">
                  📍 {incident.location?.name || 'Chưa xác định địa điểm'}
                </p>
              </div>

              <div className="incident-header-actions">
                <span className="incident-metric">{chapterLabel}</span>
                <span className="incident-metric">Tin cậy: {confidenceLabel}</span>
                <span className="incident-metric">{incidentEvents.length} sự kiện</span>
                <button
                  type="button"
                  className="incident-btn"
                  onClick={() => toggleIncidentSelection(incident)}
                >
                  {selectedCount > 0 ? `Đã chọn ${selectedCount}` : 'Chọn cả cụm'}
                </button>
                {anchorEvent && (
                  <button
                    type="button"
                    className="incident-btn"
                    onClick={() => onEdit?.(anchorEvent)}
                  >
                    Xem sự kiện trụ
                  </button>
                )}
                <button
                  type="button"
                  className="incident-btn"
                  onClick={() => toggleExpanded(incident.id)}
                >
                  {expanded ? 'Thu gọn' : 'Mở chi tiết'}
                </button>
              </div>
            </header>

            {incident.evidenceSnippet && (
              <p className="incident-evidence">{incident.evidenceSnippet}</p>
            )}

            {incident.tags?.length > 0 && (
              <div className="incident-tags">
                {incident.tags.slice(0, 8).map((tag) => (
                  <span key={`${incident.id}_${tag}`} className="tag">{tag}</span>
                ))}
              </div>
            )}

            <div className="incident-events">
              {(expanded ? incidentEvents : incidentEvents.slice(0, 3)).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  selected={selectedIds.has(event.id)}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onAnnotate={onAnnotate}
                  compact={!expanded}
                />
              ))}
              {!expanded && incidentEvents.length > 3 && (
                <button
                  type="button"
                  className="incident-more-btn"
                  onClick={() => toggleExpanded(incident.id)}
                >
                  +{incidentEvents.length - 3} sự kiện con
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '?';
  return `${Math.round(parsed * 100)}%`;
}

function formatChapterRange(start, end) {
  const a = Number(start);
  const b = Number(end);
  if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
    if (a === b) return `Ch. ${a}`;
    return `Ch. ${a}-${b}`;
  }
  if (Number.isFinite(a) && a > 0) return `Ch. ${a}`;
  return 'Ch. ?';
}
