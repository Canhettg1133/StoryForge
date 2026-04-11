import { buildReviewQueue } from '../pipeline/reviewQueueBuilder.js';
import { buildStoryGraph } from '../v2/storyGraph.js';
import {
  buildAnalysisWindows,
  buildCanonicalEntities,
  buildGraphProjections,
  buildIncidentBeats,
  buildIncidentMap,
  buildRerunManifest,
  materializeWindowResults,
} from './artifactBuilder.js';
import { buildNarrativeExecutionPlan } from './scheduler.js';
import { splitLayerResults } from '../outputChunker.js';
import { persistIncidentFirstArtifacts } from '../incidentFirstPersistence.js';
import { analysisRepository } from '../repositories/analysisRepository.js';

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

const INTERNAL_PASS_IDS = {
  pass_0: 'Canonical Corpus Build',
  pass_a: 'Windowed Incident Mapping',
  pass_b: 'Deep Incident Workers',
  pass_c: 'Canonical Entity Refinement',
  pass_e: 'Narrative Graph Build',
  pass_f: 'Consistency + Coherence',
  pass_g: 'Review Intelligence',
};

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function ensureArrayOfStrings(values = []) {
  return [...new Set(
    toArray(values)
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

export function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Scoped rerun cancelled');
  error.code = 'JOB_CANCELLED';
  throw error;
}

export function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function extractSourceEvents(source = {}) {
  const rawEvents = source?.events;
  if (Array.isArray(rawEvents)) {
    return rawEvents.map((event) => normalizeSourceEvent(event));
  }

  const layer = toObject(rawEvents);
  const visited = [];
  const visit = (event, bucket) => {
    if (!event || typeof event !== 'object') return;
    visited.push(normalizeSourceEvent({
      ...event,
      eventType: event.eventType || event.type || event._type || bucket,
    }));
    for (const key of ['subevents', 'subEvents', 'children']) {
      for (const child of toArray(event[key])) {
        visit(child, bucket);
      }
    }
  };

  for (const key of EVENT_COLLECTION_KEYS) {
    for (const event of toArray(layer[key])) {
      visit(event, key);
    }
  }

  return visited.filter((event) => event.description);
}

export function normalizeSourceEvent(event = {}) {
  const description = normalizeText(event.description || event.summary || event.title || '');
  return {
    id: normalizeText(event.id || '') || null,
    description,
    title: normalizeText(event.title || event.description || ''),
    chapter: toNumber(
      event.chapterNumber
      ?? event.chapter
      ?? event.chapterIndex
      ?? event.grounding?.chapterIndex,
      null,
    ),
    incidentId: normalizeText(event.incidentId || event.incident_id || '') || null,
    eventType: normalizeText(event.eventType || event.type || event._type || '') || 'major',
    severity: normalizeText(event.severity || '') || 'major',
    confidence: clamp(event.confidence ?? event.chapterConfidence, 0, 1, 0.65),
    evidence: toArray(event.evidence || event.evidenceRefs || event.evidence_refs)
      .map((item) => normalizeText(item))
      .filter(Boolean),
    characters: ensureArrayOfStrings(event.characters),
    tags: ensureArrayOfStrings(event.tags),
    objects: ensureArrayOfStrings(event.objects),
    terms: ensureArrayOfStrings(event.terms),
    locationName: normalizeText(
      event.locationName
      || event.primaryLocationName
      || event.locationLink?.locationName
      || '',
    ),
    causalLinks: toObject(event.causalLinks || event.causal_links || {}),
  };
}

export function ensureBeatsWithContext(beats = [], sourceEvents = []) {
  const sourceById = new Map(
    sourceEvents
      .filter((event) => event?.id)
      .map((event) => [event.id, event]),
  );

  return beats.map((beat) => {
    const sourceEvent = sourceById.get(beat.sourceEventId) || sourceById.get(beat.id) || null;
    return {
      ...beat,
      characters: ensureArrayOfStrings(beat.characters || sourceEvent?.characters),
      tags: ensureArrayOfStrings(beat.tags || sourceEvent?.tags),
      objects: ensureArrayOfStrings(beat.objects || sourceEvent?.objects),
      terms: ensureArrayOfStrings(beat.terms || sourceEvent?.terms),
      locationName: normalizeText(beat.locationName || sourceEvent?.locationName || ''),
      sourceEvent,
    };
  });
}

export function buildEventsLayer(events = [], locations = []) {
  const locationMap = new Map(
    locations
      .map((item) => [normalizeText(item?.name).toLowerCase(), item])
      .filter(([name]) => Boolean(name)),
  );

  const layer = {
    majorEvents: [],
    minorEvents: [],
    plotTwists: [],
    cliffhangers: [],
  };

  for (const event of events) {
    if (!event?.description) continue;
    const location = event.locationName
      ? locationMap.get(normalizeText(event.locationName).toLowerCase())
      : null;

    const mapped = {
      id: event.id || event.sourceEventId || null,
      title: event.title || event.description,
      description: event.description,
      chapter: toNumber(event.chapter ?? event.chapterNumber, null),
      chapterNumber: toNumber(event.chapter ?? event.chapterNumber, null),
      incidentId: event.incidentId || null,
      severity: normalizeText(event.severity || event.eventType || 'major').toLowerCase(),
      confidence: clamp(event.confidence, 0, 1, 0.65),
      characters: ensureArrayOfStrings(event.characters),
      tags: ensureArrayOfStrings(event.tags),
      objects: ensureArrayOfStrings(event.objects),
      terms: ensureArrayOfStrings(event.terms),
      evidence: toArray(event.evidence).filter(Boolean),
      locationLink: location
        ? { locationId: location.id || null, locationName: location.name || '' }
        : (event.locationName ? { locationId: null, locationName: event.locationName } : null),
      causalLinks: toObject(event.causalLinks || {}),
      _type: normalizeText(event.eventType || 'major').toLowerCase(),
    };

    const eventType = mapped._type;
    if (eventType === 'minor') {
      layer.minorEvents.push(mapped);
    } else if (eventType === 'twist') {
      layer.plotTwists.push(mapped);
    } else if (eventType === 'cliffhanger') {
      layer.cliffhangers.push(mapped);
    } else {
      layer.majorEvents.push(mapped);
    }
  }

  return layer;
}

export function mergeIncidentMetadata(nextIncidents = [], previousIncidents = []) {
  const previousById = new Map(
    previousIncidents
      .filter((incident) => incident?.id)
      .map((incident) => [incident.id, incident]),
  );

  return nextIncidents.map((incident) => {
    const previous = previousById.get(incident.id) || {};
    return {
      ...previous,
      ...incident,
      detailedSummary: normalizeText(incident.detailedSummary || previous.detailedSummary || previous.description || ''),
      summary: normalizeText(incident.summary || previous.summary || previous.description || ''),
      climax: normalizeText(incident.climax || previous.climax || ''),
      outcome: normalizeText(incident.outcome || previous.outcome || ''),
      consequences: toArray(incident.consequences).length
        ? toArray(incident.consequences)
        : toArray(previous.consequences),
      primaryEvidenceRefs: toArray(incident.primaryEvidenceRefs).length
        ? toArray(incident.primaryEvidenceRefs)
        : toArray(previous.primaryEvidenceRefs || previous.evidence),
      reviewStatus: incident.reviewStatus || previous.reviewStatus || 'needs_review',
      degradedFlags: toArray(incident.degradedFlags).length
        ? toArray(incident.degradedFlags)
        : toArray(previous.degradedFlags),
      lineage: {
        ...toObject(previous.lineage),
        ...toObject(incident.lineage),
      },
    };
  });
}

export function mergeBeatsForScope(existingBeats = [], nextBeats = [], targetIncidentIds = []) {
  const targetIds = new Set(ensureArrayOfStrings(targetIncidentIds));
  const preserved = existingBeats.filter((beat) => !targetIds.has(String(beat.incidentId || '')));
  return [
    ...preserved,
    ...nextBeats.filter((beat) => !targetIds.size || targetIds.has(String(beat.incidentId || ''))),
  ].sort((left, right) => {
    const chapterDiff = toNumber(left.chapterNumber, Number.MAX_SAFE_INTEGER)
      - toNumber(right.chapterNumber, Number.MAX_SAFE_INTEGER);
    if (chapterDiff !== 0) return chapterDiff;
    return toNumber(left.sequence, 0) - toNumber(right.sequence, 0);
  });
}

export function mergeCanonicalSections(previous = {}, next = {}, kinds = []) {
  const selectedKinds = new Set(ensureArrayOfStrings(kinds));
  if (!selectedKinds.size) {
    return {
      characters: toArray(next.characters),
      locations: toArray(next.locations),
      objects: toArray(next.objects),
      terms: toArray(next.terms),
      worldProfile: toObject(next.worldProfile || next.world_profile),
    };
  }

  const merged = {
    characters: toArray(previous.characters),
    locations: toArray(previous.locations),
    objects: toArray(previous.objects),
    terms: toArray(previous.terms),
    worldProfile: toObject(previous.worldProfile || previous.world_profile),
  };

  if (selectedKinds.has('character')) {
    merged.characters = toArray(next.characters);
  }
  if (selectedKinds.has('location')) {
    merged.locations = toArray(next.locations);
  }
  if (selectedKinds.has('object')) {
    merged.objects = toArray(next.objects);
  }
  if (selectedKinds.has('term')) {
    merged.terms = toArray(next.terms);
  }
  if (
    selectedKinds.has('location')
    || selectedKinds.has('object')
    || selectedKinds.has('term')
    || selectedKinds.has('world')
  ) {
    merged.worldProfile = toObject(next.worldProfile || next.world_profile);
  }

  return merged;
}

export function mergeMentionsForKinds(previousMentions = [], nextMentions = [], kinds = []) {
  const selectedKinds = new Set(ensureArrayOfStrings(kinds));
  if (!selectedKinds.size) {
    return nextMentions;
  }

  const preserved = previousMentions.filter((mention) => !selectedKinds.has(String(mention.entityKind || '')));
  return [...preserved, ...nextMentions.filter((mention) => selectedKinds.has(String(mention.entityKind || '')))];
}

export function toLegacyIncident(incident = {}, beatCount = 0) {
  return {
    ...incident,
    evidence: toArray(incident.primaryEvidenceRefs || incident.evidence),
    chapterRange: [incident.chapterStart ?? null, incident.chapterEnd ?? null],
    uncertainStart: Boolean(incident.lineage?.supporting_window_ids?.length > 1 && !incident.chapterStart),
    uncertainEnd: Boolean(incident.lineage?.supporting_window_ids?.length > 1 && !incident.chapterEnd),
    eventCount: beatCount,
  };
}

export function beatToLegacyEvent(beat = {}, incidentMap = new Map()) {
  const incident = incidentMap.get(beat.incidentId) || {};
  const evidence = toArray(beat.evidenceRefs || beat.evidence_refs);
  return {
    id: beat.sourceEventId || beat.id,
    description: beat.summary || '',
    title: beat.summary || '',
    chapter: beat.chapterNumber ?? null,
    chapterNumber: beat.chapterNumber ?? null,
    chapterIndex: beat.chapterNumber ?? null,
    incidentId: beat.incidentId || null,
    confidence: clamp(beat.confidence, 0, 1, 0.65),
    severity: normalizeText(beat.beatType || 'major').toLowerCase(),
    evidence,
    characters: ensureArrayOfStrings(beat.characters),
    objects: ensureArrayOfStrings(beat.objects),
    terms: ensureArrayOfStrings(beat.terms),
    tags: ensureArrayOfStrings(beat.tags),
    locationName: normalizeText(beat.locationName || ''),
    locationLink: beat.locationName ? { locationName: beat.locationName } : null,
    causalLinks: toObject(beat.causalLinks || {}),
    reviewStatus: incident.reviewStatus || 'needs_review',
    needsReview: (incident.reviewStatus || 'needs_review') !== 'auto_accepted',
  };
}

export function mapCanonicalToKnowledge(canonicalEntities = {}) {
  return {
    characters: toArray(canonicalEntities.characters),
    locations: toArray(canonicalEntities.locations),
    objects: toArray(canonicalEntities.objects),
    terms: toArray(canonicalEntities.terms),
    world_profile: toObject(canonicalEntities.worldProfile || canonicalEntities.world_profile),
  };
}

export function mergeReviewStatuses(previousQueue = [], nextQueue = []) {
  const statusByKey = new Map();
  for (const item of previousQueue) {
    const key = `${item.itemType || item.item_type}|${item.itemId || item.item_id}`;
    if (!key) continue;
    statusByKey.set(key, {
      status: item.status,
      resolution: item.resolution,
      reviewedAt: item.reviewedAt || item.reviewed_at || null,
      reviewedBy: item.reviewedBy || item.reviewed_by || null,
    });
  }

  return nextQueue.map((item) => {
    const key = `${item.itemType}|${item.itemId}`;
    const previous = statusByKey.get(key);
    if (!previous) return item;
    return {
      ...item,
      status: previous.status || item.status,
      resolution: previous.resolution || item.resolution,
      reviewedAt: previous.reviewedAt || item.reviewedAt || null,
      reviewedBy: previous.reviewedBy || item.reviewedBy || null,
    };
  });
}

export function buildWindowResults(windows = []) {
  return windows.map((window) => ({
    windowId: window.windowId,
    status: window.status,
    incidents: toArray(window.incidents),
    open_boundaries: toArray(window.openBoundaries || window.open_boundaries),
  }));
}

export function buildIncidentMapPayload(incidents = [], windows = [], carryPackets = []) {
  return {
    canonical_incident_map: incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      chapterStart: incident.chapterStart,
      chapterEnd: incident.chapterEnd,
      confidence: incident.confidence,
      lineage: incident.lineage || {},
    })),
    reducer: {
      carry_packet_count: carryPackets.length,
      window_count: windows.length,
      incident_count: incidents.length,
    },
    incidents,
  };
}

export function buildPassStatus(baseStatus = {}, passIds = [], state = 'completed', reason = null, scope = {}) {
  const next = { ...toObject(baseStatus) };
  const timestamp = Date.now();
  for (const passId of passIds) {
    next[passId] = {
      name: INTERNAL_PASS_IDS[passId] || passId,
      ...(toObject(next[passId])),
      status: state,
      lastRerunAt: timestamp,
      lastRerunScope: scope,
      degradedReason: state === 'degraded' ? reason : null,
    };
  }
  return next;
}

export function buildAnalysisRunManifest(baseManifest = {}, preview, executionPlan, reason = null) {
  const nextManifest = {
    ...toObject(baseManifest),
    lastRerun: {
      requestedAt: Date.now(),
      phase: preview.phase,
      reason: reason || null,
      invalidates: preview.invalidation.passIds,
      scopes: preview.rerunRequest,
      executionPlan,
    },
  };
  const history = toArray(baseManifest?.rerunHistory);
  nextManifest.rerunHistory = [
    ...history.slice(-9),
    nextManifest.lastRerun,
  ];
  return nextManifest;
}

export function toStoredArtifact(result = {}) {
  return {
    ...result,
    artifact_version: 'v3',
    canonical_corpus: result.canonical_corpus || result.canonicalCorpus || {},
    analysis_windows: result.analysis_windows || result.analysisWindows || [],
    window_results: result.window_results || result.windowResults || [],
    carry_packets: result.carry_packets || result.carryPackets || [],
    incident_map: result.incident_map || result.incidentMap || {},
    incidents: result.incidents || [],
    incident_beats: result.incident_beats || result.incidentBeats || [],
    entity_mentions: result.entity_mentions || result.entityMentions || [],
    canonical_entities: result.canonical_entities || result.canonicalEntities || {},
    graph_projections: result.graph_projections || result.graphProjections || {},
    review_queue: result.review_queue || result.reviewQueue || [],
    pass_status: result.pass_status || result.passStatus || {},
    rerun_manifest: result.rerun_manifest || result.rerunManifest || {},
    degraded_run_report: result.degraded_run_report || result.degradedRunReport || {},
  };
}

export function buildScopedRerunPreview({
  artifact = null,
  phase = 'incident',
  windowIds = [],
  incidentIds = [],
  canonicalizerKinds = [],
  reason = null,
  keyCount = 1,
} = {}) {
  const requestedPhase = String(phase || 'incident').trim() || 'incident';
  const scopedWindowIds = ensureArrayOfStrings(windowIds);
  const scopedIncidentIds = ensureArrayOfStrings(incidentIds);
  const scopedCanonicalizerKinds = ensureArrayOfStrings(canonicalizerKinds);
  const invalidates = new Set();

  if (requestedPhase === 'window' || requestedPhase === 'reducer' || scopedWindowIds.length > 0) {
    invalidates.add('pass_a');
    invalidates.add('pass_e');
    invalidates.add('pass_f');
    invalidates.add('pass_g');
  }

  if (requestedPhase === 'incident' || scopedIncidentIds.length > 0) {
    invalidates.add('pass_b');
    invalidates.add('pass_c');
    invalidates.add('pass_e');
    invalidates.add('pass_f');
    invalidates.add('pass_g');
  }

  if (requestedPhase === 'character_canonicalizer') {
    invalidates.add('pass_c');
    invalidates.add('pass_e');
    invalidates.add('pass_f');
    invalidates.add('pass_g');
  }

  if (requestedPhase === 'world_canonicalizer') {
    invalidates.add('pass_c');
    invalidates.add('pass_e');
    invalidates.add('pass_f');
    invalidates.add('pass_g');
  }

  if (requestedPhase === 'graph_projection') {
    invalidates.add('pass_e');
    invalidates.add('pass_f');
    invalidates.add('pass_g');
  }

  const executionPlan = buildNarrativeExecutionPlan({
    phase: requestedPhase,
    keyCount,
    windowIds: scopedWindowIds,
    incidentIds: scopedIncidentIds,
    canonicalizerKinds: scopedCanonicalizerKinds,
  });

  return {
    phase: requestedPhase,
    rerunRequest: {
      phase: requestedPhase,
      windowIds: scopedWindowIds,
      incidentIds: scopedIncidentIds,
      canonicalizerKinds: scopedCanonicalizerKinds,
      reason: normalizeText(reason || '') || null,
    },
    invalidation: {
      passIds: [...invalidates],
      rerunManifest: artifact?.rerunManifest || artifact?.rerun_manifest || {},
    },
    executionPlan,
  };
}

export function inferRerunScope(item = {}) {
  const type = normalizeText(item.itemType || item.item_type).toLowerCase();
  if (type === 'incident') return 'incident';
  if (type === 'location') return 'world_canonicalizer';
  if (type === 'event') return 'incident';
  return 'graph_projection';
}

export function inferRelatedIncidentIds(item = {}, incidents = []) {
  const itemType = normalizeText(item.itemType || item.item_type).toLowerCase();
  if (itemType === 'incident' && item.itemId) {
    return [item.itemId];
  }
  if (itemType === 'location') {
    return incidents
      .filter((incident) => toArray(incident.entityRefs?.locations).includes(item.itemId))
      .map((incident) => incident.id);
  }
  return [];
}

export function inferSuggestedAction(item = {}) {
  const reasons = toArray(item.reason).map((value) => normalizeText(value).toLowerCase());
  if (reasons.some((value) => value.includes('co lap') || value.includes('isolated'))) {
    return 'Rerun graph projection and inspect missing links';
  }
  if (reasons.some((value) => value.includes('ranh gioi') || value.includes('boundary'))) {
    return 'Rerun reducer/window scope and review incident boundary';
  }
  return 'Rerun scoped phase and inspect refreshed artifact output';
}

export async function executeScopedRerun({
  corpusId,
  analysisId,
  analysis,
  artifact,
  phase = 'incident',
  windowIds = [],
  incidentIds = [],
  canonicalizerKinds = [],
  reason = null,
  keyCount = 1,
  signal,
  onProgress = async () => {},
} = {}) {
  if (!analysisId || !corpusId || !analysis || !artifact) {
    const error = new Error('Missing analysis context for scoped rerun');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  throwIfCancelled(signal);

  const preview = buildScopedRerunPreview({
    artifact,
    phase,
    windowIds,
    incidentIds,
    canonicalizerKinds,
    reason,
    keyCount,
  });
  const sourceResult = parseJsonField(analysis.finalResult, {});
  const canonicalCorpus = artifact.canonicalCorpus || toObject(sourceResult.canonical_corpus) || {};
  let incidents = mergeIncidentMetadata(
    toArray(artifact.incidents),
    toArray(sourceResult.incidents),
  );
  const sourceEvents = extractSourceEvents(sourceResult);
  let beats = ensureBeatsWithContext(
    toArray(artifact.incidentBeats).length
      ? toArray(artifact.incidentBeats)
      : buildIncidentBeats(sourceEvents, incidents),
    sourceEvents,
  );
  let analysisWindows = toArray(artifact.analysisWindows);
  let carryPackets = toArray(artifact.carryPackets);
  let canonicalEntities = {
    characters: toArray(artifact.canonicalEntities?.characters),
    locations: toArray(artifact.canonicalEntities?.locations),
    objects: toArray(artifact.canonicalEntities?.objects),
    terms: toArray(artifact.canonicalEntities?.terms),
    worldProfile: toObject(artifact.canonicalEntities?.worldProfile || artifact.canonicalEntities?.world_profile),
  };
  let entityMentions = toArray(artifact.entityMentions);
  let storyGraph = artifact.graphProjections
    ? {
      nodes: Object.values(artifact.graphProjections)
        .flatMap((projection) => toArray(projection?.nodes))
        .filter(Boolean),
      edges: Object.values(artifact.graphProjections)
        .flatMap((projection) => toArray(projection?.edges))
        .filter(Boolean),
      projections: artifact.graphProjections,
      summary: toObject(sourceResult.graph_summary || artifact.payload?.graphSummary),
    }
    : (sourceResult.story_graph || sourceResult.storyGraph || { nodes: [], edges: [], summary: {} });
  let reviewQueue = toArray(artifact.reviewQueue);
  const consistencyRisks = toArray(sourceResult.consistencyRisks || sourceResult.consistency_risks);
  const targetIncidentIds = ensureArrayOfStrings(
    incidentIds.length
      ? incidentIds
      : (phase === 'incident'
        ? incidents.map((incident) => incident.id)
        : []),
  );
  const canonicalizerKindsNormalized = ensureArrayOfStrings(
    canonicalizerKinds.length
      ? canonicalizerKinds
      : (phase === 'character_canonicalizer'
        ? ['character']
        : (phase === 'world_canonicalizer' ? ['location', 'object', 'term', 'world'] : [])),
  );

  await onProgress(8, 'Loading scoped rerun context', {
    step: {
      name: 'load_scope',
      status: 'running',
      progress: 30,
      message: 'Loading artifact + source result',
    },
  });
  throwIfCancelled(signal);

  let passStatus = buildPassStatus(
    sourceResult.pass_status || artifact.passStatus || {},
    preview.invalidation.passIds,
    'running',
    null,
    preview.rerunRequest,
  );

  if (phase === 'window' || phase === 'reducer' || windowIds.length > 0) {
    await onProgress(22, 'Rebuilding analysis windows and reducer output', {
      step: {
        name: 'phase_a_windows',
        status: 'running',
        progress: 20,
        message: 'Refreshing window overlap, carry packets, and boundaries',
      },
    });
    throwIfCancelled(signal);

    const windowsBase = buildAnalysisWindows(
      toArray(canonicalCorpus.chapters),
      toObject(sourceResult.meta),
    );
    const materialized = materializeWindowResults(windowsBase, incidents);
    analysisWindows = materialized.windows;
    carryPackets = materialized.carryPackets;
    const incidentMap = buildIncidentMap(incidents, analysisWindows, carryPackets);
    incidents = mergeIncidentMetadata(incidentMap.incidents, incidents);
    passStatus = buildPassStatus(passStatus, ['pass_a'], 'completed', null, preview.rerunRequest);
  }

  if (phase === 'incident' || targetIncidentIds.length > 0) {
    await onProgress(42, 'Rebuilding incident beats for scoped incidents', {
      step: {
        name: 'phase_b_workers',
        status: 'running',
        progress: 50,
        message: 'Refreshing incident beats from scoped event sources',
      },
    });
    throwIfCancelled(signal);

    const rebuiltBeats = ensureBeatsWithContext(
      buildIncidentBeats(sourceEvents, incidents),
      sourceEvents,
    );
    beats = mergeBeatsForScope(beats, rebuiltBeats, targetIncidentIds);
    passStatus = buildPassStatus(passStatus, ['pass_b'], 'completed', null, preview.rerunRequest);
  }

  if (
    phase === 'incident'
    || phase === 'character_canonicalizer'
    || phase === 'world_canonicalizer'
    || targetIncidentIds.length > 0
    || canonicalizerKindsNormalized.length > 0
  ) {
    const kindsForMerge = phase === 'incident' && !canonicalizerKindsNormalized.length
      ? []
      : canonicalizerKindsNormalized;
    const canonicalRebuild = buildCanonicalEntities(
      mapCanonicalToKnowledge({
        ...toObject(sourceResult.knowledge),
        ...canonicalEntities,
      }),
      incidents,
      beats,
    );

    if (phase === 'character_canonicalizer') {
      await onProgress(56, 'Refreshing character canonicalizer', {
        step: {
          name: 'phase_c_characters',
          status: 'running',
          progress: 50,
          message: 'Rebuilding canonical characters and character mentions',
        },
      });
    } else if (phase === 'world_canonicalizer') {
      await onProgress(56, 'Refreshing world canonicalizer', {
        step: {
          name: 'phase_c_world',
          status: 'running',
          progress: 50,
          message: 'Rebuilding locations, objects, terms, and world mentions',
        },
      });
    } else {
      await onProgress(56, 'Refreshing canonical entities', {
        step: {
          name: 'phase_c_entities',
          status: 'running',
          progress: 50,
          message: 'Rebuilding canonical entities and mentions',
        },
      });
    }
    throwIfCancelled(signal);

    canonicalEntities = mergeCanonicalSections(
      canonicalEntities,
      canonicalRebuild.canonicalEntities,
      kindsForMerge,
    );
    entityMentions = mergeMentionsForKinds(
      entityMentions,
      canonicalRebuild.mentions,
      kindsForMerge,
    );
    passStatus = buildPassStatus(passStatus, ['pass_c'], 'completed', null, preview.rerunRequest);
  }

  if (
    phase === 'window'
    || phase === 'reducer'
    || phase === 'incident'
    || phase === 'character_canonicalizer'
    || phase === 'world_canonicalizer'
    || phase === 'graph_projection'
    || preview.invalidation.passIds.includes('pass_e')
  ) {
    await onProgress(72, 'Rebuilding graph projections', {
      step: {
        name: 'phase_d_graph',
        status: 'running',
        progress: 60,
        message: 'Refreshing incident, causal, character-state, and location graphs',
      },
    });
    throwIfCancelled(signal);

    const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
    const graphEvents = beats.map((beat) => beatToLegacyEvent(beat, incidentById));
    const nextStoryGraph = buildStoryGraph({
      incidents,
      events: graphEvents,
      knowledge: mapCanonicalToKnowledge(canonicalEntities),
      relationships: toArray(sourceResult.relationships?.ships),
    });
    storyGraph = {
      ...nextStoryGraph,
      projections: buildGraphProjections(nextStoryGraph),
    };
    passStatus = buildPassStatus(passStatus, ['pass_e', 'pass_f'], 'completed', null, preview.rerunRequest);
  }

  await onProgress(86, 'Refreshing review intelligence', {
    step: {
      name: 'phase_e_review',
      status: 'running',
      progress: 70,
      message: 'Recomputing review queue from scoped artifact state',
    },
  });
  throwIfCancelled(signal);

  const beatCountByIncident = beats.reduce((acc, beat) => {
    const key = String(beat.incidentId || '');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
  const reviewQueueBase = buildReviewQueue(
    incidents.map((incident) => toLegacyIncident(incident, beatCountByIncident[incident.id] || 0)),
    beats.map((beat) => beatToLegacyEvent(beat, incidentById)),
    toArray(canonicalEntities.locations),
    consistencyRisks,
    {
      corpusId,
      analysisId,
      graph: storyGraph,
    },
  ).map((item) => ({
    ...item,
    sourcePhase: item.sourcePhase || 'pass_g',
    rerunScope: item.rerunScope || inferRerunScope(item),
    relatedWindowIds: item.relatedWindowIds || [],
    relatedIncidentIds: item.relatedIncidentIds || inferRelatedIncidentIds(item, incidents),
    suggestedAction: item.suggestedAction || inferSuggestedAction(item),
  }));
  reviewQueue = mergeReviewStatuses(reviewQueue, reviewQueueBase);
  passStatus = buildPassStatus(passStatus, ['pass_g'], 'completed', null, preview.rerunRequest);

  const rerunManifest = buildRerunManifest({
    windows: analysisWindows,
    incidents,
    reviewQueue,
    passStatus,
  });
  const graphProjections = storyGraph.projections || buildGraphProjections(storyGraph);
  const degradedRunReport = {
    ...toObject(sourceResult.degraded_run_report || artifact.degradedRunReport),
    lastScopedRerun: {
      executedAt: Date.now(),
      phase: preview.phase,
      reason: preview.rerunRequest.reason,
      invalidatedPassIds: preview.invalidation.passIds,
    },
  };
  const analysisRunManifest = buildAnalysisRunManifest(
    sourceResult.analysis_run_manifest || analysis.analysisRunManifest || {},
    preview,
    preview.executionPlan,
    preview.rerunRequest.reason,
  );

  const storedResult = toStoredArtifact({
    ...sourceResult,
    artifact_version: 'v3',
    canonical_corpus: canonicalCorpus,
    analysis_windows: analysisWindows,
    window_results: buildWindowResults(analysisWindows),
    carry_packets: carryPackets,
    incident_map: buildIncidentMapPayload(incidents, analysisWindows, carryPackets),
    incidents,
    incident_beats: beats,
    entity_mentions: entityMentions,
    canonical_entities: canonicalEntities,
    graph_projections: graphProjections,
    review_queue: reviewQueue,
    reviewQueue,
    story_graph: {
      nodes: toArray(storyGraph.nodes),
      edges: toArray(storyGraph.edges),
      summary: toObject(storyGraph.summary),
    },
    graph_summary: toObject(storyGraph.summary),
    pass_status: passStatus,
    rerun_manifest: rerunManifest,
    degraded_run_report: degradedRunReport,
    analysis_run_manifest: analysisRunManifest,
    knowledge: mapCanonicalToKnowledge(canonicalEntities),
    locations: canonicalEntities.locations,
    objects: canonicalEntities.objects,
    terms: canonicalEntities.terms,
    events: buildEventsLayer(
      sourceEvents.length
        ? sourceEvents
        : beats.map((beat) => beatToLegacyEvent(beat, incidentById)),
      canonicalEntities.locations,
    ),
    meta: {
      ...toObject(sourceResult.meta),
      artifactVersion: 'v3',
      lastRerun: {
        phase: preview.phase,
        requestedAt: Date.now(),
        reason: preview.rerunRequest.reason,
        executionPlan: preview.executionPlan,
      },
    },
  });

  const layerResults = splitLayerResults(storedResult);

  await onProgress(94, 'Persisting scoped rerun artifact', {
    step: {
      name: 'persist_scope',
      status: 'running',
      progress: 80,
      message: 'Writing artifact, projections, and story graph',
    },
  });
  throwIfCancelled(signal);

  await persistIncidentFirstArtifacts({
    corpusId,
    analysisId,
    result: storedResult,
  });
  await analysisRepository.persistGraph(
    analysisId,
    corpusId,
    storedResult.graph_projections,
    storedResult.pass_status,
  );
  await analysisRepository.updateAnalysis(analysisId, {
    finalResult: JSON.stringify(storedResult),
    resultL1: layerResults.resultL1,
    resultL2: layerResults.resultL2,
    resultL3: layerResults.resultL3,
    resultL4: layerResults.resultL4,
    resultL5: layerResults.resultL5,
    resultL6: layerResults.resultL6,
    analysisRunManifest: JSON.stringify(storedResult.analysis_run_manifest || null),
    passStatus: JSON.stringify(storedResult.pass_status || null),
    degradedRunReport: JSON.stringify(storedResult.degraded_run_report || null),
    graphSummary: JSON.stringify(storedResult.graph_summary || null),
    artifactVersion: 'v3',
    currentPhase: 'completed',
    completedAt: Date.now(),
    errorMessage: null,
  });

  await onProgress(100, 'Scoped rerun completed', {
    event: 'step_complete',
    step: {
      name: 'persist_scope',
      status: 'completed',
      progress: 100,
      message: 'Scoped rerun completed',
    },
  });

  return {
    analysisId,
    corpusId,
    artifactVersion: 'v3',
    phase: preview.phase,
    executionPlan: preview.executionPlan,
    rerunRequest: preview.rerunRequest,
    invalidation: preview.invalidation,
    updatedCounts: {
      windows: analysisWindows.length,
      incidents: incidents.length,
      beats: beats.length,
      entities: toArray(canonicalEntities.characters).length
        + toArray(canonicalEntities.locations).length
        + toArray(canonicalEntities.objects).length
        + toArray(canonicalEntities.terms).length,
      reviewQueue: reviewQueue.length,
    },
  };
}

export default {
  buildScopedRerunPreview,
  executeScopedRerun,
};
