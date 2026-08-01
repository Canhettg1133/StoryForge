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

function normalizeExactReference(value) {
  return cleanText(value)
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function literalReferenceMatches(items, target, getValues) {
  if (!target) return [];
  return (items || []).filter((item) => (
    getValues(item)
      .map((value) => normalizeExactReference(value))
      .filter(Boolean)
      .some((value) => value === target)
  ));
}

function resolveReference(items, rawValue, getValues, kind) {
  const literalTarget = normalizeExactReference(rawValue);
  const literalMatches = literalReferenceMatches(items, literalTarget, getValues);
  if (literalMatches.length === 1) {
    return { match: literalMatches[0], error: null };
  }
  if (literalMatches.length > 1) {
    return {
      match: null,
      error: {
        kind,
        ruleCode: `AMBIGUOUS_${kind}_REFERENCE`,
        rawValue: cleanText(rawValue),
        candidateIds: literalMatches.map((item) => item.id),
      },
    };
  }
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
  const exact = locations.find((location) => normalizeKey(location.name) === target);
  if (exact) return exact;
  const partialMatches = locations.filter((location) => {
    const normalized = normalizeKey(location.name);
    return normalized.includes(target) || target.includes(normalized);
  });
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

function findThreadByTitle(threads, title) {
  const target = normalizeKey(title);
  if (!target) return null;
  const exact = threads.find((thread) => normalizeKey(thread.title) === target);
  if (exact) return exact;
  const partialMatches = threads.filter((thread) => {
    const normalized = normalizeKey(thread.title);
    return normalized.includes(target) || target.includes(normalized);
  });
  return partialMatches.length === 1 ? partialMatches[0] : null;
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

function linkSameChapterFactReferences(candidateOps, chapterId) {
  const registrationsByDescription = new Map();
  const withRegistrationIds = candidateOps.map((op) => {
    if (op.op_type !== CANON_OP_TYPES.FACT_REGISTERED || op.fact_id) {
      return op;
    }
    const descriptionKey = normalizeKey(op.fact_description || op.payload?.description || op.summary);
    if (!descriptionKey) return op;

    const linked = {
      ...op,
      fact_id: `chapter:${chapterId}:fact:${descriptionKey}`,
    };
    const registrations = registrationsByDescription.get(descriptionKey) || [];
    registrations.push(linked);
    registrationsByDescription.set(descriptionKey, registrations);
    return linked;
  });

  const linkedOps = withRegistrationIds.map((op) => {
    if (op.op_type !== CANON_OP_TYPES.SECRET_REVEALED || op.fact_id) {
      return op;
    }
    const hasAmbiguousFactReference = (op.mapping_errors || [])
      .some((error) => error.kind === 'FACT');
    if (hasAmbiguousFactReference) return op;

    const descriptionKey = normalizeKey(op.fact_description || op.payload?.fact_description);
    const registrations = registrationsByDescription.get(descriptionKey) || [];
    if (registrations.length !== 1) return op;
    return { ...op, fact_id: registrations[0].fact_id };
  });

  const sourceOrder = new Map(linkedOps.map((op, index) => [op, index]));
  return [...linkedOps].sort((left, right) => {
    if (left.fact_id && left.fact_id === right.fact_id) {
      if (
        left.op_type === CANON_OP_TYPES.FACT_REGISTERED
        && right.op_type === CANON_OP_TYPES.SECRET_REVEALED
      ) return -1;
      if (
        left.op_type === CANON_OP_TYPES.SECRET_REVEALED
        && right.op_type === CANON_OP_TYPES.FACT_REGISTERED
      ) return 1;
    }
    return sourceOrder.get(left) - sourceOrder.get(right);
  });
}

function missingAiOpReferences(op) {
  const missing = [];
  const requireSubject = [
    CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
    CANON_OP_TYPES.CHARACTER_RESCUED,
    CANON_OP_TYPES.CHARACTER_DIED,
    CANON_OP_TYPES.GOAL_CHANGED,
    CANON_OP_TYPES.ALLEGIANCE_CHANGED,
    CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED,
    CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
    CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
    CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
  ].includes(op.op_type);
  if (requireSubject && !op.subject_id) missing.push(`subject_name:${op.subject_name || ''}`);
  if (op.op_type === CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED && !op.location_id) {
    missing.push(`location_name:${op.location_name || ''}`);
  }
  if ([
    CANON_OP_TYPES.THREAD_OPENED,
    CANON_OP_TYPES.THREAD_PROGRESS,
    CANON_OP_TYPES.THREAD_RESOLVED,
  ].includes(op.op_type) && !op.thread_id) {
    missing.push(`thread_title:${op.thread_title || ''}`);
  }
  if (op.op_type === CANON_OP_TYPES.SECRET_REVEALED && !op.fact_id) {
    missing.push(`fact_description:${op.fact_description || ''}`);
  }
  if ([
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
  ].includes(op.op_type) && !op.object_id) {
    missing.push(`object_name:${op.object_name || ''}`);
  }
  if ([
    CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
    CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
    CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
  ].includes(op.op_type) && !op.target_id) {
    missing.push(`target_name:${op.target_name || ''}`);
  }
  return missing;
}

export function mapAiOpsToCandidateOpsDetailed(rawOps, refs) {
  const sceneMap = new Map(refs.scenes.map((scene, index) => [index + 1, scene]));
  const filteredOps = [];
  const mappedEntries = rawOps
    .map((rawOp, sourceIndex) => {
      const opType = normalizeOpType(rawOp?.op_type);
      if (!opType) {
        filteredOps.push({
          reasonCode: 'CANON_OP_UNSUPPORTED_TYPE_FILTERED',
          opType: cleanText(rawOp?.op_type || ''),
          evidence: cleanText(rawOp?.evidence || ''),
          sourceIndex,
          missingReferences: [],
        });
        return null;
      }

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

      return { sourceIndex, mappedOp: {
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
        payload_validation_errors: rawOp.payload != null
          && (typeof rawOp.payload !== 'object' || Array.isArray(rawOp.payload))
          ? ['payload']
          : [],
        mapping_errors: mappingErrors,
      } };
    })
    .filter(Boolean);

  const mappedOps = mappedEntries.map((entry) => entry.mappedOp);
  const dedupedOps = dedupeCandidateOps(mappedOps);
  const retainedOps = new Set(dedupedOps);
  mappedEntries.forEach(({ sourceIndex, mappedOp }) => {
    if (retainedOps.has(mappedOp)) return;
    filteredOps.push({
      reasonCode: 'CANON_OP_DUPLICATE_FILTERED',
      opType: mappedOp.op_type,
      evidence: mappedOp.evidence,
      sourceIndex,
      missingReferences: [],
      mappedOp,
    });
  });

  const candidateOps = [];
  linkSameChapterFactReferences(dedupedOps, refs.chapterId).forEach((mappedOp) => {
    if (hasRequiredAiOpReferences(mappedOp)) {
      candidateOps.push(mappedOp);
      return;
    }
    filteredOps.push({
      reasonCode: 'CANON_OP_MISSING_REFERENCE_FILTERED',
      opType: mappedOp.op_type,
      evidence: mappedOp.evidence,
      sourceIndex: mappedEntries.find((entry) => entry.mappedOp === mappedOp)?.sourceIndex ?? null,
      missingReferences: missingAiOpReferences(mappedOp),
      mappedOp,
    });
  });

  return { candidateOps, filteredOps };
}

export function mapAiOpsToCandidateOps(rawOps, refs) {
  return mapAiOpsToCandidateOpsDetailed(rawOps, refs).candidateOps;
}
