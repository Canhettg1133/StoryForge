function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
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

function collectIncidentEvents(incident, events = []) {
  const [start, end] = getIncidentRange(incident);

  return (events || []).filter((event) => {
    if (!event || typeof event !== 'object') return false;
    if (event.incidentId && event.incidentId === incident.id) return true;

    const chapter = toNumber(event.chapterIndex ?? event.chapter, null);
    if (chapter == null || start == null || end == null) return false;

    return chapter >= start && chapter <= end;
  });
}

function collectIncidentLocations(incidentEvents = [], locations = []) {
  const byId = new Map();
  for (const location of locations || []) {
    if (!location?.id) continue;
    byId.set(location.id, location);
  }

  const locationIds = new Set();

  for (const event of incidentEvents) {
    if (event?.locationLink?.locationId) {
      locationIds.add(String(event.locationLink.locationId));
    }

    for (const loc of (locations || [])) {
      if (!Array.isArray(loc?.eventIds)) continue;
      if (loc.eventIds.includes(event?.id)) {
        locationIds.add(String(loc.id));
      }
    }
  }

  return [...locationIds].map((id) => byId.get(id)).filter(Boolean);
}

function normalizeCausalLinks(links) {
  if (!links || typeof links !== 'object') {
    return { causes: [], causedBy: [] };
  }

  return {
    causes: unique(toArray(links.causes)),
    causedBy: unique(toArray(links.causedBy)),
  };
}

function normalizeEvent(event, incidentId) {
  return {
    ...event,
    incidentId,
    causalLinks: normalizeCausalLinks(event?.causalLinks),
    evidence: toArray(event?.evidence).map((item) => String(item || '').trim()).filter(Boolean),
    chapterIndex: toNumber(event?.chapterIndex ?? event?.chapter, null),
  };
}

export function analyzeSingleIncident(incident, context = {}, options = {}) {
  const events = toArray(context.events);
  const locations = toArray(context.locations);

  const incidentEvents = collectIncidentEvents(incident, events)
    .map((event) => normalizeEvent(event, incident.id))
    .sort((a, b) => (a.chapterIndex ?? Number.MAX_SAFE_INTEGER) - (b.chapterIndex ?? Number.MAX_SAFE_INTEGER));

  const incidentLocations = collectIncidentLocations(incidentEvents, locations);

  const incidentEventIds = unique(incidentEvents.map((event) => event.id));
  const relatedLocationIds = unique(incidentLocations.map((location) => location.id));

  const withLinks = incidentEvents.map((event) => ({
    ...event,
    secondaryIncidentIds: unique([
      ...(toArray(event.secondaryIncidentIds)),
      ...(event.incidentId && event.incidentId !== incident.id ? [event.incidentId] : []),
    ]),
    linkRole: event.incidentId === incident.id ? 'primary' : (event.linkRole || 'secondary'),
  }));

  return {
    incident: {
      ...incident,
      status: 'completed',
      analyzedAt: Date.now(),
      containedEvents: incidentEventIds,
      relatedLocations: relatedLocationIds,
      activeSpan: incident.activeSpan
        || (
          incident.startChapter != null && incident.endChapter != null
            ? (incident.endChapter - incident.startChapter + 1)
            : incident.activeSpan
        )
        || Math.max(1, withLinks.length ? 1 : 0),
      description: incident.description
        || (withLinks[0]?.description ? withLinks[0].description.slice(0, 180) : ''),
    },
    events: withLinks,
    locations: incidentLocations,
    causalLinks: withLinks.flatMap((event) => (
      (event.causalLinks?.causes || []).map((targetId) => ({
        from: event.id,
        to: targetId,
        incidentId: incident.id,
      }))
    )),
  };
}

export function analyzeIncidents(incidents = [], context = {}, options = {}) {
  const incidentList = toArray(incidents);
  const eventIndex = new Map();
  const locationIndex = new Map();
  const analyzedIncidents = [];
  const causalLinks = [];

  for (const incident of incidentList) {
    const single = analyzeSingleIncident(incident, context, options);
    analyzedIncidents.push(single.incident);

    for (const event of single.events) {
      if (!event?.id) continue;
      const existing = eventIndex.get(event.id);
      if (!existing) {
        eventIndex.set(event.id, event);
        continue;
      }

      const mergedIncidentIds = unique([
        existing.incidentId,
        event.incidentId,
        ...toArray(existing.secondaryIncidentIds),
        ...toArray(event.secondaryIncidentIds),
      ]);

      eventIndex.set(event.id, {
        ...existing,
        ...event,
        incidentId: existing.incidentId || event.incidentId,
        secondaryIncidentIds: mergedIncidentIds.filter((id) => id && id !== (existing.incidentId || event.incidentId)),
      });
    }

    for (const location of single.locations) {
      if (!location?.id) continue;
      if (!locationIndex.has(location.id)) {
        locationIndex.set(location.id, location);
      }
    }

    causalLinks.push(...single.causalLinks);
  }

  return {
    incidents: analyzedIncidents,
    events: [...eventIndex.values()],
    locations: [...locationIndex.values()],
    causalLinks,
  };
}
