import { randomUUID } from 'node:crypto';
import { PRIORITY, REVIEW_ITEM_STATUS, REVIEW_ITEM_TYPES } from '../models/reviewQueue.js';
import { buildPriorityResult, needsReview } from './scoringRules.js';

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toPriorityWeight(priority) {
  if (priority === PRIORITY.P0) return 0;
  if (priority === PRIORITY.P1) return 1;
  return 2;
}

function buildGraphSignals(graph = null) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const degree = new Map();

  for (const node of nodes) {
    degree.set(node.id, 0);
  }
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }

  const isolatedNodeIds = new Set(
    [...degree.entries()]
      .filter(([, count]) => count === 0)
      .map(([nodeId]) => nodeId),
  );
  const weakNodeIds = new Set(
    [...degree.entries()]
      .filter(([, count]) => count <= 1)
      .map(([nodeId]) => nodeId),
  );

  return {
    isolatedNodeIds,
    weakNodeIds,
  };
}

function buildReasons(item, itemType, consistencyRisks = [], graphSignals = null) {
  const reasons = [];

  if (needsReview(item, itemType)) {
    reasons.push('Điểm tin cậy chưa đủ để tự động chấp nhận.');
  }
  if (!Array.isArray(item?.evidence) || item.evidence.length === 0) {
    reasons.push('Thiếu bằng chứng hoặc trích dẫn đối chiếu.');
  }
  if (item?.uncertainStart || item?.uncertainEnd) {
    reasons.push('Ranh giới incident còn mơ hồ.');
  }

  if (graphSignals?.isolatedNodeIds?.has?.(item.id)) {
    reasons.push('Node này đang bị cô lập trong story graph.');
  } else if (graphSignals?.weakNodeIds?.has?.(item.id)) {
    reasons.push('Node này có ít liên kết trong story graph.');
  }

  const keyByType = {
    incident: 'involvedIncidents',
    event: 'involvedEvents',
    location: 'involvedLocations',
  };
  const riskKey = keyByType[itemType];
  if (riskKey) {
    const relatedRiskCount = (consistencyRisks || []).filter((risk) => (
      Array.isArray(risk?.[riskKey]) && risk[riskKey].includes(item.id)
    )).length;

    if (relatedRiskCount > 0) {
      reasons.push(`Có ${relatedRiskCount} cảnh báo consistency liên quan.`);
    }
  }

  return reasons;
}

function buildSuggestions(itemType, graphSignals = null, itemId = '') {
  const suggestions = [];

  if (itemType === REVIEW_ITEM_TYPES.INCIDENT) {
    suggestions.push('Kiểm tra chương bắt đầu/kết thúc và liên kết nhân quả.');
    suggestions.push('Xác nhận tiêu đề và loại incident.');
  } else if (itemType === REVIEW_ITEM_TYPES.EVENT) {
    suggestions.push('Kiểm tra grounding theo chương/chunk.');
    suggestions.push('Đối chiếu mô tả sự kiện với bằng chứng và độ quan trọng.');
  } else if (itemType === REVIEW_ITEM_TYPES.LOCATION) {
    suggestions.push('Gộp alias trùng nếu cần.');
    suggestions.push('Xác nhận địa điểm thật sự xuất hiện ở các chương đã gắn.');
  } else {
    suggestions.push('Xem lại cảnh báo và chọn hướng xử lý phù hợp.');
  }

  if (graphSignals?.isolatedNodeIds?.has?.(itemId)) {
    suggestions.push('Kiểm tra vì sao node này chưa có quan hệ nào trong story graph.');
  } else if (graphSignals?.weakNodeIds?.has?.(itemId)) {
    suggestions.push('Xác nhận xem có thiếu quan hệ, event hoặc location liên quan hay không.');
  }

  return suggestions;
}

function normalizeWindowIds(item = {}) {
  const value = item.relatedWindowIds
    || item.related_window_ids
    || item.windowIds
    || item.window_ids
    || item.rerunScope?.windowIds
    || item.rerunScope?.window_ids
    || item.lineage?.supporting_window_ids
    || [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function buildIncidentWindowMap(incidents = []) {
  const map = new Map();
  for (const incident of incidents || []) {
    if (!incident?.id) continue;
    map.set(incident.id, normalizeWindowIds(incident));
  }
  return map;
}

function inferRelatedIncidentIds(itemType, item = {}, incidents = [], events = []) {
  const explicitValue = item.relatedIncidentIds || item.related_incident_ids || item.incidentIds || item.incident_ids;
  const explicit = Array.isArray(explicitValue) ? explicitValue.filter(Boolean) : (explicitValue ? [explicitValue] : []);
  if (explicit.length > 0) return explicit;

  if (itemType === REVIEW_ITEM_TYPES.INCIDENT) {
    return item?.id ? [item.id] : [];
  }

  if (itemType === REVIEW_ITEM_TYPES.EVENT) {
    return item.incidentId || item.incident_id ? [item.incidentId || item.incident_id] : [];
  }

  if (itemType === REVIEW_ITEM_TYPES.LOCATION) {
    const locationId = item.id || null;
    const eventIds = new Set(toArray(item.timeline).map((entry) => entry?.eventId).filter(Boolean));
    const eventIncidentIds = (events || [])
      .filter((event) => eventIncidentIdsMatch(event, eventIds))
      .flatMap((event) => (event.incidentId || event.incident_id ? [event.incidentId || event.incident_id] : []));
    const incidentEntityIds = (incidents || [])
      .filter((incident) => {
        const refs = incident?.entityRefs?.locations;
        return locationId && Array.isArray(refs) && refs.includes(locationId);
      })
      .map((incident) => incident.id);
    return [...new Set([...eventIncidentIds, ...incidentEntityIds].filter(Boolean))];
  }

  return [];
}

function eventIncidentIdsMatch(event = {}, eventIds = new Set()) {
  return event?.id && eventIds.has(event.id);
}

function inferRelatedWindowIds(itemType, item = {}, relatedIncidentIds = [], incidentWindowMap = new Map()) {
  const explicit = normalizeWindowIds(item);
  if (explicit.length > 0) return explicit;
  if (itemType === REVIEW_ITEM_TYPES.INCIDENT) return relatedIncidentIds.flatMap((id) => incidentWindowMap.get(id) || []);
  if (itemType === REVIEW_ITEM_TYPES.EVENT || itemType === REVIEW_ITEM_TYPES.LOCATION) {
    return [...new Set(relatedIncidentIds.flatMap((id) => incidentWindowMap.get(id) || []).filter(Boolean))];
  }
  return [];
}

function createQueueItem({
  corpusId,
  analysisId,
  itemType,
  item,
  incidents,
  events,
  incidentWindowMap,
  consistencyRisks,
  graphSignals,
}) {
  const priority = buildPriorityResult({ ...item, itemType, type: itemType }, consistencyRisks);
  const reasons = buildReasons(item, itemType, consistencyRisks, graphSignals);
  const relatedIncidentIds = inferRelatedIncidentIds(itemType, item, incidents, events);
  const relatedWindowIds = inferRelatedWindowIds(itemType, item, relatedIncidentIds, incidentWindowMap);

  return {
    id: `rq_${randomUUID()}`,
    corpusId,
    analysisId,
    itemType,
    itemId: item.id,
    priority: priority.priority,
    priorityScore: priority.priorityScore,
    scoreBreakdown: priority.scoreBreakdown,
    reason: reasons,
    suggestions: buildSuggestions(itemType, graphSignals, item.id),
    rerunScope: itemType === REVIEW_ITEM_TYPES.LOCATION ? 'world_canonicalizer' : 'incident',
    relatedIncidentIds,
    relatedWindowIds,
    status: REVIEW_ITEM_STATUS.PENDING,
    createdAt: Date.now(),
  };
}

function createRiskQueueItems(consistencyRisks = [], { corpusId, analysisId }) {
  return (consistencyRisks || []).map((risk) => {
    const priority = risk?.severity === 'hard'
      ? PRIORITY.P0
      : (risk?.severity === 'medium' ? PRIORITY.P1 : PRIORITY.P2);

    return {
      id: `rq_${randomUUID()}`,
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.CONSISTENCY_RISK,
      itemId: risk.id,
      priority,
      priorityScore: priority === PRIORITY.P0 ? 0.95 : (priority === PRIORITY.P1 ? 0.7 : 0.5),
      scoreBreakdown: {
        impact: priority === PRIORITY.P0 ? 1 : 0.8,
        confidenceDeficit: 0.5,
        consistencyRisk: 1,
        boundaryAmbiguity: 0.2,
        missingEvidence: 0.2,
      },
      reason: [risk.description || 'Có cảnh báo consistency cần xử lý.'],
      suggestions: ['Mở chi tiết risk, đối chiếu bằng chứng và xác nhận cách giải quyết.'],
      status: REVIEW_ITEM_STATUS.PENDING,
      createdAt: Date.now(),
    };
  });
}

export function buildReviewQueue(
  incidents = [],
  events = [],
  locations = [],
  consistencyRisks = [],
  options = {},
) {
  const corpusId = options.corpusId || null;
  const analysisId = options.analysisId || null;
  const graphSignals = buildGraphSignals(options.graph || null);
  const incidentWindowMap = buildIncidentWindowMap(incidents);
  const reviewItems = [];

  for (const incident of incidents || []) {
    if (!incident?.id || !needsReview(incident, 'incident')) continue;
    reviewItems.push(createQueueItem({
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.INCIDENT,
      item: incident,
      incidents,
      events,
      incidentWindowMap,
      consistencyRisks,
      graphSignals,
    }));
  }

  for (const event of events || []) {
    if (!event?.id || !needsReview(event, 'event')) continue;
    reviewItems.push(createQueueItem({
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.EVENT,
      item: event,
      incidents,
      events,
      incidentWindowMap,
      consistencyRisks,
      graphSignals,
    }));
  }

  for (const location of locations || []) {
    if (!location?.id || !needsReview(location, 'location')) continue;
    reviewItems.push(createQueueItem({
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.LOCATION,
      item: location,
      incidents,
      events,
      incidentWindowMap,
      consistencyRisks,
      graphSignals,
    }));
  }

  reviewItems.push(...createRiskQueueItems(consistencyRisks, { corpusId, analysisId }));

  const sorted = reviewItems.sort((left, right) => {
    const priorityDiff = toPriorityWeight(left.priority) - toPriorityWeight(right.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(right.priorityScore || 0) - Number(left.priorityScore || 0);
  });

  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

export function getReviewQueueStats(items = []) {
  const all = toArray(items);
  return {
    total: all.length,
    P0: all.filter((item) => item.priority === PRIORITY.P0).length,
    P1: all.filter((item) => item.priority === PRIORITY.P1).length,
    P2: all.filter((item) => item.priority === PRIORITY.P2).length,
    pending: all.filter((item) => item.status === REVIEW_ITEM_STATUS.PENDING).length,
    resolved: all.filter((item) => item.status === REVIEW_ITEM_STATUS.RESOLVED).length,
  };
}
