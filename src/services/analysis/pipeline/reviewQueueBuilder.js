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

function buildReasons(item, itemType, consistencyRisks = []) {
  const reasons = [];

  if (needsReview(item, itemType)) {
    reasons.push('Below auto-accept threshold.');
  }
  if (!Array.isArray(item?.evidence) || item.evidence.length === 0) {
    reasons.push('Missing evidence snippet.');
  }
  if (item?.uncertainStart || item?.uncertainEnd) {
    reasons.push('Incident boundary is uncertain.');
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
      reasons.push(`Related consistency risks: ${relatedRiskCount}.`);
    }
  }

  return reasons;
}

function buildSuggestions(itemType) {
  if (itemType === REVIEW_ITEM_TYPES.INCIDENT) {
    return [
      'Check chapter boundaries and causal links.',
      'Confirm title and type (major/subplot/POV thread).',
    ];
  }
  if (itemType === REVIEW_ITEM_TYPES.EVENT) {
    return [
      'Verify chapter/chunk grounding.',
      'Review evidence snippet and severity score.',
    ];
  }
  if (itemType === REVIEW_ITEM_TYPES.LOCATION) {
    return [
      'Merge duplicate aliases if needed.',
      'Confirm location evidence and chapter spread.',
    ];
  }
  return ['Review and resolve this risk item.'];
}

function createQueueItem({
  corpusId,
  analysisId,
  itemType,
  item,
  consistencyRisks,
}) {
  const priority = buildPriorityResult({ ...item, itemType, type: itemType }, consistencyRisks);
  const reasons = buildReasons(item, itemType, consistencyRisks);

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
    suggestions: buildSuggestions(itemType),
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
      priorityScore: priority === PRIORITY.P0 ? 0.95 : (priority === PRIORITY.P1 ? 0.70 : 0.50),
      scoreBreakdown: {
        impact: priority === PRIORITY.P0 ? 1 : 0.8,
        confidenceDeficit: 0.5,
        consistencyRisk: 1,
        boundaryAmbiguity: 0.2,
        missingEvidence: 0.2,
      },
      reason: [risk.description || 'Consistency issue detected.'],
      suggestions: ['Review conflict and apply resolution action.'],
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

  const reviewItems = [];

  for (const incident of incidents || []) {
    if (!incident?.id || !needsReview(incident, 'incident')) continue;
    reviewItems.push(createQueueItem({
      corpusId,
      analysisId,
      itemType: REVIEW_ITEM_TYPES.INCIDENT,
      item: incident,
      consistencyRisks,
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
