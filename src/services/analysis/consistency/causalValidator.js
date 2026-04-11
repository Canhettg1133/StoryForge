import { randomUUID } from 'node:crypto';

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildEventIndex(events = []) {
  const map = new Map();
  for (const event of events || []) {
    if (!event?.id) continue;
    map.set(event.id, event);
  }
  return map;
}

function createRisk(payload = {}) {
  return {
    id: `risk_${randomUUID()}`,
    type: payload.type || 'missing_prerequisite',
    severity: payload.severity || 'medium',
    description: payload.description || 'Causal consistency issue.',
    details: payload.details || {},
    involvedEvents: payload.involvedEvents || [],
    involvedIncidents: payload.involvedIncidents || [],
    involvedLocations: payload.involvedLocations || [],
    evidence: payload.evidence || [],
    chapterRange: payload.chapterRange || [null, null],
  };
}

export function checkMissingPrerequisites(events = []) {
  const eventIndex = buildEventIndex(events);
  const risks = [];

  for (const event of events || []) {
    const chapter = toNumber(event?.chapterIndex ?? event?.chapter, null);
    const causedBy = toArray(event?.causalLinks?.causedBy);

    for (const causeId of causedBy) {
      const causeEvent = eventIndex.get(causeId);
      if (causeEvent) continue;

      risks.push(createRisk({
        type: 'missing_prerequisite',
        severity: 'medium',
        description: `Event references missing prerequisite: ${causeId}.`,
        details: {
          eventId: event.id,
          missingCauseId: causeId,
        },
        involvedEvents: [event.id],
        involvedIncidents: [event.incidentId].filter(Boolean),
        evidence: [String(event.description || event.title || '').slice(0, 200)].filter(Boolean),
        chapterRange: [chapter, chapter],
      }));
    }

    if (causedBy.length === 0 && /because|therefore|as a result|hence/iu.test(String(event?.description || ''))) {
      risks.push(createRisk({
        type: 'missing_prerequisite',
        severity: 'soft',
        description: 'Event text implies causality but has no prerequisite links.',
        details: { eventId: event.id },
        involvedEvents: [event.id],
        involvedIncidents: [event.incidentId].filter(Boolean),
        evidence: [String(event.description || event.title || '').slice(0, 200)].filter(Boolean),
        chapterRange: [chapter, chapter],
      }));
    }
  }

  return risks;
}

export function checkImpossibleCoLocation(events = [], incidents = []) {
  const risks = [];
  const byCharacterChapter = new Map();

  for (const event of events || []) {
    const chapter = toNumber(event?.chapterIndex ?? event?.chapter, null);
    if (chapter == null) continue;
    if (!Array.isArray(event?.characters) || event.characters.length === 0) continue;

    const locationId = event?.locationLink?.locationId || event?.locationLink?.locationName || null;
    if (!locationId) continue;

    for (const character of event.characters) {
      const key = `${character}::${chapter}`;
      const list = byCharacterChapter.get(key) || [];
      list.push({
        eventId: event.id,
        incidentId: event.incidentId,
        locationId: String(locationId),
        description: String(event.description || event.title || '').slice(0, 200),
      });
      byCharacterChapter.set(key, list);
    }
  }

  for (const [key, items] of byCharacterChapter.entries()) {
    if (items.length < 2) continue;
    const locationSet = new Set(items.map((item) => item.locationId));
    if (locationSet.size <= 1) continue;

    const chapter = Number(key.split('::')[1]);
    const incidentIds = toArray(items.map((item) => item.incidentId));

    risks.push(createRisk({
      type: 'impossible_co_location',
      severity: 'hard',
      description: `Character appears in multiple locations in the same chapter (${chapter}).`,
      details: {
        chapter,
        locations: [...locationSet],
      },
      involvedEvents: items.map((item) => item.eventId),
      involvedIncidents: incidentIds.filter(Boolean),
      evidence: items.map((item) => item.description).filter(Boolean).slice(0, 4),
      chapterRange: [chapter, chapter],
    }));
  }

  const incidentIds = new Set((incidents || []).map((item) => item.id));
  return risks.filter((risk) => risk.involvedIncidents.every((id) => !id || incidentIds.has(id)));
}
