import { useEffect, useMemo, useState } from 'react';

const ZOOM_PRESETS = {
  broad: { label: 'Toàn cảnh', count: 16 },
  balanced: { label: 'Cân bằng', count: 10 },
  focused: { label: 'Chi tiết', count: 6 },
};

const INCIDENT_TYPES = {
  major_plot_point: 'Điểm nút chính',
  subplot: 'Tuyến phụ',
  pov_thread: 'Tuyến góc nhìn',
};

const LABEL_COLUMN_WIDTH = 280;
const CHAPTER_COLUMN_WIDTH = 84;

export default function TimelineView({
  data,
  events = [],
  incidents = [],
  onEdit,
  onAnnotate,
}) {
  const chapters = useMemo(
    () => (Array.isArray(data) && data.length ? data : buildChapters(events)),
    [data, events],
  );
  const chapterNumbers = useMemo(
    () => chapters.map((item) => Number(item.chapter)).filter((item) => item > 0).sort((a, b) => a - b),
    [chapters],
  );
  const chapterEventMap = useMemo(
    () => new Map(chapters.map((item) => [item.chapter, item.events || []])),
    [chapters],
  );
  const incidentRows = useMemo(
    () => buildIncidentRows(incidents, events),
    [incidents, events],
  );

  const [zoom, setZoom] = useState(getInitialZoom(chapterNumbers.length));
  const [rangeStart, setRangeStart] = useState(0);
  const [focusedChapter, setFocusedChapter] = useState(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState('');

  const visibleCount = Math.min(ZOOM_PRESETS[zoom].count, Math.max(chapterNumbers.length, 1));
  const maxRangeStart = Math.max(chapterNumbers.length - visibleCount, 0);
  const visibleChapters = useMemo(
    () => chapterNumbers.slice(rangeStart, rangeStart + visibleCount),
    [chapterNumbers, rangeStart, visibleCount],
  );
  const visibleStart = visibleChapters[0] || 0;
  const visibleEnd = visibleChapters[visibleChapters.length - 1] || 0;

  useEffect(() => {
    if (rangeStart > maxRangeStart) setRangeStart(maxRangeStart);
  }, [maxRangeStart, rangeStart]);

  useEffect(() => {
    if (!focusedChapter || !visibleChapters.includes(focusedChapter)) {
      setFocusedChapter(null);
    }
  }, [focusedChapter, visibleChapters]);

  const visibleIncidents = useMemo(
    () => incidentRows.filter((item) => item.startChapter <= visibleEnd && item.endChapter >= visibleStart),
    [incidentRows, visibleEnd, visibleStart],
  );
  const visibleChapterGroups = useMemo(
    () => buildVisibleChapterGroups(visibleChapters, visibleIncidents),
    [visibleChapters, visibleIncidents],
  );
  const filteredIncidents = useMemo(
    () => (focusedChapter
      ? visibleIncidents.filter((item) => focusedChapter >= item.startChapter && focusedChapter <= item.endChapter)
      : visibleIncidents),
    [focusedChapter, visibleIncidents],
  );

  useEffect(() => {
    if (!filteredIncidents.length) {
      setSelectedIncidentId('');
      return;
    }
    if (!filteredIncidents.some((item) => item.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].id);
    }
  }, [filteredIncidents, selectedIncidentId]);

  const selectedIncident = useMemo(
    () => filteredIncidents.find((item) => item.id === selectedIncidentId) || null,
    [filteredIncidents, selectedIncidentId],
  );

  const overviewBuckets = useMemo(
    () => buildOverviewBuckets(chapterNumbers, chapterEventMap),
    [chapterEventMap, chapterNumbers],
  );
  const showOverview = chapterNumbers.length > 30;

  if (!events.length) {
    return (
      <div className="timeline-empty">
        <div className="empty-icon">🕒</div>
        <h3>Không có dữ liệu dòng thời gian</h3>
        <p>Hãy chạy lại phân tích để xem mạch truyện theo chương.</p>
      </div>
    );
  }

  return (
    <div className="narrative-timeline">
      <header className="narrative-timeline__toolbar">
        <div className="narrative-timeline__summary">
          <strong>Ch. {visibleStart || '?'} - Ch. {visibleEnd || '?'}</strong>
          <span>{filteredIncidents.length} sự kiện lớn</span>
          <span>{visibleChapters.length} chương</span>
          {focusedChapter ? <span>Lọc theo Ch. {focusedChapter}</span> : null}
        </div>

        <div className="narrative-timeline__controls">
          <div className="narrative-timeline__group">
            {Object.entries(ZOOM_PRESETS).map(([key, value]) => (
              <button
                key={key}
                type="button"
                className={zoom === key ? 'active' : ''}
                onClick={() => setZoom(key)}
              >
                {value.label}
              </button>
            ))}
          </div>

          <div className="narrative-timeline__group">
            <button
              type="button"
              onClick={() => setRangeStart((value) => Math.max(value - visibleCount, 0))}
              disabled={rangeStart <= 0}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setRangeStart((value) => Math.min(value + visibleCount, maxRangeStart))}
              disabled={rangeStart >= maxRangeStart}
            >
              →
            </button>
          </div>
        </div>
      </header>

      {showOverview ? (
        <div className="narrative-timeline__overview">
          {overviewBuckets.map((bucket) => (
            <button
              key={`${bucket.startChapter}-${bucket.endChapter}`}
              type="button"
              className={`narrative-timeline__overview-bucket ${bucket.startChapter <= visibleEnd && bucket.endChapter >= visibleStart ? 'active' : ''}`}
              title={`Ch. ${bucket.startChapter}${bucket.startChapter !== bucket.endChapter ? `-${bucket.endChapter}` : ''}`}
              onClick={() => setRangeStart(findClosestIndex(chapterNumbers, bucket.startChapter))}
            >
              <span style={{ height: `${bucket.height}%` }} />
            </button>
          ))}
        </div>
      ) : null}

      <section className="narrative-timeline__rail">
        <div className="narrative-timeline__chapters">
          <button
            type="button"
            className={`narrative-timeline__chapter-pill narrative-timeline__chapter-pill--all ${focusedChapter == null ? 'active' : ''}`}
            onClick={() => setFocusedChapter(null)}
          >
            <strong>Toàn dải</strong>
            <span>{events.length} nhịp</span>
          </button>

          {visibleChapterGroups.map((group) => (
            <div
              key={group.key}
              className={`narrative-timeline__chapter-group ${focusedChapter && group.chapters.includes(focusedChapter) ? 'active' : ''}`}
            >
              {group.chapters.map((chapter) => {
                const eventCount = (chapterEventMap.get(chapter) || []).length;
                return (
                  <button
                    key={chapter}
                    type="button"
                    className={`narrative-timeline__chapter-pill ${focusedChapter === chapter ? 'active' : ''}`}
                    onClick={() => setFocusedChapter(chapter)}
                  >
                    <strong>Ch. {chapter}</strong>
                    <span>{eventCount} nhịp</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className={`narrative-timeline__content is-list-only ${selectedIncident ? 'with-detail' : ''}`}>
          <div className="narrative-timeline__incident-list">
            {filteredIncidents.length === 0 ? (
              <div className="narrative-timeline__empty">Không có sự kiện lớn trong phạm vi này.</div>
            ) : (
              filteredIncidents.map((incident) => {
                const active = selectedIncidentId === incident.id;
                return (
                  <button
                    key={incident.id}
                    type="button"
                    className={`narrative-timeline__label ${active ? 'active' : ''}`}
                    onClick={() => setSelectedIncidentId(incident.id)}
                  >
                    <strong>{incident.title}</strong>
                    <span>{formatRange(incident.startChapter, incident.endChapter)}</span>
                  </button>
                );
              })
            )}
          </div>

          {selectedIncident ? (
            <aside className="narrative-timeline__detail">
              <div className="narrative-timeline__detail-card">
                <div className="narrative-timeline__detail-topline">
                  <span className="narrative-timeline__detail-badge">Sự kiện lớn</span>
                  <span className="narrative-timeline__detail-badge muted">
                    {INCIDENT_TYPES[selectedIncident.type] || 'Tuyến phụ'}
                  </span>
                </div>

                <h3>{selectedIncident.title}</h3>
                <p>{selectedIncident.description || 'Chưa có mô tả chi tiết cho sự kiện lớn này.'}</p>

                <div className="narrative-timeline__detail-meta">
                  <div>
                    <span>Dải chương</span>
                    <strong>{formatRange(selectedIncident.startChapter, selectedIncident.endChapter)}</strong>
                  </div>
                  <div>
                    <span>Số nhịp</span>
                    <strong>{selectedIncident.events.length}</strong>
                  </div>
                  <div>
                    <span>Độ tin cậy</span>
                    <strong>{formatPercent(selectedIncident.confidence)}</strong>
                  </div>
                  <div>
                    <span>Trạng thái</span>
                    <strong>{selectedIncident.reviewStatus === 'auto_accepted' ? 'Đã tự duyệt' : 'Cần duyệt'}</strong>
                  </div>
                </div>

                <div className="narrative-timeline__beats">
                  <div className="narrative-timeline__beats-head">
                    <strong>Nhịp bên trong</strong>
                    <span>{selectedIncident.events.length} nhịp</span>
                  </div>

                  {selectedIncident.events.length === 0 ? (
                    <div className="narrative-timeline__empty">Chưa có nhịp liên kết.</div>
                  ) : (
                    <div className="narrative-timeline__beats-list">
                      {selectedIncident.events.slice(0, 8).map((event) => (
                        <div key={event.id} className="narrative-timeline__beat-item">
                          <div className="narrative-timeline__beat-copy">
                            <strong>{truncate(resolveEventTitle(event), 92)}</strong>
                            <span>
                              Ch. {toChapter(event.chapter) || '?'} · {event.locationLink?.locationName || 'Chưa rõ địa điểm'}
                            </span>
                          </div>
                          <div className="narrative-timeline__beat-actions">
                            <button type="button" onClick={() => onEdit?.(event)}>Chỉnh sửa</button>
                            <button type="button" onClick={() => onAnnotate?.(event)}>Ghi chú</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function buildChapters(events) {
  const chapterMap = new Map();
  for (const event of events || []) {
    const chapter = toChapter(event.chapter);
    if (!chapter) continue;
    if (!chapterMap.has(chapter)) chapterMap.set(chapter, []);
    chapterMap.get(chapter).push(event);
  }
  return [...chapterMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([chapter, chapterEvents]) => ({ chapter, events: chapterEvents }));
}

function buildIncidentRows(incidents, events) {
  const byEventId = new Map((events || []).filter((item) => item?.id).map((item) => [item.id, item]));
  const fallbackMap = new Map();

  for (const event of events || []) {
    if (!event?.incidentId) continue;
    if (!fallbackMap.has(event.incidentId)) fallbackMap.set(event.incidentId, []);
    fallbackMap.get(event.incidentId).push(event);
  }

  const rows = [];
  for (const incident of incidents || []) {
    const explicitEvents = Array.isArray(incident.containedEvents)
      ? incident.containedEvents.map((id) => byEventId.get(id)).filter(Boolean)
      : [];
    const linkedEvents = (explicitEvents.length ? explicitEvents : (fallbackMap.get(incident.id) || []))
      .sort((left, right) => toChapter(left.chapter) - toChapter(right.chapter));
    const startChapter = toChapter(incident.chapterStart) || toChapter(linkedEvents[0]?.chapter);
    const endChapter = toChapter(incident.chapterEnd) || toChapter(linkedEvents[linkedEvents.length - 1]?.chapter) || startChapter;

    if (!incident?.id || !startChapter) continue;

    rows.push({
      id: incident.id,
      title: incident.title || resolveEventTitle(linkedEvents[0]) || 'Sự kiện lớn chưa đặt tên',
      type: incident.type || 'subplot',
      confidence: Number(incident.confidence || 0),
      reviewStatus: incident.reviewStatus || 'needs_review',
      description: incident.detailedSummary || incident.description || '',
      startChapter,
      endChapter: Math.max(startChapter, endChapter),
      events: linkedEvents,
    });
  }

  return rows.sort((left, right) => {
    if (left.startChapter !== right.startChapter) return left.startChapter - right.startChapter;
    return left.endChapter - right.endChapter;
  });
}

function buildOverviewBuckets(chapterNumbers, chapterEventMap) {
  if (!chapterNumbers.length) return [];
  const bucketSize = Math.max(1, Math.ceil(chapterNumbers.length / 40));
  const buckets = [];
  let max = 1;

  for (let index = 0; index < chapterNumbers.length; index += bucketSize) {
    const slice = chapterNumbers.slice(index, index + bucketSize);
    const count = slice.reduce((sum, chapter) => sum + (chapterEventMap.get(chapter)?.length || 0), 0);
    max = Math.max(max, count);
    buckets.push({
      startChapter: slice[0],
      endChapter: slice[slice.length - 1],
      count,
    });
  }

  return buckets.map((bucket) => ({
    ...bucket,
    height: Math.max(18, Math.round((bucket.count / max) * 100)),
  }));
}

function buildVisibleChapterGroups(visibleChapters, incidents) {
  if (!Array.isArray(visibleChapters) || !visibleChapters.length) return [];

  const groups = [];
  let currentGroup = [];
  let lastChapter = null;

  const membership = new Map();
  for (const chapter of visibleChapters) {
    const incidentIds = incidents
      .filter((item) => chapter >= item.startChapter && chapter <= item.endChapter)
      .map((item) => item.id)
      .sort();
    membership.set(chapter, incidentIds.join('|'));
  }

  for (const chapter of visibleChapters) {
    const currentSignature = membership.get(chapter) || '';
    const previousSignature = lastChapter != null ? membership.get(lastChapter) || '' : '';
    const sameCluster =
      lastChapter != null &&
      chapter === lastChapter + 1 &&
      currentSignature &&
      currentSignature === previousSignature;

    if (!currentGroup.length || sameCluster) {
      currentGroup.push(chapter);
    } else {
      groups.push(currentGroup);
      currentGroup = [chapter];
    }

    lastChapter = chapter;
  }

  if (currentGroup.length) groups.push(currentGroup);

  return groups.map((chapters) => ({
    key: `${chapters[0]}-${chapters[chapters.length - 1]}`,
    chapters,
  }));
}

function getInitialZoom(chapterCount) {
  if (chapterCount > 120) return 'broad';
  if (chapterCount > 36) return 'balanced';
  return 'focused';
}

function toChapter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function resolveEventTitle(event) {
  return event?.title || event?.description || event?.summary || '';
}

function formatRange(startChapter, endChapter) {
  if (startChapter && endChapter && startChapter !== endChapter) return `Ch. ${startChapter} - ${endChapter}`;
  if (startChapter) return `Ch. ${startChapter}`;
  return 'Chưa rõ chương';
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? `${Math.round(numeric * 100)}%` : '--';
}

function truncate(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function findClosestIndex(chapterNumbers, chapter) {
  const index = chapterNumbers.findIndex((item) => item >= chapter);
  return index >= 0 ? index : Math.max(chapterNumbers.length - 1, 0);
}
