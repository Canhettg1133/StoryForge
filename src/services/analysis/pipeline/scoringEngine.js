import { shouldAutoAcceptEvent } from '../models/event.js';
import { shouldAutoAcceptIncident } from '../models/incident.js';
import { shouldAutoAcceptLocation } from '../models/location.js';
import { getSeverityConfig } from '../models/consistencyRisk.js';
import { needsReview } from './scoringRules.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, toNumber(value, min)));
}

function getRiskPenalty(itemId, key, consistencyRisks = []) {
  if (!itemId) return 0;

  return (consistencyRisks || []).reduce((sum, risk) => {
    if (!risk) return sum;
    const involved = Array.isArray(risk[key]) ? risk[key] : [];
    if (!involved.includes(itemId)) return sum;
    return sum + toNumber(getSeverityConfig(risk.severity)?.penalty, 0);
  }, 0);
}

function calculateIncidentScore(incident, events, consistencyRisks = []) {
  const linkedEvents = (events || []).filter((event) => event?.incidentId === incident?.id);
  const avgSeverity = linkedEvents.length
    ? linkedEvents.reduce((sum, event) => sum + clamp(event.severity, 0, 1), 0) / linkedEvents.length
    : 0;
  const riskPenalty = getRiskPenalty(incident?.id, 'involvedIncidents', consistencyRisks);
  const boundaryPenalty = (incident?.uncertainStart ? 0.1 : 0) + (incident?.uncertainEnd ? 0.1 : 0);
  const evidenceBoost = Array.isArray(incident?.evidence) && incident.evidence.length > 0 ? 0.08 : -0.08;

  const impactScore = Math.max(0, Math.min(10, (avgSeverity * 7.5) + Math.min(3, linkedEvents.length / 2)));
  const majorScore = Math.max(0, Math.min(10, (impactScore * 0.8) + (incident.type === 'major_plot_point' ? 1.5 : 0)));

  let confidence = clamp(incident?.confidence, 0, 1);
  confidence += evidenceBoost;
  confidence += Math.min(0.15, linkedEvents.length * 0.01);
  confidence -= boundaryPenalty;
  confidence -= Math.min(0.35, riskPenalty * 0.3);
  confidence = clamp(confidence, 0, 1);

  return {
    confidence,
    impactScore: Number(impactScore.toFixed(3)),
    majorScore: Number(majorScore.toFixed(3)),
  };
}

function calculateEventScore(event, consistencyRisks = []) {
  const riskPenalty = getRiskPenalty(event?.id, 'involvedEvents', consistencyRisks);
  const chapterBonus = Number.isFinite(Number(event?.chapterIndex)) ? 0.06 : -0.06;
  const evidenceBonus = Array.isArray(event?.evidence) && event.evidence.length > 0 ? 0.08 : -0.08;

  let confidence = clamp(event?.confidence, 0, 1);
  confidence += chapterBonus + evidenceBonus;
  confidence -= Math.min(0.30, riskPenalty * 0.35);
  confidence = clamp(confidence, 0, 1);

  const severity = clamp(event?.severity, 0, 1);
  const qualityProxy = Math.max(
    0,
    Math.min(100, Math.round(
      (confidence * 55)
      + (severity * 25)
      + (Array.isArray(event?.evidence) && event.evidence.length > 0 ? 10 : 0)
      + (Number.isFinite(Number(event?.chapterIndex)) ? 10 : 0),
    )),
  );

  return {
    confidence,
    qualityProxy,
  };
}

function calculateLocationScore(location, consistencyRisks = []) {
  const riskPenalty = getRiskPenalty(location?.id, 'involvedLocations', consistencyRisks);
  const mentionFactor = Math.min(0.2, toNumber(location?.mentionCount, 0) * 0.02);
  const evidenceBonus = Array.isArray(location?.evidence) && location.evidence.length > 0 ? 0.08 : -0.08;

  let confidence = clamp(location?.confidence, 0, 1);
  confidence += mentionFactor + evidenceBonus;
  confidence -= Math.min(0.25, riskPenalty * 0.4);
  confidence = clamp(confidence, 0, 1);

  return { confidence };
}

export function scoreItems(incidents = [], events = [], locations = [], consistencyRisks = []) {
  const scoredIncidents = incidents.map((incident) => {
    const score = calculateIncidentScore(incident, events, consistencyRisks);
    const next = {
      ...incident,
      confidence: score.confidence,
      majorScore: score.majorScore,
      impactScore: score.impactScore,
    };

    const autoAccepted = shouldAutoAcceptIncident(next);
    const reviewFlag = needsReview(next, 'incident');

    return {
      ...next,
      reviewStatus: autoAccepted ? 'auto_accepted' : 'needs_review',
      needsReview: reviewFlag,
    };
  });

  const scoredEvents = events.map((event) => {
    const score = calculateEventScore(event, consistencyRisks);
    const next = {
      ...event,
      confidence: score.confidence,
      qualityProxy: score.qualityProxy,
    };

    const autoAccepted = shouldAutoAcceptEvent(next);
    const reviewFlag = needsReview(next, 'event');

    return {
      ...next,
      reviewStatus: autoAccepted ? 'auto_accepted' : 'needs_review',
      needsReview: reviewFlag,
    };
  });

  const scoredLocations = locations.map((location) => {
    const score = calculateLocationScore(location, consistencyRisks);
    const next = {
      ...location,
      confidence: score.confidence,
    };

    const autoAccepted = shouldAutoAcceptLocation(next);
    const reviewFlag = needsReview(next, 'location');

    return {
      ...next,
      reviewStatus: autoAccepted ? 'auto_accepted' : 'needs_review',
      needsReview: reviewFlag,
    };
  });

  return { scoredIncidents, scoredEvents, scoredLocations };
}
