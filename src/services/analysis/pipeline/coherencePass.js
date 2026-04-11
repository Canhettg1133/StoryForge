import { calculateSplitScore, shouldMerge } from './mergeSplitRules.js';

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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getRange(incident = {}) {
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

function mergeTwoIncidents(left, right) {
  const [leftStart, leftEnd] = getRange(left);
  const [rightStart, rightEnd] = getRange(right);

  const start = [leftStart, rightStart].filter((value) => value != null);
  const end = [leftEnd, rightEnd].filter((value) => value != null);

  const startChapter = start.length > 0 ? Math.min(...start) : null;
  const endChapter = end.length > 0 ? Math.max(...end) : null;

  const mergedConfidence = Math.max(
    Number(left?.confidence || 0),
    Number(right?.confidence || 0),
  );

  return {
    ...left,
    title: left.title || right.title,
    type: left.type === 'major_plot_point' || right.type === 'major_plot_point'
      ? 'major_plot_point'
      : (left.type || right.type || 'subplot'),
    startChapter,
    endChapter,
    activeSpan: startChapter != null && endChapter != null ? (endChapter - startChapter + 1) : null,
    confidence: Math.max(0, Math.min(1, mergedConfidence)),
    containedEvents: unique([
      ...toArray(left.containedEvents),
      ...toArray(right.containedEvents),
    ]),
    relatedLocations: unique([
      ...toArray(left.relatedLocations),
      ...toArray(right.relatedLocations),
    ]),
    relatedIncidents: unique([
      ...toArray(left.relatedIncidents),
      ...toArray(right.relatedIncidents),
    ]).filter((id) => id !== left.id && id !== right.id),
    causalPredecessors: unique([
      ...toArray(left.causalPredecessors),
      ...toArray(right.causalPredecessors),
    ]).filter((id) => id !== left.id && id !== right.id),
    causalSuccessors: unique([
      ...toArray(left.causalSuccessors),
      ...toArray(right.causalSuccessors),
    ]).filter((id) => id !== left.id && id !== right.id),
    evidence: unique([
      ...toArray(left.evidence),
      ...toArray(right.evidence),
    ]).slice(0, 12),
    boundaryNote: [left.boundaryNote, right.boundaryNote, 'Merged by coherence pass.']
      .filter(Boolean)
      .join('\n'),
    uncertainStart: Boolean(left.uncertainStart || right.uncertainStart),
    uncertainEnd: Boolean(left.uncertainEnd || right.uncertainEnd),
    status: 'merged',
  };
}

function applyAutoMerges(incidents = [], options = {}) {
  const suggestThreshold = Number.isFinite(Number(options.suggestMergeThreshold))
    ? Number(options.suggestMergeThreshold)
    : 0.7;
  const autoThreshold = Number.isFinite(Number(options.autoMergeThreshold))
    ? Number(options.autoMergeThreshold)
    : 0.82;

  const working = [...incidents];
  const removed = new Set();
  const suggestions = [];
  let mergedCount = 0;

  for (let i = 0; i < working.length; i += 1) {
    if (removed.has(working[i].id)) continue;

    for (let j = i + 1; j < working.length; j += 1) {
      if (removed.has(working[j].id)) continue;
      const result = shouldMerge(working[i], working[j], []);

      if (result.decision === 'auto_merge' && result.score >= autoThreshold) {
        working[i] = mergeTwoIncidents(working[i], working[j]);
        removed.add(working[j].id);
        mergedCount += 1;
        continue;
      }

      if (result.decision === 'suggest_merge' && result.score >= suggestThreshold) {
        suggestions.push({
          incident1: working[i].id,
          incident2: working[j].id,
          score: result.score,
        });
      }
    }
  }

  return {
    incidents: working.filter((incident) => !removed.has(incident.id)),
    mergedCount,
    suggestions,
  };
}

function annotateSplitSuggestions(incidents = [], events = []) {
  return incidents.map((incident) => {
    const split = calculateSplitScore(incident, events);
    if (!split.shouldSplit) {
      return incident;
    }

    const splitTag = split.shouldSplit === 'suggest' ? 'SPLIT_SUGGEST' : 'SPLIT_AUTO';
    return {
      ...incident,
      boundaryNote: [incident.boundaryNote, `${splitTag}: ${split.reason || 'Event graph disconnected.'}`]
        .filter(Boolean)
        .join('\n'),
    };
  });
}

function normalizeLocations(locations = []) {
  const buckets = new Map();

  for (const location of locations || []) {
    const key = normalizeText(location?.normalized || location?.name);
    if (!key) continue;

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        ...location,
        aliases: unique([...(location.aliases || []), location.name]),
        eventIds: unique(location.eventIds || []),
        incidentIds: unique(location.incidentIds || []),
      });
      continue;
    }

    existing.aliases = unique([
      ...toArray(existing.aliases),
      ...toArray(location.aliases),
      location.name,
    ]);
    existing.eventIds = unique([
      ...toArray(existing.eventIds),
      ...toArray(location.eventIds),
    ]);
    existing.incidentIds = unique([
      ...toArray(existing.incidentIds),
      ...toArray(location.incidentIds),
    ]);
    existing.mentionCount = Math.max(
      Number(existing.mentionCount || 0),
      Number(location.mentionCount || 0),
      existing.eventIds.length,
    );
    existing.importance = Math.max(
      Number(existing.importance || 0),
      Number(location.importance || 0),
    );
  }

  return [...buckets.values()];
}

function recalculateIncidentScores(incidents = [], events = []) {
  const eventsByIncident = new Map();
  for (const event of events || []) {
    if (!event?.incidentId) continue;
    const list = eventsByIncident.get(event.incidentId) || [];
    list.push(event);
    eventsByIncident.set(event.incidentId, list);
  }

  return incidents.map((incident) => {
    const related = eventsByIncident.get(incident.id) || [];
    const avgSeverity = related.length
      ? related.reduce((sum, event) => sum + (Number(event.severity) || 0), 0) / related.length
      : 0;
    const impact = Math.max(0, Math.min(10, (avgSeverity * 7) + Math.min(3, related.length / 3)));
    const major = Math.max(0, Math.min(10, (impact * 0.8) + (incident.type === 'major_plot_point' ? 2 : 0)));

    return {
      ...incident,
      impactScore: Number(impact.toFixed(3)),
      majorScore: Number(major.toFixed(3)),
      containedEvents: unique([
        ...toArray(incident.containedEvents),
        ...related.map((event) => event.id),
      ]),
    };
  });
}

function fixTimelineOrder(incidents = []) {
  return [...incidents].sort((left, right) => {
    const [leftStart] = getRange(left);
    const [rightStart] = getRange(right);
    if (leftStart == null && rightStart == null) return 0;
    if (leftStart == null) return 1;
    if (rightStart == null) return -1;
    return leftStart - rightStart;
  });
}

function updateEventLinks(events = [], incidents = []) {
  const validIncidentIds = new Set(incidents.map((incident) => incident.id));
  const incidentRanges = incidents.map((incident) => {
    const [start, end] = getRange(incident);
    return { id: incident.id, start, end };
  });

  const findBestIncidentByChapter = (chapter) => {
    if (chapter == null) return null;
    for (const range of incidentRanges) {
      if (range.start == null || range.end == null) continue;
      if (chapter >= range.start && chapter <= range.end) return range.id;
    }
    return null;
  };

  return (events || []).map((event) => {
    const chapter = toNumber(event.chapterIndex ?? event.chapter, null);
    const incidentId = validIncidentIds.has(event.incidentId)
      ? event.incidentId
      : (findBestIncidentByChapter(chapter) || null);

    return {
      ...event,
      incidentId,
    };
  });
}

export function coherencePass(incidents = [], events = [], locations = [], options = {}) {
  const merged = applyAutoMerges(incidents, options);
  const withSplitSuggestions = annotateSplitSuggestions(merged.incidents, events);
  const orderedIncidents = fixTimelineOrder(withSplitSuggestions);
  const updatedEvents = updateEventLinks(events, orderedIncidents);
  const normalizedLocations = normalizeLocations(locations);
  const scoredIncidents = recalculateIncidentScores(orderedIncidents, updatedEvents);

  return {
    incidents: scoredIncidents,
    events: updatedEvents,
    locations: normalizedLocations,
    changes: {
      merged: merged.mergedCount,
      splitSuggestions: scoredIncidents.filter((incident) => String(incident.boundaryNote || '').includes('SPLIT_')).length,
      normalizedLocations: Math.max(0, locations.length - normalizedLocations.length),
      mergeSuggestions: merged.suggestions,
    },
  };
}
