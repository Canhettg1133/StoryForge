import { getSeverityConfig } from '../models/consistencyRisk.js';
import { PRIORITY } from '../models/reviewQueue.js';

export const AUTO_ACCEPT_RULES = {
  incident: {
    minConfidence: 0.85,
    requiresEvidence: true,
    requiresValidBoundary: true,
  },
  event: {
    minConfidence: 0.75,
    requiresChapter: true,
    requiresChunk: false,
  },
  location: {
    minConfidence: 0.80,
    requiresEvidence: true,
    requiresName: true,
  },
};

export const PRIORITY_SCORE_WEIGHTS = {
  impact: 0.30,
  confidenceDeficit: 0.25,
  consistencyRisk: 0.20,
  boundaryAmbiguity: 0.15,
  missingEvidence: 0.10,
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value, min)));
}

function round(value, digits = 2) {
  const base = 10 ** digits;
  return Math.round(toNumber(value, 0) * base) / base;
}

function getType(itemType) {
  return String(itemType || '').toLowerCase();
}

function hasEvidence(item) {
  return Array.isArray(item?.evidence) && item.evidence.length > 0;
}

export function needsReview(item, itemType) {
  const type = getType(itemType || item?.type);
  const rule = AUTO_ACCEPT_RULES[type];

  if (!rule) {
    return true;
  }

  const confidence = toNumber(item?.confidence, 0);
  if (confidence < rule.minConfidence) {
    return true;
  }

  if (rule.requiresEvidence && !hasEvidence(item)) {
    return true;
  }

  if (rule.requiresValidBoundary) {
    const hasBoundary = (
      item?.startChapterId
      || item?.endChapterId
      || Array.isArray(item?.chapterRange)
    );
    if (!hasBoundary) {
      return true;
    }
  }

  if (rule.requiresChapter) {
    if (!Number.isFinite(Number(item?.chapterIndex)) || Number(item.chapterIndex) < 0) {
      return true;
    }
  }

  if (rule.requiresChunk) {
    if (!item?.chunkId && !Number.isFinite(Number(item?.chunkIndex))) {
      return true;
    }
  }

  if (item?.uncertainStart || item?.uncertainEnd) {
    return true;
  }

  return false;
}

export function getRelevantRisks(item, consistencyRisks = []) {
  if (!item?.id) {
    return [];
  }

  const itemType = getType(item?.itemType || item?.type);
  const id = String(item.id);

  return (consistencyRisks || []).filter((risk) => {
    if (!risk) return false;
    if (itemType === 'incident') {
      return Array.isArray(risk.involvedIncidents) && risk.involvedIncidents.includes(id);
    }
    if (itemType === 'event') {
      return Array.isArray(risk.involvedEvents) && risk.involvedEvents.includes(id);
    }
    if (itemType === 'location') {
      return Array.isArray(risk.involvedLocations) && risk.involvedLocations.includes(id);
    }
    return false;
  });
}

export function calculatePriorityBreakdown(item, consistencyRisks = []) {
  const relevantRisks = getRelevantRisks(item, consistencyRisks);
  const riskPenaltyRaw = relevantRisks.reduce((sum, risk) => {
    const severity = getSeverityConfig(risk?.severity);
    return sum + toNumber(severity.penalty, 0);
  }, 0);

  const boundaryAmbiguity = (
    (item?.uncertainStart ? 0.5 : 0)
    + (item?.uncertainEnd ? 0.5 : 0)
  );

  const missingEvidence = hasEvidence(item) ? 0 : 1;
  const confidenceDeficit = 1 - clamp(item?.confidence, 0, 1);
  const impact = clamp((toNumber(item?.majorScore, item?.impactScore ?? 5)) / 10, 0, 1);

  return {
    impact: round(impact),
    confidenceDeficit: round(confidenceDeficit),
    consistencyRisk: round(Math.min(1, riskPenaltyRaw)),
    boundaryAmbiguity: round(Math.min(1, boundaryAmbiguity / 2)),
    missingEvidence: round(missingEvidence),
    hasHardConflict: relevantRisks.some((risk) => getSeverityConfig(risk?.severity).forceP0),
    relevantRiskCount: relevantRisks.length,
  };
}

export function calculatePriorityScore(item, consistencyRisks = []) {
  const breakdown = calculatePriorityBreakdown(item, consistencyRisks);
  const score = (
    PRIORITY_SCORE_WEIGHTS.impact * breakdown.impact
    + PRIORITY_SCORE_WEIGHTS.confidenceDeficit * breakdown.confidenceDeficit
    + PRIORITY_SCORE_WEIGHTS.consistencyRisk * breakdown.consistencyRisk
    + PRIORITY_SCORE_WEIGHTS.boundaryAmbiguity * breakdown.boundaryAmbiguity
    + PRIORITY_SCORE_WEIGHTS.missingEvidence * breakdown.missingEvidence
  );
  return round(score);
}

export function assignPriority(score, hasHardConflict = false) {
  if (hasHardConflict || score >= 0.75) return PRIORITY.P0;
  if (score >= 0.50) return PRIORITY.P1;
  return PRIORITY.P2;
}

export function buildPriorityResult(item, consistencyRisks = []) {
  const breakdown = calculatePriorityBreakdown(item, consistencyRisks);
  const score = calculatePriorityScore(item, consistencyRisks);
  const priority = assignPriority(score, breakdown.hasHardConflict);

  return {
    priority,
    priorityScore: score,
    scoreBreakdown: {
      impact: breakdown.impact,
      confidenceDeficit: breakdown.confidenceDeficit,
      consistencyRisk: breakdown.consistencyRisk,
      boundaryAmbiguity: breakdown.boundaryAmbiguity,
      missingEvidence: breakdown.missingEvidence,
    },
  };
}
