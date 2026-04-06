import { randomUUID } from 'node:crypto';
import { normalizeIncident } from './models/incident.js';
import { normalizeEvent } from './models/event.js';
import { normalizeLocation } from './models/location.js';
import { normalizeConsistencyRisk } from './models/consistencyRisk.js';
import { incidentFirstRepository } from './repositories/incidentFirstRepository.js';

const EVENT_COLLECTION_KEYS = [
  'majorEvents',
  'major',
  'major_events',
  'minorEvents',
  'minor',
  'minor_events',
  'plotTwists',
  'twists',
  'plot_twists',
  'cliffhangers',
  'cliffhanger',
  'cliff_hangers',
];

const NESTED_EVENT_KEYS = ['subevents', 'subEvents', 'children'];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function parseChapter(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,4})/u);
    if (m) return Number(m[1]);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveEventTitle(event) {
  return String(
    event.title
    || event.name
    || event.description
    || event.summary
    || event.event
    || 'Untitled event',
  ).trim();
}

function resolveEventDescription(event) {
  return String(
    event.description
    || event.summary
    || event.title
    || event.name
    || '',
  ).trim();
}

function flattenEvents(eventsLayer = {}, result = []) {
  const layer = toObject(eventsLayer);
  const keys = new Set(EVENT_COLLECTION_KEYS);

  for (const [key, value] of Object.entries(layer)) {
    if (!Array.isArray(value)) continue;
    const lower = key.toLowerCase();
    if (lower.includes('event') || lower.includes('twist') || lower.includes('cliff')) {
      keys.add(key);
    }
  }

  const visit = (event) => {
    if (!event || typeof event !== 'object') return;

    result.push(event);
    for (const key of NESTED_EVENT_KEYS) {
      if (!Array.isArray(event[key])) continue;
      for (const child of event[key]) visit(child);
    }
  };

  for (const key of keys) {
    for (const event of toArray(layer[key])) {
      visit(event);
    }
  }

  return result;
}

function mapIncidents(incidents, { corpusId, analysisId }) {
  return toArray(incidents)
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const chapterStartIndex = parseChapter(
        item.chapterStartIndex ?? item.chapterStart ?? item.startChapter ?? item.chapterRange?.[0],
      );
      const chapterEndIndex = parseChapter(
        item.chapterEndIndex ?? item.chapterEnd ?? item.endChapter ?? item.chapterRange?.[1],
      );

      return normalizeIncident({
        ...item,
        id: item.id || `inc_${randomUUID()}`,
        corpusId,
        analysisId,
        chapterStartIndex,
        chapterEndIndex,
        chapterStartNumber: chapterStartIndex,
        chapterEndNumber: chapterEndIndex,
        confidence: Number(item.confidence ?? 0),
        evidence: item.evidence || (item.evidenceSnippet ? [item.evidenceSnippet] : []),
        containedEvents: item.containedEvents || item.eventIds || [],
        relatedLocations: item.relatedLocations
          || (item.location?.id ? [item.location.id] : []),
        provenance: item.provenance || {
          sourcePass: 'materialized_result',
          reviewStatus: item.reviewStatus || 'needs_review',
        },
      });
    });
}

function mapEvents(rawEvents, incidents, { corpusId, analysisId }) {
  const incidentByEventId = new Map();
  for (const incident of incidents) {
    const eventIds = toArray(incident.containedEvents);
    for (const eventId of eventIds) {
      if (!incidentByEventId.has(eventId)) {
        incidentByEventId.set(eventId, incident.id);
      }
    }
  }

  const uniqueById = new Map();
  for (const event of rawEvents) {
    const id = String(event?.id || '').trim() || `evt_${randomUUID()}`;
    if (!uniqueById.has(id)) {
      uniqueById.set(id, event);
    }
  }

  return [...uniqueById.entries()].map(([id, item]) => {
    const chapterIndex = parseChapter(
      item.chapterIndex ?? item.chapter ?? item.grounding?.chapterIndex,
    );
    const chunkIndex = Number.isFinite(Number(item.chunkIndex ?? item.grounding?.chunkIndex))
      ? Number(item.chunkIndex ?? item.grounding?.chunkIndex)
      : null;

    return normalizeEvent({
      ...item,
      id,
      corpusId,
      analysisId,
      title: resolveEventTitle(item),
      description: resolveEventDescription(item),
      chapterId: item.chapterId || item.grounding?.chapterId || null,
      chapterIndex,
      chapterNumber: chapterIndex,
      chunkId: item.chunkId || item.grounding?.chunkId || null,
      chunkIndex,
      incidentId: item.incidentId || incidentByEventId.get(id) || null,
      confidence: Number(item.confidence ?? item.chapterConfidence ?? 0),
      evidence: item.evidence || (item.grounding?.evidenceSnippet ? [item.grounding.evidenceSnippet] : []),
      locationLink: item.locationLink || null,
      causalLinks: item.causalLinks || { causes: [], causedBy: [] },
      qualityProxy: Number(item.qualityProxy ?? item.quality?.score ?? 0),
      reviewStatus: item.reviewStatus || (item.needsReview ? 'needs_review' : 'auto_accepted'),
      needsReview: Boolean(item.needsReview),
      groundedAt: item.groundedAt || null,
      provenance: item.provenance || {
        sourcePass: 'materialized_result',
        reviewStatus: item.reviewStatus || (item.needsReview ? 'needs_review' : 'auto_accepted'),
      },
    });
  });
}

function mapLocations(locations, events, { corpusId, analysisId }) {
  const direct = toArray(locations)
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeLocation({
      ...item,
      id: item.id || `loc_${randomUUID()}`,
      corpusId,
      analysisId,
      incidentIds: item.incidentIds || [],
      eventIds: item.eventIds || [],
      chapterSpread: item.chapterSpread || [item.chapterStart ?? null, item.chapterEnd ?? null],
    }));

  if (direct.length > 0) {
    return direct;
  }

  // Fallback: derive location entities from event.locationLink.
  const buckets = new Map();
  for (const event of events) {
    const link = event?.locationLink;
    if (!link?.locationName && !link?.locationId) continue;

    const key = String(link.locationId || link.locationName).trim();
    if (!key) continue;

    const existing = buckets.get(key) || {
      id: link.locationId || `loc_${randomUUID()}`,
      corpusId,
      analysisId,
      name: String(link.locationName || 'Unknown location').trim(),
      confidenceSamples: [],
      evidence: [],
      eventIds: [],
      incidentIds: [],
      chapters: [],
    };

    existing.eventIds.push(event.id);
    if (event.incidentId) existing.incidentIds.push(event.incidentId);
    if (Number.isFinite(Number(event.chapterIndex))) existing.chapters.push(Number(event.chapterIndex));
    if (Number.isFinite(Number(link.confidence))) existing.confidenceSamples.push(Number(link.confidence));
    if (link.evidenceSnippet) existing.evidence.push(String(link.evidenceSnippet));
    buckets.set(key, existing);
  }

  return [...buckets.values()].map((item) => {
    const chapterStart = item.chapters.length ? Math.min(...item.chapters) : null;
    const chapterEnd = item.chapters.length ? Math.max(...item.chapters) : null;
    const avgConfidence = item.confidenceSamples.length
      ? item.confidenceSamples.reduce((sum, x) => sum + x, 0) / item.confidenceSamples.length
      : 0;

    return normalizeLocation({
      ...item,
      mentionCount: item.eventIds.length,
      chapterStart,
      chapterEnd,
      chapterStartNumber: chapterStart,
      chapterEndNumber: chapterEnd,
      chapterSpread: [chapterStart, chapterEnd],
      eventIds: [...new Set(item.eventIds)],
      incidentIds: [...new Set(item.incidentIds)],
      confidence: avgConfidence,
      evidenceStrength: avgConfidence,
      evidence: [...new Set(item.evidence)].slice(0, 8),
      importance: Math.min(1, item.eventIds.length / 10),
      isMajor: item.eventIds.length >= 3,
      reviewStatus: avgConfidence >= 0.8 ? 'auto_accepted' : 'needs_review',
      provenance: item.provenance || {
        sourcePass: 'materialized_result',
        reviewStatus: avgConfidence >= 0.8 ? 'auto_accepted' : 'needs_review',
      },
    });
  });
}

function mapConsistencyRisks(consistencyRisks, { corpusId, analysisId }) {
  return toArray(consistencyRisks)
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeConsistencyRisk({
      ...item,
      id: item.id || `risk_${randomUUID()}`,
      corpusId,
      analysisId,
    }));
}

export async function persistIncidentFirstArtifacts({
  corpusId,
  analysisId,
  result = {},
  pipelineOptions = {},
} = {}) {
  if (!corpusId || !analysisId || !result || typeof result !== 'object') {
    return {
      persisted: false,
      reason: 'Missing corpusId/analysisId/result.',
    };
  }

  const incidents = mapIncidents(result.incidents, { corpusId, analysisId });
  const rawEvents = flattenEvents(result.events || {});
  const events = mapEvents(rawEvents, incidents, { corpusId, analysisId });
  const locations = mapLocations(result.locations, events, { corpusId, analysisId });
  const mappedConsistencyRisks = mapConsistencyRisks(result.consistencyRisks || result.consistency_risks, {
    corpusId,
    analysisId,
  });
  const finalIncidents = incidents;
  const finalEvents = events;
  const finalLocations = locations;
  const consistencyRisks = mappedConsistencyRisks;
  const reviewQueue = toArray(result.reviewQueue || result.review_queue).map((item) => ({
    ...item,
    id: item.id || `rq_${randomUUID()}`,
    corpusId,
    analysisId,
  }));

  await incidentFirstRepository.replaceArtifacts({
    corpusId,
    analysisId,
    incidents: finalIncidents,
    events: finalEvents,
    locations: finalLocations,
    consistencyRisks,
    reviewQueue,
  });

  return {
    persisted: true,
    counts: {
      incidents: finalIncidents.length,
      events: finalEvents.length,
      locations: finalLocations.length,
      consistencyRisks: consistencyRisks.length,
      reviewQueue: reviewQueue.length,
    },
    sourceOfTruth: 'analysis_run_artifact',
  };
}
