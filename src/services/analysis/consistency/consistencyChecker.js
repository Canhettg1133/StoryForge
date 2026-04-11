import { randomUUID } from 'node:crypto';
import { checkImpossibleCoLocation, checkMissingPrerequisites } from './causalValidator.js';
import { checkSpanAnomalies } from './spanValidator.js';
import { checkStateContradictions } from './stateValidator.js';
import { checkTimelineInversion } from './timelineValidator.js';

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildRisk({
  type,
  severity,
  description,
  details = {},
  involvedIncidents = [],
  involvedEvents = [],
  involvedLocations = [],
  evidence = [],
  chapterRange = [null, null],
}) {
  return {
    id: `risk_${randomUUID()}`,
    type,
    severity,
    description,
    details,
    involvedIncidents,
    involvedEvents,
    involvedLocations,
    evidence,
    chapterRange,
  };
}

export function checkDuplicateAnchors(incidents = []) {
  const seen = new Map();
  const risks = [];

  for (const incident of incidents || []) {
    const anchorId = incident?.climaxAnchor?.eventId || incident?.anchorEventId;
    if (!anchorId) continue;

    const existing = seen.get(anchorId);
    if (!existing) {
      seen.set(anchorId, incident);
      continue;
    }

    risks.push(buildRisk({
      type: 'duplicate_anchors_conflict',
      severity: 'medium',
      description: `Anchor event ${anchorId} is used by multiple incidents.`,
      details: {
        anchorId,
        incidentIds: [existing.id, incident.id],
      },
      involvedIncidents: [existing.id, incident.id],
      involvedEvents: [anchorId],
      evidence: [existing.title, incident.title].filter(Boolean),
      chapterRange: [
        Math.min(existing.startChapter ?? Number.MAX_SAFE_INTEGER, incident.startChapter ?? Number.MAX_SAFE_INTEGER),
        Math.max(existing.endChapter ?? 0, incident.endChapter ?? 0),
      ],
    }));
  }

  return risks;
}

export function checkPOVContinuity(incidents = []) {
  const risks = [];
  const byPov = new Map();

  for (const incident of incidents || []) {
    const pov = normalizeText(incident?.povLane || incident?.pov);
    if (!pov) continue;
    const list = byPov.get(pov) || [];
    list.push(incident);
    byPov.set(pov, list);
  }

  for (const [, list] of byPov.entries()) {
    const ordered = [...list].sort((a, b) => (a.startChapter ?? Number.MAX_SAFE_INTEGER) - (b.startChapter ?? Number.MAX_SAFE_INTEGER));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = ordered[i];
      const next = ordered[i + 1];
      if (current.endChapter == null || next.startChapter == null) continue;

      if (next.startChapter - current.endChapter > 12) {
        risks.push(buildRisk({
          type: 'pov_continuity_break',
          severity: 'medium',
          description: `POV lane has a long gap (${next.startChapter - current.endChapter} chapters).`,
          details: {
            povLane: current.povLane || current.pov,
            incidentIds: [current.id, next.id],
          },
          involvedIncidents: [current.id, next.id],
          evidence: [current.title, next.title].filter(Boolean),
          chapterRange: [current.endChapter, next.startChapter],
        }));
      }
    }
  }

  return risks;
}

export function checkEntityCollisions(locations = []) {
  const risks = [];
  const buckets = new Map();

  for (const location of locations || []) {
    const key = normalizeText(location?.normalized || location?.name);
    if (!key) continue;

    const list = buckets.get(key) || [];
    list.push(location);
    buckets.set(key, list);
  }

  for (const [key, list] of buckets.entries()) {
    if (list.length < 2) continue;
    const uniqueIds = [...new Set(list.map((item) => item.id).filter(Boolean))];
    if (uniqueIds.length < 2) continue;

    risks.push(buildRisk({
      type: 'entity_collision',
      severity: 'soft',
      description: `Multiple location entities share normalized key "${key}".`,
      details: {
        normalized: key,
        locationIds: uniqueIds,
      },
      involvedLocations: uniqueIds,
      evidence: list.map((item) => item.name).filter(Boolean).slice(0, 6),
    }));
  }

  return risks;
}

export function checkEvidenceMismatch(incidents = [], events = []) {
  const risks = [];

  for (const incident of incidents || []) {
    const eventCount = (events || []).filter((event) => event?.incidentId === incident.id).length;
    const hasEvidence = Array.isArray(incident?.evidence) && incident.evidence.length > 0;
    if (eventCount > 0 && !hasEvidence) {
      risks.push(buildRisk({
        type: 'evidence_mismatch',
        severity: 'soft',
        description: 'Incident has linked events but no evidence snippet.',
        details: {
          incidentId: incident.id,
          linkedEvents: eventCount,
        },
        involvedIncidents: [incident.id],
      }));
    }
  }

  for (const event of events || []) {
    const hasEvidence = Array.isArray(event?.evidence) && event.evidence.length > 0;
    if (!hasEvidence && Number(event?.confidence || 0) >= 0.8) {
      risks.push(buildRisk({
        type: 'evidence_mismatch',
        severity: 'soft',
        description: 'High-confidence event is missing evidence.',
        details: {
          eventId: event.id,
          confidence: event.confidence,
        },
        involvedEvents: [event.id],
        involvedIncidents: [event.incidentId].filter(Boolean),
      }));
    }
  }

  return risks;
}

export function checkConsistency(incidents = [], events = [], locations = [], _options = {}) {
  const risks = [
    ...checkTimelineInversion(incidents, events),
    ...checkStateContradictions(events),
    ...checkImpossibleCoLocation(events, incidents),
    ...checkMissingPrerequisites(events),
    ...checkDuplicateAnchors(incidents),
    ...checkPOVContinuity(incidents),
    ...checkEntityCollisions(locations),
    ...checkSpanAnomalies(incidents, events),
    ...checkEvidenceMismatch(incidents, events),
  ];

  const deduped = [];
  const seen = new Set();

  for (const risk of risks) {
    const signature = [
      risk.type,
      risk.severity,
      [...new Set(toArray(risk.involvedIncidents))].sort().join(','),
      [...new Set(toArray(risk.involvedEvents))].sort().join(','),
      [...new Set(toArray(risk.involvedLocations))].sort().join(','),
      risk.description,
    ].join('|');

    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(risk);
  }

  return deduped;
}
