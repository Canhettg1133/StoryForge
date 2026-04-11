import { randomUUID } from 'node:crypto';
import { normalizeIncident } from './models/incident.js';
import { normalizeEvent } from './models/event.js';
import { normalizeLocation } from './models/location.js';
import { normalizeConsistencyRisk } from './models/consistencyRisk.js';
import { analysisRepository } from './repositories/analysisRepository.js';
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

function mapV3Incidents(incidents, { corpusId, analysisId }) {
  return toArray(incidents).map((item) => normalizeIncident({
    ...item,
    corpusId,
    analysisId,
    chapterStartIndex: parseChapter(item.chapterStart ?? item.chapterStartNumber),
    chapterEndIndex: parseChapter(item.chapterEnd ?? item.chapterEndNumber),
    chapterStartNumber: parseChapter(item.chapterStart ?? item.chapterStartNumber),
    chapterEndNumber: parseChapter(item.chapterEnd ?? item.chapterEndNumber),
    description: item.detailedSummary || item.detailed_summary || item.summary || item.description || '',
    evidence: item.primaryEvidenceRefs || item.primary_evidence_refs || item.evidence || [],
    boundaryNote: item.lineage?.decision_reason || item.boundaryNote || '',
    provenance: item.provenance || {
      sourcePass: 'artifact_v3',
      reviewStatus: item.reviewStatus || 'needs_review',
      lineage: item.lineage || {},
      rerunScope: item.rerunScope || item.rerun_scope || {},
    },
  }));
}

function mapV3Events(beats, incidents, { corpusId, analysisId }) {
  const incidentById = new Map(toArray(incidents).map((item) => [item.id, item]));
  return toArray(beats).map((item) => {
    const incident = incidentById.get(item.incidentId);
    const chapterNumber = parseChapter(item.chapterNumber ?? item.chapter);
    return normalizeEvent({
      id: item.sourceEventId || item.id || `evt_${randomUUID()}`,
      corpusId,
      analysisId,
      title: item.summary || `Beat ${item.sequence || 0}`,
      description: item.summary || '',
      chapterIndex: chapterNumber,
      chapterNumber,
      incidentId: item.incidentId || null,
      confidence: Number(item.confidence ?? incident?.confidence ?? 0),
      evidence: item.evidenceRefs || item.evidence_refs || [],
      causalLinks: item.causalLinks || item.causal_links || { causes: [], causedBy: [] },
      reviewStatus: incident?.reviewStatus || 'needs_review',
      needsReview: (incident?.reviewStatus || 'needs_review') !== 'auto_accepted',
      provenance: {
        sourcePass: 'artifact_v3',
        reviewStatus: incident?.reviewStatus || 'needs_review',
        beatType: item.beatType || item.beat_type || 'beat',
        beatSequence: item.sequence || 0,
      },
    });
  });
}

function mapV3Locations(result, beats, { corpusId, analysisId }) {
  const sourceLocations = toArray(result.canonical_entities?.locations || result.locations);
  const direct = sourceLocations.map((item) => normalizeLocation({
    ...item,
    corpusId,
    analysisId,
    chapterStart: parseChapter(item.chapterStart ?? item.chapterStartNumber),
    chapterEnd: parseChapter(item.chapterEnd ?? item.chapterEndNumber),
    chapterSpread: item.chapterSpread || [
      parseChapter(item.chapterStart ?? item.chapterStartNumber),
      parseChapter(item.chapterEnd ?? item.chapterEndNumber),
    ],
    eventIds: item.eventIds || [],
    incidentIds: item.incidentIds || [],
    evidence: item.evidence || item.timeline?.map((entry) => entry.summary).filter(Boolean) || [],
  }));

  if (direct.length > 0) {
    return direct;
  }

  return mapLocations([], beats, { corpusId, analysisId });
}

function dedupeV3Entities(entities = []) {
  const byId = new Map();
  for (const item of toArray(entities)) {
    const id = String(item?.id || '').trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, item);
      continue;
    }
    byId.set(id, {
      ...existing,
      ...item,
      aliases: [...new Set([...toArray(existing.aliases), ...toArray(item.aliases)])],
      summary: existing.summary || item.summary || '',
      description: existing.description || item.description || '',
      timeline: [...toArray(existing.timeline), ...toArray(item.timeline)],
      confidence: Math.max(Number(existing.confidence || 0), Number(item.confidence || 0)),
    });
  }
  return [...byId.values()];
}

async function persistV3Artifact({ corpusId, analysisId, result }) {
  const rawIncidents = toArray(result.incidents);
  const rawBeats = toArray(result.incident_beats);
  const rawEntities = dedupeV3Entities([
    ...toArray(result.canonical_entities?.characters).map((item) => ({ ...item, entityKind: 'character' })),
    ...toArray(result.canonical_entities?.locations).map((item) => ({ ...item, entityKind: 'location' })),
    ...toArray(result.canonical_entities?.objects).map((item) => ({ ...item, entityKind: 'object' })),
    ...toArray(result.canonical_entities?.terms).map((item) => ({ ...item, entityKind: 'term' })),
  ]);
  const rawMentions = toArray(result.entity_mentions);
  const rawWindows = toArray(result.analysis_windows).map((item) => ({
    ...item,
    id: item?.id ? `${analysisId}:${item.id}` : `${analysisId}:${item?.windowId || `window_${randomUUID().slice(0, 8)}`}`,
  }));
  const rawReviewQueue = toArray(result.review_queue || result.reviewQueue).map((item) => ({
    ...item,
    id: item.id || `rq_${randomUUID()}`,
    corpusId,
    analysisId,
  }));

  await analysisRepository.persistArtifactV3({
    analysisId,
    corpusId,
    artifact: result,
    windows: rawWindows,
    incidents: rawIncidents,
    beats: rawBeats,
    entities: rawEntities,
    entityMentions: rawMentions,
    reviewQueue: rawReviewQueue,
  });

  const incidents = mapV3Incidents(rawIncidents, { corpusId, analysisId });
  const events = mapV3Events(rawBeats, rawIncidents, { corpusId, analysisId });
  const locations = mapV3Locations(result, events, { corpusId, analysisId });
  const consistencyRisks = mapConsistencyRisks(result.consistencyRisks || result.consistency_risks, {
    corpusId,
    analysisId,
  });

  await incidentFirstRepository.replaceArtifacts({
    corpusId,
    analysisId,
    incidents,
    events,
    locations,
    consistencyRisks,
    reviewQueue: rawReviewQueue,
  });

  return {
    persisted: true,
    counts: {
      incidents: incidents.length,
      events: events.length,
      locations: locations.length,
      consistencyRisks: consistencyRisks.length,
      reviewQueue: rawReviewQueue.length,
      windows: rawWindows.length,
      beats: rawBeats.length,
      entities: rawEntities.length,
      mentions: rawMentions.length,
    },
    sourceOfTruth: 'analysis_run_artifacts',
  };
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

  if (String(result.artifact_version || '').toLowerCase() === 'v3') {
    return persistV3Artifact({ corpusId, analysisId, result });
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
