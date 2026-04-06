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
    reasons.push('Diem tin cay chua du de tu dong chap nhan.');
  }
  if (!Array.isArray(item?.evidence) || item.evidence.length === 0) {
    reasons.push('Thieu bang chung hoac trich dan doi chieu.');
  }
  if (item?.uncertainStart || item?.uncertainEnd) {
    reasons.push('Ranh gioi incident con mo ho.');
  }

  if (graphSignals?.isolatedNodeIds?.has?.(item.id)) {
    reasons.push('Node nay dang bi co lap trong story graph.');
  } else if (graphSignals?.weakNodeIds?.has?.(item.id)) {
    reasons.push('Node nay co it lien ket trong story graph.');
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
      reasons.push(`Co ${relatedRiskCount} canh bao consistency lien quan.`);
    }
  }

  return reasons;
}

function buildSuggestions(itemType, graphSignals = null, itemId = '') {
  const suggestions = [];

  if (itemType === REVIEW_ITEM_TYPES.INCIDENT) {
    suggestions.push('Kiem tra chuong bat dau/ket thuc va lien ket nhan qua.');
    suggestions.push('Xac nhan tieu de va loai incident.');
  } else if (itemType === REVIEW_ITEM_TYPES.EVENT) {
    suggestions.push('Kiem tra grounding theo chuong/chunk.');
    suggestions.push('Doi chieu mo ta su kien voi bang chung va do quan trong.');
  } else if (itemType === REVIEW_ITEM_TYPES.LOCATION) {
    suggestions.push('Gop alias trung neu can.');
    suggestions.push('Xac nhan dia diem that su xuat hien o cac chuong da gan.');
  } else {
    suggestions.push('Xem lai canh bao va chon huong xu ly phu hop.');
  }

  if (graphSignals?.isolatedNodeIds?.has?.(itemId)) {
    suggestions.push('Kiem tra vi sao node nay chua co quan he nao trong story graph.');
  } else if (graphSignals?.weakNodeIds?.has?.(itemId)) {
    suggestions.push('Xac nhan xem co thieu quan he, event hoac location lien quan hay khong.');
  }

  return suggestions;
}

function createQueueItem({
  corpusId,
  analysisId,
  itemType,
  item,
  consistencyRisks,
  graphSignals,
}) {
  const priority = buildPriorityResult({ ...item, itemType, type: itemType }, consistencyRisks);
  const reasons = buildReasons(item, itemType, consistencyRisks, graphSignals);

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
      reason: [risk.description || 'Co canh bao consistency can xu ly.'],
      suggestions: ['Mo chi tiet risk, doi chieu bang chung va xac nhan cach giai quyet.'],
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
  const reviewItems = [];

  for (const incident of incidents || []) {
    if (!incident?.id || !needsReview(incident, 'incident')) continue;
    reviewItems.push(createQueueItem({
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.INCIDENT,
      item: incident,
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
