import { randomUUID } from 'node:crypto';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function flattenSourceEvents(raw = {}) {
  if (Array.isArray(raw)) {
    return raw.filter((item) => item && typeof item === 'object');
  }

  const layer = toObject(raw);
  const result = [];
  const visit = (event, bucket) => {
    if (!event || typeof event !== 'object') return;
    result.push({
      ...event,
      eventType: event.eventType || event.type || event._type || bucket,
    });
    for (const key of ['subevents', 'subEvents', 'children']) {
      for (const child of toArray(event[key])) {
        visit(child, bucket);
      }
    }
  };

  for (const key of [
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
  ]) {
    for (const event of toArray(layer[key])) {
      visit(event, key);
    }
  }

  return result;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeTagList(value) {
  return [...new Set(
    toArray(value)
      .map((item) => normalizeText(item))
      .filter(Boolean),
  )];
}

function stableId(prefix, seed) {
  const normalized = normalizeText(seed)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_')
    .slice(0, 64);
  return `${prefix}_${normalized || randomUUID().slice(0, 8)}`;
}

function dedupeTimeline(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of toArray(items)) {
    const key = [
      normalizeText(item?.eventId || item?.id || ''),
      toNumber(item?.chapter, ''),
      normalizeText(item?.summary || item?.description || ''),
    ].join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      eventId: item?.eventId || item?.id || null,
      chapter: toNumber(item?.chapter, null),
      summary: normalizeText(item?.summary || item?.description || ''),
    });
  }
  return result;
}

export function buildCanonicalCorpus(chunks = []) {
  const chapterMap = new Map();
  const normalizedChunks = [];

  for (const chunk of toArray(chunks)) {
    const chapterArrayIndex = toNumber(chunk.chapterIndex, 0);
    const chapterNumber = chapterArrayIndex + 1;
    const text = normalizeText(chunk.text);
    if (!text) continue;

    if (!chapterMap.has(chapterNumber)) {
      chapterMap.set(chapterNumber, {
        chapterNumber,
        chapterArrayIndex,
        chapterId: chunk.chapterId || `chapter_${chapterNumber}`,
        title: normalizeText(chunk.title || `Chapter ${chapterNumber}`),
        chunks: [],
      });
    }

    const spanId = chunk.spanId || `${chunk.id || `chunk_${chapterNumber}_${chunk.chunkIndex || 0}`}:span:1`;
    const normalizedChunk = {
      chunkId: chunk.id || `chunk_${chapterNumber}_${chunk.chunkIndex || normalizedChunks.length}`,
      chapterId: chunk.chapterId || `chapter_${chapterNumber}`,
      chapterNumber,
      chunkIndex: toNumber(chunk.chunkIndex, normalizedChunks.length),
      startPosition: toNumber(chunk.startPosition, null),
      wordCount: toNumber(chunk.wordCount, text.split(/\s+/u).length),
      text,
      evidenceSpans: [
        {
          spanId,
          chunkId: chunk.id || `chunk_${chapterNumber}_${chunk.chunkIndex || normalizedChunks.length}`,
          chapterNumber,
          startOffset: 0,
          endOffset: text.length,
          snippet: text.slice(0, 320),
        },
      ],
    };

    chapterMap.get(chapterNumber).chunks.push(normalizedChunk);
    normalizedChunks.push(normalizedChunk);
  }

  const chapters = [...chapterMap.values()]
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .map((chapter) => {
      const orderedChunks = chapter.chunks
        .slice()
        .sort((left, right) => {
          const leftPos = toNumber(left.startPosition, Number.MAX_SAFE_INTEGER);
          const rightPos = toNumber(right.startPosition, Number.MAX_SAFE_INTEGER);
          return leftPos - rightPos || left.chunkIndex - right.chunkIndex;
        });
      return {
        chapterId: chapter.chapterId,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        text: orderedChunks.map((item) => item.text).join('\n\n').trim(),
        chunkIds: orderedChunks.map((item) => item.chunkId),
      };
    });

  return {
    chapterCount: chapters.length,
    chapters,
    storageChunks: normalizedChunks,
    evidenceSpans: normalizedChunks.flatMap((chunk) => chunk.evidenceSpans),
  };
}

export function buildAnalysisWindows(chapters = [], options = {}) {
  const chapterList = toArray(chapters)
    .map((item) => ({
      chapterNumber: toNumber(item.chapterNumber, null),
      chapterId: item.chapterId || null,
      title: normalizeText(item.title || ''),
    }))
    .filter((item) => Number.isFinite(item.chapterNumber))
    .sort((left, right) => left.chapterNumber - right.chapterNumber);

  if (!chapterList.length) return [];

  const total = chapterList.length;
  const requestedSize = toNumber(options.windowSize, null);
  const requestedOverlap = toNumber(options.windowOverlap, null);
  const windowSize = Math.max(3, requestedSize || (total <= 8 ? 4 : total <= 20 ? 6 : 8));
  const overlap = Math.max(1, Math.min(windowSize - 1, requestedOverlap || Math.max(1, Math.floor(windowSize / 3))));
  const step = Math.max(1, windowSize - overlap);
  const windows = [];

  for (let start = 0; start < chapterList.length; start += step) {
    const slice = chapterList.slice(start, start + windowSize);
    if (!slice.length) continue;
    const windowOrder = windows.length + 1;
    const chapterNumbers = slice.map((item) => item.chapterNumber);
    windows.push({
      id: `window:${windowOrder}`,
      windowId: `window_${String(windowOrder).padStart(2, '0')}`,
      windowOrder,
      chapterStart: chapterNumbers[0],
      chapterEnd: chapterNumbers[chapterNumbers.length - 1],
      overlapFromPrevious: windows.length === 0 ? 0 : overlap,
      chapterNumbers,
      carryIn: null,
      carryOut: null,
      openBoundaries: [],
      incidents: [],
      status: 'pending',
      promptVersion: 'v3',
      schemaVersion: 'v3',
    });

    if (chapterNumbers[chapterNumbers.length - 1] >= chapterList[chapterList.length - 1].chapterNumber) {
      break;
    }
  }

  return windows;
}

function incidentRange(incident = {}) {
  const start = toNumber(
    incident.chapterStart ?? incident.chapterStartNumber ?? incident.startChapter ?? incident.chapterRange?.[0],
    null,
  );
  const end = toNumber(
    incident.chapterEnd ?? incident.chapterEndNumber ?? incident.endChapter ?? incident.chapterRange?.[1],
    start,
  );
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [null, null];
  return [Math.min(start, end), Math.max(start, end)];
}

function buildCarryPacket(incident, window) {
  const [start, end] = incidentRange(incident);
  return {
    id: `carry:${incident.id || stableId('incident', incident.title || randomUUID())}:${window.windowId}`,
    incidentId: incident.id || null,
    title: normalizeText(incident.title || incident.description || 'Boundary incident'),
    chapterRange: [start, end],
    evidence: toArray(incident.primaryEvidenceRefs || incident.evidence || []).slice(0, 3),
    reason: 'incident_crosses_window_boundary',
    unresolvedNotes: [
      normalizeText(incident.boundaryNote || incident.why || 'Window boundary needs reducer confirmation'),
    ].filter(Boolean),
    sourceWindowId: window.windowId,
  };
}

export function materializeWindowResults(windows = [], incidents = []) {
  const resultWindows = windows.map((window) => ({
    ...window,
    incidents: [],
    openBoundaries: [],
    carryIn: window.carryIn || null,
    carryOut: null,
    status: 'completed',
  }));
  const carryPackets = [];

  for (const rawIncident of toArray(incidents)) {
    const incident = {
      ...rawIncident,
      id: rawIncident.id || stableId('inc', rawIncident.title || rawIncident.description || randomUUID()),
    };
    const [start, end] = incidentRange(incident);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    for (const window of resultWindows) {
      const overlaps = start <= window.chapterEnd && end >= window.chapterStart;
      if (!overlaps) continue;
      window.incidents.push({
        id: incident.id,
        title: normalizeText(incident.title || incident.description || ''),
        type: incident.type || 'subplot',
        chapterStart: start,
        chapterEnd: end,
        confidence: clamp(incident.confidence, 0, 1, 0.65),
        evidence: toArray(incident.primaryEvidenceRefs || incident.evidence || []).slice(0, 4),
        boundaryNote: normalizeText(incident.boundaryNote || ''),
      });

      const touchesBoundary = end > window.chapterEnd || start < window.chapterStart;
      if (touchesBoundary) {
        const carryPacket = buildCarryPacket(incident, window);
        window.openBoundaries.push({
          incidentId: incident.id,
          title: carryPacket.title,
          chapterRange: carryPacket.chapterRange,
          reason: carryPacket.reason,
        });
        window.carryOut = window.carryOut || [];
        window.carryOut.push(carryPacket);
        carryPackets.push(carryPacket);
      }
    }
  }

  resultWindows.forEach((window, index) => {
    if (index === 0) return;
    const previous = resultWindows[index - 1];
    window.carryIn = toArray(previous.carryOut);
  });

  return {
    windows: resultWindows,
    carryPackets,
  };
}

export function buildIncidentMap(incidents = [], windows = [], carryPackets = []) {
  const normalized = toArray(incidents).map((incident) => {
    const [start, end] = incidentRange(incident);
    const supportingWindowIds = toArray(windows)
      .filter((window) => start <= window.chapterEnd && end >= window.chapterStart)
      .map((window) => window.windowId);
    const lineage = {
      merged_from: toArray(incident.merged_from || incident.mergedFrom),
      split_from: toArray(incident.split_from || incident.splitFrom),
      supporting_window_ids: supportingWindowIds,
      decision_reason: normalizeText(
        incident.decision_reason
        || incident.decisionReason
        || (supportingWindowIds.length > 1 ? 'Merged across overlapping windows' : 'Accepted from single window'),
      ),
    };

    return {
      id: incident.id || stableId('inc', incident.title || randomUUID()),
      title: normalizeText(incident.title || incident.description || 'Untitled incident'),
      type: incident.type || 'subplot',
      chapterStart: start,
      chapterEnd: end,
      confidence: clamp(incident.confidence, 0, 1, 0.65),
      summary: normalizeText(incident.description || incident.summary || ''),
      detailedSummary: normalizeText(incident.detailedSummary || incident.detailed_summary || incident.description || ''),
      climax: normalizeText(incident.climax || ''),
      outcome: normalizeText(incident.outcome || ''),
      consequences: toArray(incident.consequences).map((item) => normalizeText(item)).filter(Boolean),
      primaryEvidenceRefs: toArray(
        incident.primaryEvidenceRefs
        || incident.primary_evidence_refs
        || incident.evidence_refs
        || incident.evidence,
      ).map((item) => normalizeText(item)).filter(Boolean).slice(0, 6),
      entityRefs: toObject(incident.entityRefs || incident.entity_refs),
      reviewStatus: incident.reviewStatus || 'needs_review',
      degradedFlags: toArray(incident.degradedFlags || incident.degraded_flags),
      lineage,
      rerunScope: {
        phase: 'incident',
        incidentIds: [incident.id],
        windowIds: supportingWindowIds,
      },
    };
  });

  return {
    canonical_incident_map: normalized.map((item) => ({
      id: item.id,
      title: item.title,
      chapterStart: item.chapterStart,
      chapterEnd: item.chapterEnd,
      confidence: item.confidence,
      lineage: item.lineage,
    })),
    reducer: {
      carry_packet_count: toArray(carryPackets).length,
      window_count: toArray(windows).length,
      incident_count: normalized.length,
    },
    incidents: normalized,
  };
}

export function buildIncidentBeats(events = [], incidents = []) {
  const sortedEvents = toArray(events)
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort((left, right) => {
      const leftChapter = toNumber(left.chapterNumber ?? left.chapter ?? left.chapterIndex, Number.MAX_SAFE_INTEGER);
      const rightChapter = toNumber(right.chapterNumber ?? right.chapter ?? right.chapterIndex, Number.MAX_SAFE_INTEGER);
      return leftChapter - rightChapter || String(left.id || '').localeCompare(String(right.id || ''));
    });
  const incidentMap = new Map(toArray(incidents).map((item) => [item.id, item]));
  const sequences = new Map();

  return sortedEvents.map((event) => {
    const incidentId = event.incidentId || event.incident_id || nearestIncidentId(event, incidents);
    const sequence = (sequences.get(incidentId) || 0) + 1;
    sequences.set(incidentId, sequence);
    const summary = normalizeText(event.description || event.title || `Beat ${sequence}`);

    return {
      id: event.beatId || `beat:${event.id || stableId('evt', summary)}`,
      incidentId,
      sequence,
      chapterNumber: toNumber(event.chapterNumber ?? event.chapter ?? event.chapterIndex, null),
      beatType: normalizeText(event.eventType || event.type || event.linkRole || 'beat') || 'beat',
      summary,
      causalLinks: toObject(event.causalLinks || event.causal_links || { causes: [], causedBy: [] }),
      evidenceRefs: toArray(event.evidence || event.evidenceRefs || event.evidence_refs).map((item) => normalizeText(item)).filter(Boolean).slice(0, 4),
      confidence: clamp(event.confidence, 0, 1, incidentMap.get(incidentId)?.confidence ?? 0.6),
      sourceEventId: event.id || null,
      characters: toArray(event.characters).map((item) => normalizeText(item)).filter(Boolean),
      objects: toArray(event.objects).map((item) => normalizeText(item)).filter(Boolean),
      terms: toArray(event.terms).map((item) => normalizeText(item)).filter(Boolean),
      tags: toArray(event.tags).map((item) => normalizeText(item)).filter(Boolean),
      locationName: normalizeText(
        event.locationName
        || event.primaryLocationName
        || event.locationLink?.locationName
        || '',
      ),
      locationId: normalizeText(
        event.locationId
        || event.primaryLocationId
        || event.locationLink?.locationId
        || '',
      ) || null,
      sourceEvent: event,
      payload: event,
    };
  });
}

function nearestIncidentId(event, incidents = []) {
  const chapter = toNumber(event.chapterNumber ?? event.chapter ?? event.chapterIndex, null);
  for (const incident of toArray(incidents)) {
    const [start, end] = incidentRange(incident);
    if (Number.isFinite(chapter) && chapter >= start && chapter <= end) {
      return incident.id;
    }
  }
  return toArray(incidents)[0]?.id || null;
}

export function buildCanonicalEntities(knowledge = {}, incidents = [], beats = []) {
  const source = toObject(knowledge);
  const entities = [];
  const entityById = new Map();
  const mentions = [];

  const registerEntity = (kind, item) => {
    const name = normalizeText(item?.name || item?.term || item?.location || item?.object || '');
    if (!name) return null;
    const entityId = item.id || stableId(kind, name);
    const isCharacter = kind === 'character';
    const nextEntity = {
      id: entityId,
      entityKind: kind,
      name,
      normalizedName: stableId(kind, name).replace(`${kind}_`, ''),
      aliases: toArray(item.aliases).map((value) => normalizeText(value)).filter(Boolean),
      summary: normalizeText(item.summary || item.definition || ''),
      description: normalizeText(item.description || item.appearance || ''),
      confidence: clamp(item.confidence, 0, 1, 0.72),
      reviewStatus: item.reviewStatus || 'auto_accepted',
      timeline: dedupeTimeline(item.timeline),
      ...(isCharacter ? {
        role: normalizeText(item.role || item.roleHint || ''),
        appearance: normalizeText(item.appearance || ''),
        personality: normalizeText(item.personality || ''),
        personalityTags: normalizeTagList(item.personalityTags || item.personality_tags || item.traits),
        flaws: normalizeText(item.flaws || ''),
        goals: normalizeText(item.goals || item.goal || ''),
        secrets: normalizeText(item.secrets || item.secret || ''),
      } : {}),
      payload: item,
    };
    const existing = entityById.get(entityId);
    if (existing) {
      existing.aliases = [...new Set([...toArray(existing.aliases), ...toArray(nextEntity.aliases)])];
      existing.summary = existing.summary || nextEntity.summary;
      existing.description = existing.description || nextEntity.description;
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(nextEntity.confidence || 0));
      existing.reviewStatus = existing.reviewStatus === 'auto_accepted' || nextEntity.reviewStatus !== 'auto_accepted'
        ? existing.reviewStatus
        : nextEntity.reviewStatus;
      existing.timeline = dedupeTimeline([...toArray(existing.timeline), ...toArray(nextEntity.timeline)]);
      if (isCharacter) {
        existing.role = existing.role || nextEntity.role;
        existing.appearance = existing.appearance || nextEntity.appearance;
        existing.personality = existing.personality || nextEntity.personality;
        existing.personalityTags = normalizeTagList([
          ...toArray(existing.personalityTags),
          ...toArray(nextEntity.personalityTags),
        ]);
        existing.flaws = existing.flaws || nextEntity.flaws;
        existing.goals = existing.goals || nextEntity.goals;
        existing.secrets = existing.secrets || nextEntity.secrets;
      }
      if ((!existing.payload || Object.keys(existing.payload).length === 0) && nextEntity.payload) {
        existing.payload = nextEntity.payload;
      }
      return entityId;
    }
    entityById.set(entityId, nextEntity);
    entities.push(nextEntity);
    return entityId;
  };

  const characterIdByName = new Map();
  const locationIdByName = new Map();
  const objectIdByName = new Map();
  const termIdByName = new Map();

  for (const item of toArray(source.characters)) {
    const entityId = registerEntity('character', item);
    if (entityId) characterIdByName.set(normalizeText(item.name).toLowerCase(), entityId);
  }
  for (const item of toArray(source.locations)) {
    const entityId = registerEntity('location', item);
    if (entityId) locationIdByName.set(normalizeText(item.name).toLowerCase(), entityId);
  }
  for (const item of toArray(source.objects)) {
    const entityId = registerEntity('object', item);
    if (entityId) objectIdByName.set(normalizeText(item.name).toLowerCase(), entityId);
  }
  for (const item of toArray(source.terms)) {
    const entityId = registerEntity('term', item);
    if (entityId) termIdByName.set(normalizeText(item.name).toLowerCase(), entityId);
  }

  for (const beat of toArray(beats)) {
    const addMention = (kind, surfaceForm, canonicalEntityId, evidenceRef = null) => {
      const normalizedSurface = normalizeText(surfaceForm);
      if (!normalizedSurface) return;
      mentions.push({
        id: `mention:${beat.id}:${kind}:${mentions.length + 1}`,
        beatId: beat.id,
        entityKind: kind,
        surfaceForm: normalizedSurface,
        canonicalEntityId,
        chapterNumber: beat.chapterNumber ?? null,
        evidenceRef: normalizeText(evidenceRef || beat.evidenceRefs?.[0] || ''),
      });
    };

    const beatPayload = toObject(beat.sourceEvent || beat.payload);
    for (const character of toArray(beatPayload.characters)) {
      const key = normalizeText(character).toLowerCase();
      addMention('character', character, characterIdByName.get(key) || null);
    }
    const locationName = normalizeText(
      beatPayload.locationName
      || beatPayload.primaryLocationName
      || beatPayload.locationLink?.locationName
      || '',
    );
    if (locationName) {
      addMention('location', locationName, locationIdByName.get(locationName.toLowerCase()) || null);
    }
    for (const object of toArray(beatPayload.objects)) {
      const key = normalizeText(object).toLowerCase();
      addMention('object', object, objectIdByName.get(key) || null);
    }
    for (const term of toArray(beatPayload.terms)) {
      const key = normalizeText(term).toLowerCase();
      addMention('term', term, termIdByName.get(key) || null);
    }
  }

  for (const incident of toArray(incidents)) {
    for (const [kind, values] of Object.entries(toObject(incident.entityRefs))) {
      for (const surface of toArray(values)) {
        const normalized = normalizeText(surface);
        if (!normalized) continue;
        mentions.push({
          id: `mention:incident:${incident.id}:${kind}:${mentions.length + 1}`,
          beatId: null,
          entityKind: kind,
          surfaceForm: normalized,
          canonicalEntityId: null,
          chapterNumber: incident.chapterStart ?? null,
          evidenceRef: incident.primaryEvidenceRefs?.[0] || '',
        });
      }
    }
  }

  return {
    entities,
    mentions,
    canonicalEntities: {
      characters: entities.filter((item) => item.entityKind === 'character'),
      locations: entities.filter((item) => item.entityKind === 'location'),
      objects: entities.filter((item) => item.entityKind === 'object'),
      terms: entities.filter((item) => item.entityKind === 'term'),
      worldProfile: toObject(source.world_profile || source.worldProfile),
    },
  };
}

export function buildGraphProjections(storyGraph = {}) {
  const nodes = toArray(storyGraph.nodes);
  const edges = toArray(storyGraph.edges);

  const classifyEdge = (edge) => {
    const type = normalizeText(edge.type).toLowerCase();
    if (type === 'incident_contains_event') return null;
    if (type.startsWith('incident_')) return 'incident';
    if (type.includes('causes')) return 'causal';
    if (type.includes('character')) return 'character_state';
    if (type.includes('location')) return 'location_transition';
    return 'incident';
  };

  const edgeKinds = new Map();
  for (const edge of edges) {
    const graphKind = classifyEdge(edge);
    if (graphKind) {
      edgeKinds.set(edge.id, graphKind);
    }
  }

  const cloneNode = (node, graphKind) => ({
    ...node,
    graphKind,
  });
  const cloneEdge = (edge, graphKind) => ({
    ...edge,
    graphKind,
  });

  const projections = {
    incident: { nodes: [], edges: [] },
    causal: { nodes: [], edges: [] },
    character_state: { nodes: [], edges: [] },
    location_transition: { nodes: [], edges: [] },
  };

  for (const edge of edges) {
    const graphKind = edgeKinds.get(edge.id);
    if (!graphKind) continue;
    projections[graphKind].edges.push(cloneEdge(edge, graphKind));
  }

  for (const [graphKind, projection] of Object.entries(projections)) {
    const nodeIds = new Set(projection.edges.flatMap((edge) => [edge.from, edge.to]));
    if (graphKind === 'incident') {
      for (const node of nodes.filter((item) => item.type === 'incident')) {
        nodeIds.add(node.id);
      }
    }
    for (const node of nodes) {
      if (graphKind === 'incident' && node.type === 'event') {
        continue;
      }
      if (nodeIds.has(node.id)) {
        projection.nodes.push(cloneNode(node, graphKind));
      }
    }
  }

  return projections;
}

export function buildRerunManifest({ windows = [], incidents = [], reviewQueue = [], passStatus = {} } = {}) {
  return {
    phases: Object.fromEntries(
      Object.entries(toObject(passStatus)).map(([key, value]) => [
        key,
        {
          status: value?.status || 'pending',
          retries: value?.retries || 0,
          repaired: Boolean(value?.repaired),
        },
      ]),
    ),
    scopes: {
      windows: toArray(windows).map((item) => ({
        windowId: item.windowId,
        dependsOn: ['pass_0'],
        invalidates: ['pass_a', 'pass_d', 'pass_e'],
      })),
      incidents: toArray(incidents).map((item) => ({
        incidentId: item.id,
        dependsOnWindowIds: toArray(item.lineage?.supporting_window_ids),
        invalidates: ['pass_b', 'pass_c', 'pass_d', 'pass_e'],
      })),
      reviewItems: toArray(reviewQueue).map((item) => ({
        reviewItemId: item.id,
        rerunScope: item.rerunScope || item.rerun_scope || item.rerun_scope_type || 'incident',
        relatedWindowIds: toArray(item.relatedWindowIds || item.related_window_ids),
        relatedIncidentIds: toArray(item.relatedIncidentIds || item.related_incident_ids),
      })),
    },
  };
}

export function buildAnalysisArtifactV3({
  corpusId,
  analysisId,
  chunks = [],
  finalResult = {},
} = {}) {
  const canonicalCorpus = buildCanonicalCorpus(chunks);
  const windowsBase = buildAnalysisWindows(canonicalCorpus.chapters, finalResult.meta || {});
  const rawIncidents = toArray(finalResult.incidents);
  const rawEvents = flattenSourceEvents(finalResult.incident_beats?.length ? finalResult.incident_beats : finalResult.events);
  const { windows, carryPackets } = materializeWindowResults(windowsBase, rawIncidents);
  const incidentMap = buildIncidentMap(rawIncidents, windows, carryPackets);
  const beats = finalResult.incident_beats?.length
    ? toArray(finalResult.incident_beats)
    : buildIncidentBeats(rawEvents, incidentMap.incidents);
  const fallbackKnowledge = {
    characters: (
      finalResult.characters?.profiles
      || finalResult.characterProfiles
      || finalResult.structural?.characters
      || []
    ),
    locations: finalResult.locations || [],
    objects: finalResult.objects || [],
    terms: finalResult.terms || [],
    world_profile: (
      finalResult.world_profile
      || finalResult.worldProfile
      || finalResult.knowledge?.world_profile
      || finalResult.knowledge?.worldProfile
      || null
    ),
  };
  const canonical = buildCanonicalEntities(
    finalResult.canonical_entities
    || finalResult.knowledge
    || fallbackKnowledge,
    incidentMap.incidents,
    beats,
  );
  const graphProjections = buildGraphProjections(finalResult.story_graph || finalResult.storyGraph || {});
  const reviewQueue = toArray(finalResult.reviewQueue || finalResult.review_queue).map((item) => ({
    ...item,
    sourcePhase: item.sourcePhase || 'pass_e',
    rerunScope: item.rerunScope || item.rerun_scope || inferRerunScope(item),
    relatedWindowIds: toArray(item.relatedWindowIds || item.related_window_ids || []),
    relatedIncidentIds: toArray(item.relatedIncidentIds || item.related_incident_ids || [
      item.itemType === 'incident' ? item.itemId : null,
    ]).filter(Boolean),
    suggestedAction: item.suggestedAction || item.suggested_action || inferSuggestedAction(item),
  }));
  const rerunManifest = buildRerunManifest({
    windows,
    incidents: incidentMap.incidents,
    reviewQueue,
    passStatus: finalResult.pass_status || {},
  });

  return {
    artifact_version: 'v3',
    canonical_corpus: canonicalCorpus,
    analysis_windows: windows.map((item) => ({
      ...item,
      carryIn: item.carryIn,
      carryOut: item.carryOut,
    })),
    window_results: windows.map((item) => ({
      windowId: item.windowId,
      status: item.status,
      incidents: item.incidents,
      open_boundaries: item.openBoundaries,
    })),
    carry_packets: carryPackets,
    incident_map: incidentMap,
    incidents: incidentMap.incidents,
    incident_beats: beats,
    entity_mentions: canonical.mentions,
    canonical_entities: canonical.canonicalEntities,
    graph_projections: graphProjections,
    review_queue: reviewQueue,
    pass_status: finalResult.pass_status || {},
    rerun_manifest: rerunManifest,
    degraded_run_report: finalResult.degraded_run_report || { hasDegradedPasses: false, items: [] },
    meta: {
      ...(toObject(finalResult.meta)),
      artifactVersion: 'v3',
      corpusId,
      analysisId,
    },
  };
}

function inferRerunScope(item = {}) {
  const type = normalizeText(item.itemType || item.item_type).toLowerCase();
  if (type === 'incident') return 'incident';
  if (type === 'event' || type === 'beat') return 'incident';
  if (type === 'location' || type === 'object' || type === 'term') return 'world_canonicalizer';
  if (type === 'character') return 'character_canonicalizer';
  return 'graph_projection';
}

function inferSuggestedAction(item = {}) {
  const reasons = toArray(item.reason).map((value) => normalizeText(value).toLowerCase());
  if (reasons.some((value) => value.includes('boundary'))) return 'Kiểm tra ranh giới window và chạy lại reducer';
  if (reasons.some((value) => value.includes('timeline') || value.includes('causal'))) return 'Kiểm tra quan hệ đồ thị và chạy lại incident liên quan';
  return 'Kiểm tra mục này và chạy lại đúng scope nếu cần';
}
