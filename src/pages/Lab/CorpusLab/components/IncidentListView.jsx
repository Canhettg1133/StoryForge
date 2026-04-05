import { useMemo, useState } from 'react';
import IncidentCard from './IncidentCard.jsx';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function IncidentListView({
  incidents = [],
  events = [],
  onIncidentClick,
  onUpdateIncident,
}) {
  const [sortBy, setSortBy] = useState('chapter');
  const [filterType, setFilterType] = useState('all');
  const [expandedIncidents, setExpandedIncidents] = useState(new Set());

  const eventMap = useMemo(() => {
    const byId = new Map();
    for (const event of events || []) {
      if (!event?.id) continue;
      byId.set(event.id, event);
    }
    return byId;
  }, [events]);

  const eventsByIncident = useMemo(() => {
    const map = new Map();

    for (const incident of incidents || []) {
      const eventIds = Array.isArray(incident?.containedEvents) ? incident.containedEvents : [];
      if (eventIds.length > 0) {
        map.set(
          incident.id,
          eventIds.map((eventId) => eventMap.get(eventId)).filter(Boolean),
        );
      }
    }

    for (const event of events || []) {
      if (!event?.incidentId) continue;
      const list = map.get(event.incidentId) || [];
      if (!list.find((item) => item.id === event.id)) {
        list.push(event);
      }
      map.set(event.incidentId, list);
    }

    return map;
  }, [eventMap, events, incidents]);

  const displayIncidents = useMemo(() => {
    const filtered = filterType === 'all'
      ? [...incidents]
      : incidents.filter((incident) => incident.type === filterType);

    return filtered.sort((left, right) => {
      if (sortBy === 'chapter') {
        return toNumber(left.startChapter, Number.MAX_SAFE_INTEGER) - toNumber(right.startChapter, Number.MAX_SAFE_INTEGER);
      }
      if (sortBy === 'confidence') {
        return toNumber(right.confidence, 0) - toNumber(left.confidence, 0);
      }
      if (sortBy === 'severity') {
        return toNumber(right.majorScore, 0) - toNumber(left.majorScore, 0);
      }
      return 0;
    });
  }, [filterType, incidents, sortBy]);

  const toggleExpand = (incidentId) => {
    setExpandedIncidents((prev) => {
      const next = new Set(prev);
      if (next.has(incidentId)) next.delete(incidentId);
      else next.add(incidentId);
      return next;
    });
  };

  if (!displayIncidents.length) {
    return (
      <div className="incident-list-empty">
        <h3>Chưa có incident</h3>
        <p>Hệ thống chưa tìm được incident phù hợp với bộ lọc hiện tại.</p>
      </div>
    );
  }

  return (
    <section className="incident-list-view">
      <div className="incident-list-toolbar">
        <div className="incident-list-control">
          <label htmlFor="incident-filter-type">Loại incident</label>
          <select
            id="incident-filter-type"
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="major_plot_point">Major plot point</option>
            <option value="subplot">Subplot</option>
            <option value="pov_thread">POV thread</option>
          </select>
        </div>

        <div className="incident-list-control">
          <label htmlFor="incident-sort-by">Sắp xếp</label>
          <select
            id="incident-sort-by"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="chapter">Theo chương</option>
            <option value="confidence">Theo độ tin cậy</option>
            <option value="severity">Theo mức quan trọng</option>
          </select>
        </div>
      </div>

      <div className="incident-list-grid">
        {displayIncidents.map((incident) => {
          const incidentEvents = eventsByIncident.get(incident.id) || [];

          return (
            <IncidentCard
              key={incident.id}
              incident={{ ...incident, eventCount: incidentEvents.length }}
              events={incidentEvents}
              expanded={expandedIncidents.has(incident.id)}
              onToggle={() => toggleExpand(incident.id)}
              onOpen={onIncidentClick}
              onUpdate={onUpdateIncident}
            />
          );
        })}
      </div>
    </section>
  );
}
