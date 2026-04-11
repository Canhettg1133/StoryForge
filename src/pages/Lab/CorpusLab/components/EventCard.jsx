/**
 * EventCard - Individual event card for list/timeline views
 */

const SEVERITY_COLORS = {
  crucial: '#22c55e',
  major: '#3b82f6',
  moderate: '#f97316',
  minor: '#9ca3af',
};

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

const RARITY_STAR = {
  rare: '⭐',
  common_but_good: '✨',
  common: null,
};

const EVENT_TYPE_LABELS = {
  major: 'Nhịp chính',
  minor: 'Nhịp phụ',
  twist: 'Cú bẻ lái',
  cliffhanger: 'Treo nút',
  event: 'Nhịp',
};

export default function EventCard({
  event,
  selected,
  onToggle,
  onEdit,
  onAnnotate,
  compact = false,
}) {
  const severityColor = SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.minor;
  const canonType = event.canonOrFanon?.type || 'canon';
  const canonLabel = canonType === 'canon' ? 'Chính sử' : 'Phi chính sử';
  const rarityLabel = event.rarity?.label || event.rarity?.score || 'Thường';
  const rarityIcon = RARITY_STAR[event.rarity?.score] || null;
  const reviewStatus = event.reviewStatus || (event.needsReview ? 'needs_review' : 'auto_accepted');
  const chapterConfidence = Number(event.chapterConfidence);
  const chapterConfidencePct = Number.isFinite(chapterConfidence)
    ? Math.round(chapterConfidence * 100)
    : null;

  const hasAnnotation = Boolean(event.annotation?.note);
  const isStarred = event.annotation?.starred;

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggle?.(event.id);
  };

  return (
    <div
      className={`event-card ${event.severity} ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`}
      onClick={onEdit ? () => onEdit(event) : undefined}
      style={{ '--severity-color': severityColor }}
    >
      <div className="event-card-header">
        <input
          type="checkbox"
          checked={selected}
          onChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label="Chọn sự kiện"
        />

        <div className="event-card-badges">
          <span
            className={`badge canon-badge ${canonType}`}
            title={canonLabel}
          >
            {canonType === 'canon' ? '🔵' : '🟣'}
          </span>

          <span
            className="badge severity-badge"
            style={{ borderColor: severityColor, color: severityColor }}
          >
            {SEVERITY_LABELS[event.severity] || event.severity}
          </span>

          {event._type && (
            <span className="badge type-badge" title="Loại sự kiện">
              {EVENT_TYPE_LABELS[event._type] || event._type}
            </span>
          )}

          {rarityIcon && (
            <span className="badge rarity-badge" title={rarityLabel}>
              {rarityIcon}
            </span>
          )}

          {isStarred && <span className="badge starred-badge">⭐</span>}

          <span className={`badge review-badge ${reviewStatus}`}>
            {reviewStatus === 'needs_review' ? '⚠️ Cần duyệt' : '✅ Tự động'}
          </span>
        </div>
      </div>

      <p className="event-card-description">{event.description}</p>

      {!compact && event.tags?.length > 0 && (
        <div className="event-card-tags">
          {event.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          {event.tags.length > 4 && (
            <span className="tag tag-more">+{event.tags.length - 4}</span>
          )}
        </div>
      )}

      {!compact && (
        <div className="event-card-meta">
          {event.chapter && <span>Ch. {event.chapter}</span>}
          {event.locationLink?.locationName && <span>📍 {event.locationLink.locationName}</span>}
          {chapterConfidencePct != null && (
            <span>
              Tin cậy chương: {chapterConfidencePct}%
            </span>
          )}
          {event.emotionalIntensity && (
            <span>
              Cảm xúc: {event.emotionalIntensity}/10
            </span>
          )}
          {event.insertability && (
            <span>
              Dễ chèn: {event.insertability}/10
            </span>
          )}
        </div>
      )}

      {!compact && event.characters?.length > 0 && (
        <div className="event-card-characters">
          {event.characters.slice(0, 3).join(', ')}
          {event.characters.length > 3 && ` +${event.characters.length - 3}`}
        </div>
      )}

      {!compact && event.grounding?.evidenceSnippet && (
        <div className="event-card-evidence">
          {event.grounding.evidenceSnippet}
        </div>
      )}

      {hasAnnotation && !compact && (
        <div className="event-card-annotation">
          Ghi chú: {event.annotation.note.substring(0, 60)}
          {event.annotation.note.length > 60 ? '...' : ''}
        </div>
      )}

      {!compact && <div className="event-card-actions">
        {onEdit && (
          <button
            className="event-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(event);
            }}
            title="Chỉnh sửa"
          >
            ✏️
          </button>
        )}
        {onAnnotate && (
          <button
            className="event-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAnnotate(event);
            }}
            title="Ghi chú"
          >
            📝
          </button>
        )}
      </div>}
    </div>
  );
}
