import { randomUUID } from 'node:crypto';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getIncidentRange(incident = {}) {
  const start = toNumber(
    incident.startChapter
    ?? incident.chapterStart
    ?? incident.chapterStartIndex
    ?? incident.chapterRange?.[0],
    null,
  );
  const end = toNumber(
    incident.endChapter
    ?? incident.chapterEnd
    ?? incident.chapterEndIndex
    ?? incident.chapterRange?.[1],
    start,
  );

  if (start == null || end == null) return [null, null];
  return [Math.min(start, end), Math.max(start, end)];
}

function buildRisk({
  type = 'span_anomaly',
  severity = 'soft',
  description = 'Span anomaly detected.',
  details = {},
  involvedIncidents = [],
  involvedEvents = [],
  evidence = [],
  chapterRange = [null, null],
}) {
  return {
    id: `risk_${randomUUID()}`,
    type,
    severity,
    description,
    details,
    involvedIncidents,
    involvedEvents,
    involvedLocations: [],
    evidence,
    chapterRange,
  };
}

export function checkSpanAnomalies(incidents = [], events = []) {
  const risks = [];

  for (const incident of incidents || []) {
    if (!incident?.id) continue;
    const [start, end] = getIncidentRange(incident);
    if (start == null || end == null) continue;

    const span = Math.max(1, end - start + 1);
    const containedEvents = (events || []).filter((event) => event?.incidentId === incident.id);
    const eventDensity = containedEvents.length / span;

    if (span >= 14 && eventDensity < 0.25) {
      risks.push(buildRisk({
        severity: 'medium',
        description: `Incident span is too wide for event density (${containedEvents.length}/${span}).`,
        details: {
          incidentId: incident.id,
          span,
          eventCount: containedEvents.length,
          density: Number(eventDensity.toFixed(4)),
        },
        involvedIncidents: [incident.id],
        involvedEvents: containedEvents.map((event) => event.id).slice(0, 10),
        chapterRange: [start, end],
      }));
    }

    if ((incident?.uncertainStart || incident?.uncertainEnd) && span <= 1) {
      risks.push(buildRisk({
        severity: 'soft',
        description: 'Boundary uncertainty on very short incident span.',
        details: {
          incidentId: incident.id,
          span,
          uncertainStart: Boolean(incident?.uncertainStart),
          uncertainEnd: Boolean(incident?.uncertainEnd),
        },
        involvedIncidents: [incident.id],
        involvedEvents: containedEvents.map((event) => event.id).slice(0, 10),
        chapterRange: [start, end],
      }));
    }
  }

  return risks;
}
