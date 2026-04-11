function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function pushNode(nodes, nodeMap, node) {
  if (!node?.id || nodeMap.has(node.id)) return;
  nodeMap.set(node.id, node);
  nodes.push(node);
}

function pushEdge(edges, edgeMap, edge) {
  if (!edge?.id || edgeMap.has(edge.id)) return;
  edgeMap.set(edge.id, edge);
  edges.push(edge);
}

function evidenceRefs(item = {}) {
  const refs = [];
  const evidence = toArray(item.evidence);
  for (const snippet of evidence.slice(0, 3)) {
    const text = normalizeText(snippet);
    if (text) refs.push(text);
  }
  if (item.evidenceSnippet) {
    const text = normalizeText(item.evidenceSnippet);
    if (text) refs.push(text);
  }
  return [...new Set(refs)].slice(0, 4);
}

export function buildStoryGraph({
  incidents = [],
  events = [],
  knowledge = {},
  relationships = [],
} = {}) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const edgeMap = new Map();

  const locationRecords = toArray(knowledge.locations);
  const characters = [
    ...toArray(knowledge.characters),
    ...collectCharacterRecords(events),
  ];
  const objects = toArray(knowledge.objects);
  const terms = toArray(knowledge.terms);
  const locationNodeIdByName = new Map();
  const characterNodeIdByName = new Map();
  const objectNodeIdByName = new Map();
  const eventNodeIdSet = new Set();

  for (const incident of toArray(incidents)) {
    pushNode(nodes, nodeMap, {
      id: incident.id,
      type: 'incident',
      label: normalizeText(incident.title || incident.description || incident.id),
      chapterNumber: incident.chapterStart ?? incident.chapterStartNumber ?? null,
      chapterStart: incident.chapterStart ?? null,
      chapterEnd: incident.chapterEnd ?? null,
      confidence: clamp(incident.confidence, 0, 1, 0.65),
      provenance: {
        sourcePass: 'pass_a',
        reviewStatus: incident.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(incident),
      },
    });
  }

  for (const event of toArray(events)) {
    eventNodeIdSet.add(event.id);
    pushNode(nodes, nodeMap, {
      id: event.id,
      type: 'event',
      label: normalizeText(event.description || event.title || event.id),
      chapterNumber: event.chapter ?? event.chapterNumber ?? null,
      confidence: clamp(event.confidence ?? event.chapterConfidence, 0, 1, 0.65),
      provenance: {
        sourcePass: 'pass_b',
        reviewStatus: event.reviewStatus || (event.needsReview ? 'needs_review' : 'auto_accepted'),
        evidenceRefs: evidenceRefs(event),
      },
    });
  }

  for (const character of characters) {
    const id = normalizeText(character.id || '') || `character:${normalizeText(character.name).toLowerCase()}`;
    characterNodeIdByName.set(normalizeText(character.name).toLowerCase(), id);
    pushNode(nodes, nodeMap, {
      id,
      type: 'character',
      label: normalizeText(character.name),
      confidence: 0.8,
      provenance: {
        sourcePass: 'pass_c',
        reviewStatus: 'auto_accepted',
        evidenceRefs: evidenceRefs(character),
      },
    });
  }

  for (const location of locationRecords) {
    const id = normalizeText(location.id || '') || `location:${normalizeText(location.name).toLowerCase()}`;
    locationNodeIdByName.set(normalizeText(location.name).toLowerCase(), id);
    pushNode(nodes, nodeMap, {
      id,
      type: 'location',
      label: normalizeText(location.name),
      confidence: clamp(location.confidence, 0, 1, 0.75),
      provenance: {
        sourcePass: 'pass_c',
        reviewStatus: location.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(location),
      },
    });
  }

  for (const object of objects) {
    const id = normalizeText(object.id || '') || `object:${normalizeText(object.name).toLowerCase()}`;
    objectNodeIdByName.set(normalizeText(object.name).toLowerCase(), id);
    pushNode(nodes, nodeMap, {
      id,
      type: 'object',
      label: normalizeText(object.name),
      confidence: 0.7,
      provenance: {
        sourcePass: 'pass_c',
        reviewStatus: 'auto_accepted',
        evidenceRefs: evidenceRefs(object),
      },
    });
  }

  for (const term of terms) {
    const id = normalizeText(term.id || '') || `term:${normalizeText(term.name).toLowerCase()}`;
    pushNode(nodes, nodeMap, {
      id,
      type: 'term',
      label: normalizeText(term.name),
      confidence: 0.7,
      provenance: {
        sourcePass: 'pass_c',
        reviewStatus: 'auto_accepted',
        evidenceRefs: evidenceRefs(term),
      },
    });
  }

  for (const event of toArray(events)) {
    const linkedIncidentIds = new Set([
      ...(event.incidentId ? [event.incidentId] : []),
      ...toArray(event.secondaryIncidentIds),
    ]);

    for (const incidentId of linkedIncidentIds) {
      if (!nodeMap.has(incidentId) || !nodeMap.has(event.id)) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${incidentId}:contains:${event.id}`,
        type: 'incident_contains_event',
        from: incidentId,
        to: event.id,
        confidence: clamp(event.confidence ?? event.chapterConfidence, 0, 1, 0.65),
        sourcePass: 'pass_b',
        reviewStatus: event.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(event),
      });
    }

    const locationName = normalizeText(
      event.locationName || event.primaryLocationName || event.locationLink?.locationName || '',
    );
    if (locationName) {
      const locationNodeId = locationNodeIdByName.get(locationName.toLowerCase());
      if (locationNodeId) {
        pushEdge(edges, edgeMap, {
          id: `edge:${event.id}:location:${locationNodeId}`,
          type: 'event_occurs_at_location',
          from: event.id,
          to: locationNodeId,
          confidence: clamp(event.locationLink?.confidence, 0, 1, 0.65),
          sourcePass: 'pass_c',
          reviewStatus: event.reviewStatus || 'needs_review',
          evidenceRefs: evidenceRefs(event),
        });
      }
    }

    for (const characterName of toArray(event.characters)) {
      const normalizedName = normalizeText(characterName);
      const characterNodeId = characterNodeIdByName.get(normalizedName.toLowerCase());
      if (!characterNodeId) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${characterNodeId}:present:${event.id}`,
        type: 'character_present_in_event',
        from: characterNodeId,
        to: event.id,
        confidence: clamp(event.confidence, 0, 1, 0.65),
        sourcePass: 'pass_b',
        reviewStatus: event.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(event),
      });
    }

    for (const object of objects) {
      const objectName = normalizeText(object?.name);
      if (!objectName) continue;
      const objectNodeId = objectNodeIdByName.get(objectName.toLowerCase());
      if (!objectNodeId) continue;
      const haystack = normalizeText(
        `${event.description || ''} ${event.title || ''} ${toArray(event.objects).join(' ')}`,
      ).toLowerCase();
      if (!haystack.includes(objectName.toLowerCase())) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${objectNodeId}:used:${event.id}`,
        type: 'object_used_in_event',
        from: objectNodeId,
        to: event.id,
        confidence: clamp(event.confidence, 0, 1, 0.58),
        sourcePass: 'pass_c',
        reviewStatus: event.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(event),
      });
    }

    const causedBy = toArray(event.causalLinks?.causedBy);
    for (const fromEventId of causedBy) {
      if (!nodeMap.has(fromEventId) || !nodeMap.has(event.id)) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${fromEventId}:causes:${event.id}`,
        type: 'event_causes_event',
        from: fromEventId,
        to: event.id,
        confidence: clamp(event.confidence, 0, 1, 0.6),
        sourcePass: 'pass_b',
        reviewStatus: event.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(event),
      });
    }
  }

  const sortedIncidents = toArray(incidents)
    .slice()
    .sort((left, right) => Number(left.chapterStart || 999999) - Number(right.chapterStart || 999999));
  for (let index = 1; index < sortedIncidents.length; index += 1) {
    const previous = sortedIncidents[index - 1];
    const current = sortedIncidents[index];
    if (!previous?.id || !current?.id) continue;
    pushEdge(edges, edgeMap, {
      id: `edge:${previous.id}:precedes:${current.id}`,
      type: 'incident_precedes_incident',
      from: previous.id,
      to: current.id,
      confidence: 0.75,
      sourcePass: 'pass_e',
      reviewStatus: 'auto_accepted',
      evidenceRefs: [],
    });
  }

  for (const incident of toArray(incidents)) {
    const fromIncidentId = incident?.id;
    if (!fromIncidentId || !nodeMap.has(fromIncidentId)) continue;

    for (const targetIncidentId of toArray(incident.causalSuccessors)) {
      if (!nodeMap.has(targetIncidentId)) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${fromIncidentId}:causes:${targetIncidentId}`,
        type: 'incident_causes_incident',
        from: fromIncidentId,
        to: targetIncidentId,
        confidence: clamp(incident.confidence, 0, 1, 0.68),
        sourcePass: 'pass_d',
        reviewStatus: incident.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(incident),
      });
    }
  }

  for (const relation of toArray(relationships)) {
    const source = normalizeText(
      relation.source
      || relation.characterA
      || relation.character_a
      || relation.character1Id
      || relation.character1
      || '',
    );
    const target = normalizeText(
      relation.target
      || relation.characterB
      || relation.character_b
      || relation.character2Id
      || relation.character2
      || '',
    );
    if (!source || !target) continue;
    const sourceNode = nodes.find((node) => node.type === 'character' && node.label.toLowerCase() === source.toLowerCase());
    const targetNode = nodes.find((node) => node.type === 'character' && node.label.toLowerCase() === target.toLowerCase());
    if (!sourceNode || !targetNode) continue;
    pushEdge(edges, edgeMap, {
      id: `edge:${sourceNode.id}:related:${targetNode.id}:${normalizeText(relation.type || relation.relation_type || 'related')}`,
      type: 'character_related_to_character',
      from: sourceNode.id,
      to: targetNode.id,
      confidence: clamp(relation.confidence, 0, 1, 0.65),
      sourcePass: 'pass_e',
      reviewStatus: 'needs_review',
      evidenceRefs: [],
    });
  }

  for (const incident of toArray(incidents)) {
    const incidentNodeId = incident?.id;
    if (!incidentNodeId || !nodeMap.has(incidentNodeId)) continue;
    for (const relatedLocation of toArray(incident.relatedLocations)) {
      const locationNodeId = locationNodeIdByName.get(normalizeText(relatedLocation).toLowerCase());
      if (!locationNodeId) continue;
      pushEdge(edges, edgeMap, {
        id: `edge:${incidentNodeId}:incident_location:${locationNodeId}`,
        type: 'incident_occurs_at_location',
        from: incidentNodeId,
        to: locationNodeId,
        confidence: clamp(incident.confidence, 0, 1, 0.6),
        sourcePass: 'pass_e',
        reviewStatus: incident.reviewStatus || 'needs_review',
        evidenceRefs: evidenceRefs(incident),
      });
    }
  }

  const coPresence = buildCharacterCoPresence(events);
  for (const relation of coPresence) {
    const fromId = characterNodeIdByName.get(relation.left.toLowerCase());
    const toId = characterNodeIdByName.get(relation.right.toLowerCase());
    if (!fromId || !toId) continue;
    pushEdge(edges, edgeMap, {
      id: `edge:${fromId}:copresence:${toId}`,
      type: 'character_related_to_character',
      from: fromId,
      to: toId,
      confidence: clamp(0.45 + (relation.count * 0.1), 0, 1, 0.55),
      sourcePass: 'pass_e',
      reviewStatus: relation.count >= 3 ? 'auto_accepted' : 'needs_review',
      evidenceRefs: relation.evidenceRefs,
    });
  }

  const isolatedNodeIds = nodes
    .filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id))
    .map((node) => node.id);
  const edgeTypes = edges.reduce((acc, edge) => {
    const key = edge.type || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      incidents: nodes.filter((node) => node.type === 'incident').length,
      events: nodes.filter((node) => node.type === 'event').length,
      characters: nodes.filter((node) => node.type === 'character').length,
      locations: nodes.filter((node) => node.type === 'location').length,
      objects: nodes.filter((node) => node.type === 'object').length,
      terms: nodes.filter((node) => node.type === 'term').length,
      edgeTypes,
      isolatedNodeCount: isolatedNodeIds.length,
      isolatedNodeIds,
    },
  };
}

function collectCharacterRecords(events = []) {
  const map = new Map();
  for (const event of toArray(events)) {
    for (const rawName of toArray(event?.characters)) {
      const name = normalizeText(rawName);
      if (!name) continue;
      const key = name.toLowerCase();
      if (map.has(key)) continue;
      map.set(key, {
        id: `character:${key}`,
        name,
        evidence: [normalizeText(event?.description || '')].filter(Boolean),
      });
    }
  }
  return [...map.values()];
}

function buildCharacterCoPresence(events = []) {
  const pairMap = new Map();
  for (const event of toArray(events)) {
    const uniqueNames = [...new Set(toArray(event?.characters).map((value) => normalizeText(value)).filter(Boolean))];
    for (let index = 0; index < uniqueNames.length; index += 1) {
      for (let inner = index + 1; inner < uniqueNames.length; inner += 1) {
        const left = uniqueNames[index];
        const right = uniqueNames[inner];
        const key = [left.toLowerCase(), right.toLowerCase()].sort().join('|');
        const existing = pairMap.get(key) || {
          left,
          right,
          count: 0,
          evidenceRefs: [],
        };
        existing.count += 1;
        const description = normalizeText(event?.description || '');
        if (description && existing.evidenceRefs.length < 3) {
          existing.evidenceRefs.push(description);
        }
        pairMap.set(key, existing);
      }
    }
  }

  return [...pairMap.values()].filter((item) => item.count >= 2);
}

export function getStoryGraphProvenance(graph = {}, nodeId = '') {
  const normalizedId = normalizeText(nodeId);
  if (!normalizedId) return null;

  const nodes = toArray(graph.nodes);
  const edges = toArray(graph.edges);
  const node = nodes.find((item) => item.id === normalizedId);
  if (!node) return null;

  return {
    node,
    incoming: edges.filter((edge) => edge.to === normalizedId),
    outgoing: edges.filter((edge) => edge.from === normalizedId),
  };
}
