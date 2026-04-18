import { CANON_EXTRACTABLE_OPS, CANON_OP_TYPES } from './constants';
import { cleanText, clampConfidence, normalizeKey, normalizePayload, splitGoals } from './utils';

export function normalizeOpType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return CANON_EXTRACTABLE_OPS.has(normalized) ? normalized : null;
}

function exactReferenceMatches(items, target, getValues) {
  if (!target) return [];
  return (items || []).filter((item) => (
    getValues(item)
      .map((value) => normalizeKey(value))
      .filter(Boolean)
      .some((value) => value === target)
  ));
}

function resolveReference(items, rawValue, getValues, kind) {
  const target = normalizeKey(rawValue);
  if (!target) {
    return { match: null, error: null };
  }
  const matches = exactReferenceMatches(items, target, getValues);
  if (matches.length === 1) {
    return { match: matches[0], error: null };
  }
  if (matches.length > 1) {
    return {
      match: null,
      error: {
        kind,
        ruleCode: `AMBIGUOUS_${kind}_REFERENCE`,
        rawValue: cleanText(rawValue),
        candidateIds: matches.map((item) => item.id),
      },
    };
  }
  return { match: null, error: null };
}

function findLocationByName(locations, name) {
  const target = normalizeKey(name);
  if (!target) return null;
  return locations.find((location) => {
    const normalized = normalizeKey(location.name);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  }) || null;
}

function findThreadByTitle(threads, title) {
  const target = normalizeKey(title);
  if (!target) return null;
  return threads.find((thread) => {
    const normalized = normalizeKey(thread.title);
    return normalized === target || normalized.includes(target) || target.includes(normalized);
  }) || null;
}

function findThreadById(threads, id) {
  const target = Number(id);
  if (!Number.isFinite(target)) return null;
  return threads.find((thread) => Number(thread.id) === target) || null;
}

function findThreadByReference(threads, rawOp = {}) {
  return findThreadById(threads, rawOp.thread_id)
    || findThreadByTitle(threads, rawOp.thread_title);
}

function normalizeOptionalNumber(value) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : '';
}

export function buildSemanticOpFingerprint(op) {
  const payload = normalizePayload(op.payload);
  const quantityDelta = payload.quantity_delta ?? payload.quantity ?? payload.amount ?? payload.count;
  const semanticPayload = {
    status_summary: normalizeKey(payload.status_summary),
    summary: normalizeKey(payload.status_summary || payload.description || payload.new_goal || payload.relationship_type || payload.status || payload.availability ? '' : op.summary),
    new_goal: normalizeKey(payload.new_goal),
    old_goal: normalizeKey(payload.old_goal),
    goals_active: splitGoals(payload.goals_active).map(normalizeKey).sort(),
    goals_abandoned: splitGoals(payload.goals_abandoned).map(normalizeKey).sort(),
    allegiance: normalizeKey(payload.allegiance || payload.new_allegiance),
    relationship_type: normalizeKey(payload.relationship_type || payload.status),
    secrecy_state: normalizeKey(payload.secrecy_state || payload.secret_state),
    intimacy_level: normalizeKey(payload.intimacy_level || payload.level),
    consent_state: normalizeKey(payload.consent_state),
    availability: normalizeKey(payload.availability),
    usage_notes: normalizeKey(payload.usage_notes),
    item_category: normalizeKey(payload.item_category || payload.item_type || payload.object_type),
    quantity_delta: normalizeOptionalNumber(quantityDelta),
    quantity_remaining: normalizeOptionalNumber(payload.quantity_remaining),
    quantity_unit: normalizeKey(payload.quantity_unit || payload.unit),
    fact_type: normalizeKey(payload.fact_type),
    description: normalizeKey(payload.description),
  };
  return [
    op.op_type,
    op.chapter_id || '',
    op.scene_id || '',
    op.subject_id || normalizeKey(op.subject_name),
    op.target_id || normalizeKey(op.target_name),
    op.location_id || normalizeKey(op.location_name),
    op.thread_id || normalizeKey(op.thread_title),
    op.fact_id || normalizeKey(op.fact_description || payload.description),
    op.object_id || normalizeKey(op.object_name),
    JSON.stringify(semanticPayload),
  ].join('|');
}

export function dedupeCandidateOps(candidateOps = []) {
  const byFingerprint = new Map();
  candidateOps.filter(Boolean).forEach((op) => {
    const fingerprint = buildSemanticOpFingerprint(op);
    const existing = byFingerprint.get(fingerprint);
    if (!existing || clampConfidence(op.confidence) >= clampConfidence(existing.confidence)) {
      byFingerprint.set(fingerprint, op);
    }
  });
  return Array.from(byFingerprint.values());
}

function hasRequiredAiOpReferences(op) {
  if (Array.isArray(op.mapping_errors) && op.mapping_errors.length > 0) {
    return true;
  }
  if (
    [
      CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
      CANON_OP_TYPES.CHARACTER_RESCUED,
      CANON_OP_TYPES.CHARACTER_DIED,
      CANON_OP_TYPES.GOAL_CHANGED,
      CANON_OP_TYPES.ALLEGIANCE_CHANGED,
    ].includes(op.op_type)
    && !op.subject_id
  ) {
    return false;
  }

  if (
    op.op_type === CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED
    && (!op.subject_id || !op.location_id)
  ) {
    return false;
  }

  if (
    [
      CANON_OP_TYPES.THREAD_OPENED,
      CANON_OP_TYPES.THREAD_PROGRESS,
      CANON_OP_TYPES.THREAD_RESOLVED,
    ].includes(op.op_type)
    && !op.thread_id
  ) {
    return false;
  }

  if (op.op_type === CANON_OP_TYPES.SECRET_REVEALED && !op.fact_id) {
    return false;
  }

  if (
      [
        CANON_OP_TYPES.OBJECT_ACQUIRED,
        CANON_OP_TYPES.OBJECT_STATUS_CHANGED,
        CANON_OP_TYPES.OBJECT_TRANSFERRED,
        CANON_OP_TYPES.OBJECT_CONSUMED,
        CANON_OP_TYPES.OBJECT_LOST,
        CANON_OP_TYPES.OBJECT_FOUND,
        CANON_OP_TYPES.OBJECT_RESTORED,
        CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
        CANON_OP_TYPES.OBJECT_SPENT,
        CANON_OP_TYPES.OBJECT_RETURNED,
      ].includes(op.op_type)
    && !op.object_id
  ) {
    return false;
  }

  if (
    [
      CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
      CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
      CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
    ].includes(op.op_type)
    && (!op.subject_id || !op.target_id)
  ) {
    return false;
  }

  return true;
}

export function mapAiOpsToCandidateOps(rawOps, refs) {
  const sceneMap = new Map(refs.scenes.map((scene, index) => [index + 1, scene]));
  const seen = new Set();
  return rawOps
    .map((rawOp) => {
      const opType = normalizeOpType(rawOp?.op_type);
      if (!opType) return null;

      const scene = sceneMap.get(Number(rawOp.scene_index) || 1) || refs.scenes[0] || null;
      const subjectRef = resolveReference(refs.characters, rawOp.subject_name, (character) => {
        const aliases = Array.isArray(character.aliases) ? character.aliases : [];
        return [character.name, ...aliases];
      }, 'CHARACTER');
      const targetRef = resolveReference(refs.characters, rawOp.target_name, (character) => {
        const aliases = Array.isArray(character.aliases) ? character.aliases : [];
        return [character.name, ...aliases];
      }, 'CHARACTER');
      const location = findLocationByName(refs.locations, rawOp.location_name);
      const thread = findThreadByReference(refs.plotThreads, rawOp);
      const factRef = resolveReference(refs.canonFacts, rawOp.fact_description, (fact) => [fact.description], 'FACT');
      const objectRef = resolveReference(refs.objects || [], rawOp.object_name, (object) => {
        const aliases = Array.isArray(object.aliases) ? object.aliases : [];
        return [object.name, ...aliases];
      }, 'OBJECT');
      const mappingErrors = [
        subjectRef.error,
        targetRef.error,
        factRef.error,
        objectRef.error,
      ].filter(Boolean);

      return {
        op_type: opType,
        chapter_id: refs.chapterId,
        scene_id: scene?.id || null,
        scene_label: scene?.title || '',
        subject_id: subjectRef.match?.id || null,
        subject_name: cleanText(rawOp.subject_name || subjectRef.match?.name || ''),
        target_id: targetRef.match?.id || null,
        target_name: cleanText(rawOp.target_name || targetRef.match?.name || ''),
        location_id: location?.id || null,
        location_name: cleanText(rawOp.location_name || location?.name || ''),
        thread_id: thread?.id || null,
        thread_title: cleanText(thread?.title || rawOp.thread_title || ''),
        fact_id: factRef.match?.id || null,
        fact_description: cleanText(rawOp.fact_description || factRef.match?.description || ''),
        object_id: objectRef.match?.id || null,
        object_name: cleanText(rawOp.object_name || objectRef.match?.name || ''),
        summary: cleanText(rawOp.summary || ''),
        confidence: clampConfidence(rawOp.confidence),
        evidence: cleanText(rawOp.evidence || ''),
        payload: normalizePayload(rawOp.payload),
        mapping_errors: mappingErrors,
      };
    })
    .filter(Boolean)
    .filter(hasRequiredAiOpReferences)
    .filter((op) => {
      const fingerprint = buildSemanticOpFingerprint(op);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
}
