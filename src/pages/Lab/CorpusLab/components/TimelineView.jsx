/**
 * TimelineView - Horizontal timeline for events
 */

import { useRef, useState } from 'react';

const ARC_COLORS = {
  setup: '#6366f1',
  rising: '#f59e0b',
  climax: '#ef4444',
  falling: '#f97316',
  resolution: '#22c55e',
};

const ARC_LABELS = {
  setup: 'Mở đầu',
  rising: 'Tăng tiến',
  climax: 'Cao trào',
  falling: 'Hạ nhiệt',
  resolution: 'Kết',
};

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

export default function TimelineView({
  data,
  events,
  selectedIds,
  onToggle,
  onEdit,
  onAnnotate,
}) {
  const scrollRef = useRef(null);
  const [hoveredChapter, setHoveredChapter] = useState(null);

  // data is timeline data from buildTimeline()
  const chapters = data || [];

  // Fallback: build from events if data not provided
  const displayChapters = chapters.length > 0 ? chapters : buildChaptersFromEvents(events);
  const isSingleChapter = displayChapters.length <= 1;
  const chapterWidth = isSingleChapter ? 560 : 280;

  if (!events || events.length === 0) {
    return (
      <div className="timeline-empty">
        <div className="empty-icon">🕒</div>
        <h3>Không có sự kiện để hiển thị</h3>
        <p>Hãy thêm sự kiện để xem trên dòng thời gian.</p>
      </div>
    );
  }

  return (
    <div className={`timeline-view ${isSingleChapter ? 'single-chapter' : ''}`}>
      {/* Timeline header */}
      <div className="timeline-header">
        <div className="timeline-legend">
          {Object.entries(ARC_COLORS).map(([arc, color]) => (
            <span key={arc} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              {ARC_LABELS[arc] || capitalize(arc)}
            </span>
          ))}
        </div>
      </div>

      {/* Timeline scroll area */}
      <div ref={scrollRef} className="timeline-scroll">
        <div
          className="timeline-track"
          style={{
            width: isSingleChapter
              ? '100%'
              : Math.max(displayChapters.length * chapterWidth, 760),
            minWidth: '100%',
          }}
        >
          {/* Arc background */}
          <svg className="timeline-arc-line" preserveAspectRatio="none">
            <defs>
              <linearGradient id="arc-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                {displayChapters.map((_, i) => (
                  <stop
                    key={i}
                    offset={`${(i / (displayChapters.length - 1)) * 100}%`}
                    stopColor={getArcColor(i, displayChapters.length)}
                  />
                ))}
              </linearGradient>
            </defs>
            <path
              d={generateArcPath(displayChapters.length, chapterWidth)}
              stroke="url(#arc-gradient)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
          </svg>

          {/* Chapter markers */}
          <div className="timeline-chapters">
            {displayChapters.map((chapter) => (
              <div
                key={chapter.chapter}
                className={`timeline-chapter ${hoveredChapter === chapter.chapter ? 'hovered' : ''}`}
                style={{ width: isSingleChapter ? '100%' : chapterWidth }}
                onMouseEnter={() => setHoveredChapter(chapter.chapter)}
                onMouseLeave={() => setHoveredChapter(null)}
              >
                <div className="chapter-marker">
                  <div className="chapter-line" />
                  <span className="chapter-label">Ch. {formatChapter(chapter.chapter)}</span>
                  <span className="chapter-count">{chapter.events.length}</span>
                </div>

                {/* Events on chapter */}
                <div className="chapter-events">
                  {chapter.events.map((event, index) => {
                    const canonType = event.canonOrFanon?.type === 'fanon' ? 'fanon' : 'canon';
                    const shortDescription = truncateText(
                      event.description || 'Không có mô tả',
                      isSingleChapter ? 130 : 85
                    );

                    return (
                    <div
                      key={event.id}
                      className={`timeline-event ${selectedIds.has(event.id) ? 'selected' : ''}`}
                      onClick={() => onToggle(event.id)}
                    >
                      <div
                        className="event-dot"
                        style={{
                          backgroundColor: getSeverityColor(event.severity),
                          borderColor: event.canonOrFanon?.type === 'fanon' ? '#a855f7' : '#3b82f6',
                        }}
                      />
                      <div className="event-preview">
                        <div className="event-topline">
                          <span className="event-order">#{index + 1}</span>
                          <span className={`event-source ${canonType}`}>
                            {canonType === 'canon' ? 'Chính sử' : 'Phi chính sử'}
                          </span>
                        </div>
                        <span className="event-title">
                          {shortDescription}
                        </span>
                        <div className="event-meta">
                          <span className={`event-severity severity-${event.severity || 'minor'}`}>
                            {SEVERITY_LABELS[event.severity] || 'Nhẹ'}
                          </span>
                          {event.emotionalIntensity ? (
                            <span className="event-intensity">🔥 {event.emotionalIntensity}/10</span>
                          ) : null}
                        </div>
                        <div className="event-quick-actions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit?.(event);
                            }}
                            title="Chỉnh sửa"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAnnotate?.(event);
                            }}
                            title="Ghi chú"
                          >
                            📝
                          </button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="timeline-zoom">
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
          title="Cuộn trái"
        >
          ←
        </button>
        <button
          onClick={() => scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
          title="Cuộn phải"
        >
          →
        </button>
      </div>
    </div>
  );
}

function buildChaptersFromEvents(events) {
  if (!events || !events.length) return [];

  const chapters = {};
  for (const event of events) {
    const ch = Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : 0;
    if (!chapters[ch]) {
      chapters[ch] = { chapter: ch, events: [] };
    }
    chapters[ch].events.push(event);
  }

  return Object.values(chapters).sort((a, b) => {
    if (a.chapter === 0) return 1;
    if (b.chapter === 0) return -1;
    return a.chapter - b.chapter;
  });
}

function generateArcPath(chapterCount, chapterWidth = 200) {
  if (chapterCount < 2) return '';

  const width = chapterCount * chapterWidth;
  const height = 80;
  const midX = width / 2;
  const midY = height;

  return `M 0 ${midY} Q ${midX} ${midY - height} ${width} ${midY}`;
}

function getArcColor(index, total) {
  const progress = index / (total - 1 || 1);
  if (progress < 0.2) return ARC_COLORS.setup;
  if (progress < 0.4) return ARC_COLORS.rising;
  if (progress < 0.7) return ARC_COLORS.climax;
  if (progress < 0.85) return ARC_COLORS.falling;
  return ARC_COLORS.resolution;
}

function getSeverityColor(severity) {
  const colors = {
    crucial: '#22c55e',
    major: '#3b82f6',
    moderate: '#f97316',
    minor: '#9ca3af',
  };
  return colors[severity] || colors.minor;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatChapter(chapter) {
  const value = Number(chapter);
  return Number.isFinite(value) && value > 0 ? value : '?';
}
