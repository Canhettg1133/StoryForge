import { randomUUID } from 'node:crypto';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEventChapter(event) {
  return toNumber(event?.chapterIndex ?? event?.chapter, null);
}

function buildIndex(events = []) {
  const index = new Map();
  for (const event of events || []) {
    if (!event?.id) continue;
    index.set(event.id, event);
  }
  return index;
}

export function checkTimelineInversion(_incidents = [], events = []) {
  const risks = [];
  const eventIndex = buildIndex(events);

  for (const event of events || []) {
    if (!event?.id) continue;

    const eventChapter = getEventChapter(event);
    const causes = Array.isArray(event?.causalLinks?.causes) ? event.causalLinks.causes : [];
    const causedBy = Array.isArray(event?.causalLinks?.causedBy) ? event.causalLinks.causedBy : [];

    for (const causeId of [...causes, ...causedBy]) {
      const causeEvent = eventIndex.get(causeId);
      if (!causeEvent) continue;

      const causeChapter = getEventChapter(causeEvent);
      if (causeChapter == null || eventChapter == null) continue;

      if (causeChapter > eventChapter) {
        risks.push({
          id: `risk_${randomUUID()}`,
          type: 'timeline_inversion',
          severity: 'hard',
          description: `Cause event happens after effect (${causeChapter} > ${eventChapter}).`,
          details: {
            causeEventId: causeEvent.id,
            effectEventId: event.id,
            causeChapter,
            effectChapter: eventChapter,
          },
          involvedEvents: [causeEvent.id, event.id],
          involvedIncidents: [causeEvent.incidentId, event.incidentId].filter(Boolean),
          involvedLocations: [],
          evidence: [
            String(causeEvent.description || causeEvent.title || '').slice(0, 200),
            String(event.description || event.title || '').slice(0, 200),
          ].filter(Boolean),
          chapterRange: [Math.min(causeChapter, eventChapter), Math.max(causeChapter, eventChapter)],
        });
      }
    }
  }

  return risks;
}
