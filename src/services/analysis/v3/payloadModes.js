function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function dedupeTimelineEntries(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of toArray(entries)) {
    const eventId = normalizeText(entry?.eventId || entry?.event_id || '');
    const chapter = toNumber(entry?.chapter, null);
    const summary = normalizeText(entry?.summary || '');
    if (!eventId || !Number.isFinite(chapter) || chapter <= 0 || !summary) {
      continue;
    }
    const signature = `${eventId}|${chapter}|${summary}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push({
      eventId,
      chapter,
      summary,
    });
  }
  return result;
}

function sanitizeCanonicalEntity(item = {}) {
  const source = toObject(item);
  const next = {
    ...source,
    timeline: dedupeTimelineEntries(source.timeline),
  };
  if (next.entityKind === 'character') {
    next.role = normalizeText(next.role || '');
    next.appearance = normalizeText(next.appearance || '');
    next.personality = normalizeText(next.personality || '');
    next.personalityTags = [...new Set(
      toArray(next.personalityTags || next.personality_tags || next.traits)
        .map((entry) => normalizeText(entry))
        .filter(Boolean),
    )];
    next.flaws = normalizeText(next.flaws || '');
    next.goals = normalizeText(next.goals || next.goal || '');
    next.secrets = normalizeText(next.secrets || next.secret || '');
    delete next.personality_tags;
  }
  delete next.payload;
  return next;
}

function sanitizeCanonicalEntities(value = {}) {
  const source = toObject(value);
  return {
    characters: toArray(source.characters).map((item) => sanitizeCanonicalEntity(item)),
    locations: toArray(source.locations).map((item) => sanitizeCanonicalEntity(item)),
    objects: toArray(source.objects).map((item) => sanitizeCanonicalEntity(item)),
    terms: toArray(source.terms).map((item) => sanitizeCanonicalEntity(item)),
    worldProfile: toObject(source.worldProfile || source.world_profile),
  };
}

function sanitizeIncidentBeat(beat = {}) {
  const source = toObject(beat);
  return {
    id: source.id || null,
    incidentId: source.incidentId || source.incident_id || null,
    sequence: toNumber(source.sequence, null),
    chapterNumber: toNumber(source.chapterNumber ?? source.chapter, null),
    beatType: normalizeText(source.beatType || source.beat_type || 'beat') || 'beat',
    summary: normalizeText(source.summary || source.description || ''),
    causalLinks: toObject(source.causalLinks || source.causal_links || { causes: [], causedBy: [] }),
    evidenceRefs: toArray(source.evidenceRefs || source.evidence_refs).map((item) => normalizeText(item)).filter(Boolean),
    confidence: source.confidence ?? null,
    sourceEventId: source.sourceEventId || source.source_event_id || null,
    characters: toArray(source.characters).map((item) => normalizeText(item)).filter(Boolean),
    objects: toArray(source.objects).map((item) => normalizeText(item)).filter(Boolean),
    terms: toArray(source.terms).map((item) => normalizeText(item)).filter(Boolean),
    tags: toArray(source.tags).map((item) => normalizeText(item)).filter(Boolean),
    locationName: normalizeText(source.locationName || source.location_name || ''),
    locationId: source.locationId || source.location_id || null,
  };
}

function compactStoryGraph(value = {}) {
  const source = toObject(value);
  return {
    nodes: toArray(source.nodes).map((node) => ({
      id: node?.id || null,
      type: normalizeText(node?.type || ''),
      label: normalizeText(node?.label || node?.name || node?.title || node?.id || ''),
      incidentId: node?.incidentId || node?.incident_id || null,
      chapterNumber: toNumber(node?.chapterNumber ?? node?.chapter, null),
      graphKind: normalizeText(node?.graphKind || node?.graph_kind || ''),
    })),
    edges: toArray(source.edges).map((edge) => ({
      id: edge?.id || null,
      type: normalizeText(edge?.type || ''),
      from: edge?.from || null,
      to: edge?.to || null,
      label: normalizeText(edge?.label || ''),
      incidentId: edge?.incidentId || edge?.incident_id || null,
      graphKind: normalizeText(edge?.graphKind || edge?.graph_kind || ''),
    })),
    summary: toObject(source.summary),
  };
}

function normalizeCoverageAudit(value = {}) {
  const source = toObject(value);
  const observedCount = toObject(source.observedCount || source.observed_count);
  const returnedCount = toObject(source.returnedCount || source.returned_count);
  const coverage = toObject(source.coverage);
  const keys = ['characters', 'locations', 'objects', 'terms', 'relationships'];
  const rawCoverage = {};
  const overReturned = {};
  const overReturnedCount = {};

  for (const key of keys) {
    const observed = toNumber(observedCount[key], 0);
    const returned = toNumber(returnedCount[key], 0);
    const raw = observed > 0 ? returned / observed : 1;
    rawCoverage[key] = raw;
    overReturned[key] = returned > observed && observed > 0;
    overReturnedCount[key] = Math.max(0, returned - observed);
  }

  const complete = keys.every((key) => Number(coverage[key] || 0) >= 0.6 && !overReturned[key]);

  return {
    ...source,
    observedCount,
    returnedCount,
    coverage,
    rawCoverage,
    overReturned,
    overReturnedCount,
    complete,
  };
}

function buildBeatChapterCoverage(beats = [], incidents = [], meta = {}) {
  const presentChapters = [...new Set(
    toArray(beats)
      .map((item) => toNumber(item?.chapterNumber ?? item?.chapter, null))
      .filter((item) => Number.isFinite(item) && item > 0),
  )].sort((left, right) => left - right);

  const incidentMaxChapter = toArray(incidents).reduce((max, item) => {
    const end = toNumber(item?.chapterEnd ?? item?.chapter_end, 0);
    return end > max ? end : max;
  }, 0);
  const metaChapterCount = toNumber(meta.chapterCount || meta.chapter_count || meta.totalChapters, 0);
  const maxChapter = Math.max(incidentMaxChapter, metaChapterCount, presentChapters[presentChapters.length - 1] || 0);
  const missingChapters = [];

  if (maxChapter > 0) {
    for (let chapter = 1; chapter <= maxChapter; chapter += 1) {
      if (!presentChapters.includes(chapter)) {
        missingChapters.push(chapter);
      }
    }
  }

  return {
    presentChapters,
    missingChapters,
    hasGap: missingChapters.length > 0,
    expectedMaxChapter: maxChapter || null,
    diagnosticCode: missingChapters.length > 0 ? 'chapterCoverageGap' : null,
  };
}

export const ANALYSIS_PAYLOAD_MODES = {
  SLIM: 'slim',
  FULL: 'full',
};

export function normalizeAnalysisPayloadMode(value) {
  return String(value || '').trim().toLowerCase() === ANALYSIS_PAYLOAD_MODES.FULL
    ? ANALYSIS_PAYLOAD_MODES.FULL
    : ANALYSIS_PAYLOAD_MODES.SLIM;
}

export function buildSlimFinalResult(result = {}) {
  const source = toObject(result);
  const next = {};

  const keptKeys = [
    'artifact_version',
    'meta',
    'incidents',
    'incident_beats',
    'canonical_entities',
    'craft',
    'coverage_audit',
    'story_graph',
    'graph_summary',
    'analysis_run_manifest',
    'pass_status',
    'degraded_run_report',
    'tokenUsage',
  ];

  for (const key of keptKeys) {
    if (source[key] !== undefined) {
      next[key] = source[key];
    }
  }

  if (!Array.isArray(next.incidents) && Array.isArray(source.incident_map?.incidents)) {
    next.incidents = source.incident_map.incidents;
  }

  if (!Array.isArray(next.incident_beats) && Array.isArray(source.events)) {
    next.incident_beats = source.events;
  }

  if ((!next.canonical_entities || typeof next.canonical_entities !== 'object') && source.knowledge) {
    next.canonical_entities = {
      characters: toArray(source.knowledge.characters),
      locations: toArray(source.knowledge.locations),
      objects: toArray(source.knowledge.objects),
      terms: toArray(source.knowledge.terms),
      worldProfile: toObject(source.knowledge.world_profile),
    };
  }

  next.incident_beats = toArray(next.incident_beats).map((item) => sanitizeIncidentBeat(item));
  next.canonical_entities = sanitizeCanonicalEntities(next.canonical_entities);
  next.story_graph = compactStoryGraph(next.story_graph || source.storyGraph);
  next.coverage_audit = normalizeCoverageAudit(next.coverage_audit);
  next.meta = {
    ...toObject(next.meta),
    beatChapterCoverage: buildBeatChapterCoverage(next.incident_beats, next.incidents, next.meta),
  };

  return next;
}

export function buildSlimArtifactEnvelope(artifact = {}) {
  const source = toObject(artifact);
  const incidents = toArray(source.incidents);
  const incidentBeats = toArray(source.incident_beats || source.incidentBeats).map((item) => sanitizeIncidentBeat(item));
  const meta = {
    ...toObject(source.meta),
    beatChapterCoverage: buildBeatChapterCoverage(incidentBeats, incidents, source.meta),
  };

  return {
    artifact_version: source.artifact_version || source.artifactVersion || 'v3',
    incidents,
    incident_beats: incidentBeats,
    canonical_entities: sanitizeCanonicalEntities(source.canonical_entities || source.canonicalEntities),
    craft: toObject(source.craft),
    coverage_audit: normalizeCoverageAudit(source.coverage_audit),
    story_graph: compactStoryGraph(source.story_graph || source.storyGraph),
    graph_summary: toObject(source.graph_summary || source.graphSummary),
    analysis_run_manifest: toObject(source.analysis_run_manifest || source.analysisRunManifest),
    pass_status: toObject(source.pass_status || source.passStatus),
    degraded_run_report: toObject(source.degraded_run_report || source.degradedRunReport),
    tokenUsage: toObject(source.tokenUsage),
    meta,
  };
}
