export const MERGE_THRESHOLDS = {
  auto: 0.82,
  suggest: 0.70,
  no: 0.70,
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value, min)));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getIncidentChapterRange(incident = {}) {
  const start = toNumber(
    incident.chapterStartIndex
    ?? incident.startChapter
    ?? incident.chapterStart
    ?? incident.chapterRange?.[0],
    null,
  );
  const end = toNumber(
    incident.chapterEndIndex
    ?? incident.endChapter
    ?? incident.chapterEnd
    ?? incident.chapterRange?.[1],
    null,
  );
  if (start == null || end == null) return [null, null];
  return [Math.min(start, end), Math.max(start, end)];
}

export function calculateChapterOverlap(inc1, inc2) {
  const [aStart, aEnd] = getIncidentChapterRange(inc1);
  const [bStart, bEnd] = getIncidentChapterRange(inc2);
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) {
    return 0;
  }

  const intersection = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1);
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart) + 1;
  return clamp(intersection / Math.max(1, union));
}

export function calculateTitleSimilarity(titleA, titleB) {
  const aTokens = new Set(normalizeText(titleA).split(' ').filter((item) => item.length >= 2));
  const bTokens = new Set(normalizeText(titleB).split(' ').filter((item) => item.length >= 2));
  if (!aTokens.size || !bTokens.size) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = aTokens.size + bTokens.size - intersection;
  return clamp(intersection / Math.max(1, union));
}

export function hasHardNoMergeConditions(inc1, inc2) {
  if (!inc1 || !inc2) return false;

  const [aStart, aEnd] = getIncidentChapterRange(inc1);
  const [bStart, bEnd] = getIncidentChapterRange(inc2);
  const overlap = (
    aStart != null
    && aEnd != null
    && bStart != null
    && bEnd != null
    && Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)
  );
  const conflictingOutcome = (
    normalizeText(inc1.outcome) && normalizeText(inc2.outcome)
    && normalizeText(inc1.outcome) !== normalizeText(inc2.outcome)
    && normalizeText(inc1.climaxAnchor?.chapterId || inc1.climaxAnchor?.chunkId)
    && normalizeText(inc1.climaxAnchor?.chapterId || inc1.climaxAnchor?.chunkId)
      === normalizeText(inc2.climaxAnchor?.chapterId || inc2.climaxAnchor?.chunkId)
  );
  const povConflict = (
    normalizeText(inc1.povLane || inc1.pov) && normalizeText(inc2.povLane || inc2.pov)
    && normalizeText(inc1.povLane || inc1.pov) !== normalizeText(inc2.povLane || inc2.pov)
    && !(
      unique(inc1.causalSuccessors || []).includes(inc2.id)
      || unique(inc2.causalSuccessors || []).includes(inc1.id)
      || unique(inc1.relatedIncidents || []).includes(inc2.id)
      || unique(inc2.relatedIncidents || []).includes(inc1.id)
    )
  );

  return (overlap && povConflict) || conflictingOutcome || Boolean(inc1.noMerge || inc2.noMerge);
}

export function calculateMergeScore(inc1, inc2, causalBridges = []) {
  const overlap = calculateChapterOverlap(inc1, inc2);
  const titleSim = calculateTitleSimilarity(inc1?.title, inc2?.title);

  const eventsA = unique(inc1?.containedEvents || inc1?.eventIds || []);
  const eventsB = unique(inc2?.containedEvents || inc2?.eventIds || []);
  const sharedEvents = eventsA.filter((eventId) => eventsB.includes(eventId));
  const eventSim = sharedEvents.length / Math.max(1, Math.max(eventsA.length, eventsB.length));

  const locationsA = unique(inc1?.relatedLocations || inc1?.locationIds || []);
  const locationsB = unique(inc2?.relatedLocations || inc2?.locationIds || []);
  const sameLocation = locationsA.some((loc) => locationsB.includes(loc)) ? 1 : 0;

  const hasBridge = (causalBridges || []).some((bridge) => (
    (bridge?.from === inc1?.id && bridge?.to === inc2?.id)
    || (bridge?.from === inc2?.id && bridge?.to === inc1?.id)
  )) ? 1 : 0;

  const weighted = (
    overlap * 0.30
    + titleSim * 0.25
    + eventSim * 0.25
    + sameLocation * 0.10
    + hasBridge * 0.10
  );

  return clamp(weighted);
}

export function shouldMerge(inc1, inc2, causalBridges = []) {
  if (hasHardNoMergeConditions(inc1, inc2)) {
    return {
      decision: 'hard_no',
      score: 0,
      reason: 'Hard no-merge condition detected.',
    };
  }

  const score = calculateMergeScore(inc1, inc2, causalBridges);

  if (score >= MERGE_THRESHOLDS.auto) {
    return { decision: 'auto_merge', score };
  }
  if (score >= MERGE_THRESHOLDS.suggest) {
    return { decision: 'suggest_merge', score };
  }
  return { decision: 'no_merge', score };
}

function buildCausalGraph(events = []) {
  const graph = new Map();

  for (const event of events) {
    const id = String(event?.id || '').trim();
    if (!id) continue;
    if (!graph.has(id)) graph.set(id, new Set());
  }

  for (const event of events) {
    const id = String(event?.id || '').trim();
    if (!id || !graph.has(id)) continue;

    const causes = Array.isArray(event?.causalLinks?.causes)
      ? event.causalLinks.causes
      : [];
    const causedBy = Array.isArray(event?.causalLinks?.causedBy)
      ? event.causalLinks.causedBy
      : [];

    for (const neighbor of [...causes, ...causedBy]) {
      if (!graph.has(neighbor)) continue;
      graph.get(id).add(neighbor);
      graph.get(neighbor).add(id);
    }
  }

  return graph;
}

function findConnectedComponents(graph) {
  const visited = new Set();
  const components = [];

  for (const node of graph.keys()) {
    if (visited.has(node)) continue;
    const queue = [node];
    const component = [];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);
      for (const neighbor of graph.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
}

export function findSplitPoints(incident, events = []) {
  const incidentEvents = (events || []).filter((event) => event?.incidentId === incident?.id);
  if (incidentEvents.length < 3) {
    return { shouldSplit: false, clusters: [], splitScore: 0 };
  }

  const graph = buildCausalGraph(incidentEvents);
  const components = findConnectedComponents(graph);

  if (components.length > 1) {
    return {
      shouldSplit: true,
      clusters: components,
      splitScore: clamp(1 - (1 / components.length)),
    };
  }

  return { shouldSplit: false, clusters: [], splitScore: 0 };
}

export function calculateSplitScore(incident, events = []) {
  const incidentEvents = (events || []).filter((event) => event?.incidentId === incident?.id);
  if (!incidentEvents.length) {
    return { shouldSplit: false, score: 0 };
  }

  const [start, end] = getIncidentChapterRange(incident);
  const activeSpan = (
    start != null
    && end != null
    && end >= start
  )
    ? (end - start + 1)
    : Math.max(1, toNumber(incident?.activeSpan, 1));

  const density = incidentEvents.length / Math.max(1, activeSpan);
  if (density < 0.5 && activeSpan > 10) {
    return {
      shouldSplit: 'suggest',
      score: clamp(1 - density),
      reason: 'Low event density over long span.',
    };
  }

  return { shouldSplit: false, score: 0 };
}
