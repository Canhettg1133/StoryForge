import db from '../db/database';
import aiService from '../ai/client';
import { buildPrompt } from '../ai/promptBuilder';
import { TASK_TYPES } from '../ai/router';
import { parseAIJsonValue } from '../../utils/aiJson';
import {
  CANON_OP_TYPES,
  CANON_SEVERITY,
  CHAPTER_COMMIT_STATUS,
  CHAPTER_REVISION_STATUS,
  CANON_REPORT_STATUS,
  CANON_EXTRACTABLE_OPS,
} from './constants';

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function uniqueSummaryParts(items) {
  const seen = new Set();
  const result = [];

  (items || []).forEach((item) => {
    const chunks = String(item || '')
      .split('|')
      .map((part) => cleanText(part))
      .filter(Boolean);

    chunks.forEach((chunk) => {
      const key = normalizeKey(chunk);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(chunk);
    });
  });

  return result;
}

const RETRIEVAL_MODE_CONFIG = {
  compact: {
    chapterMemoryCount: 1,
    entityCap: 6,
    itemCap: 6,
    relationshipCap: 4,
    chapterEventCount: 6,
    chapterEvidenceCount: 3,
    relevantEvidenceCount: 4,
    includeFullProse: false,
  },
  standard: {
    chapterMemoryCount: 2,
    entityCap: 8,
    itemCap: 8,
    relationshipCap: 6,
    chapterEventCount: 10,
    chapterEvidenceCount: 4,
    relevantEvidenceCount: 6,
    includeFullProse: true,
  },
  near_memory_3: {
    chapterMemoryCount: 3,
    entityCap: 12,
    itemCap: 10,
    relationshipCap: 8,
    chapterEventCount: 16,
    chapterEvidenceCount: 8,
    relevantEvidenceCount: 10,
    includeFullProse: true,
  },
  audit_long: {
    chapterMemoryCount: 5,
    entityCap: 20,
    itemCap: 16,
    relationshipCap: 12,
    chapterEventCount: 28,
    chapterEvidenceCount: 14,
    relevantEvidenceCount: 20,
    includeFullProse: true,
  },
};

function resolveRetrievalModeConfig(mode) {
  return RETRIEVAL_MODE_CONFIG[mode] || RETRIEVAL_MODE_CONFIG.standard;
}

function splitGoals(value) {
  if (Array.isArray(value)) {
    return uniqueList(value.map((item) => cleanText(item)).filter(Boolean));
  }
  return uniqueList(
    String(value || '')
      .split(/[,\n;|]/)
      .map((item) => cleanText(item))
      .filter(Boolean)
  );
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

const CANON_MIN_CONFIDENCE = 0.55;

function normalizeOpType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return CANON_EXTRACTABLE_OPS.has(normalized) ? normalized : null;
}

function normalizeAiOpsResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ops)) return parsed.ops;
  return [];
}

function chapterTextFromScenes(scenes) {
  return (scenes || [])
    .map((scene) => cleanText(scene.draft_text || scene.final_text || ''))
    .filter(Boolean)
    .join('\n\n');
}

function loadSnapshotValue(snapshot, key, fallback) {
  if (!snapshot) return fallback;
  try {
    const parsed = typeof snapshot.snapshot_json === 'string'
      ? JSON.parse(snapshot.snapshot_json)
      : snapshot.snapshot_json;
    return parsed?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

function createReport({
  severity,
  ruleCode,
  message,
  projectId,
  chapterId,
  revisionId = null,
  sceneId = null,
  relatedEntityIds = [],
  relatedThreadIds = [],
  relatedEventIds = [],
  evidence = '',
}) {
  return {
    project_id: projectId,
    chapter_id: chapterId,
    revision_id: revisionId,
    scene_id: sceneId,
    severity,
    rule_code: ruleCode,
    message,
    related_entity_ids: uniqueList(relatedEntityIds),
    related_thread_ids: uniqueList(relatedThreadIds),
    related_event_ids: uniqueList(relatedEventIds),
    evidence: cleanText(evidence),
    status: CANON_REPORT_STATUS.ACTIVE,
    created_at: Date.now(),
  };
}

export function inferAliveStatus(summary = '') {
  const normalized = normalizeKey(summary);
  if (!normalized) return 'alive';
  const deadMatch = normalized.match(/(da chet|tu vong|tu tran|hy sinh|mat mang|qua doi|khong con song|bi giet chet|chet tai|chet o|chet trong|chet vi|chet do|chet sau|chet roi)/);
  const rawAliveMatch = normalized.match(/(song sot|duoc cuu song|duoc cuu|binh an|con song|van song|thoat chet)/);
  const aliveMatch = rawAliveMatch
    && !(rawAliveMatch[0] === 'con song' && normalized.slice(Math.max(0, rawAliveMatch.index - 6), rawAliveMatch.index) === 'khong ')
    ? rawAliveMatch
    : null;
  if (deadMatch && aliveMatch) {
    return aliveMatch.index > deadMatch.index ? 'alive' : 'dead';
  }
  if (deadMatch) return 'dead';
  if (aliveMatch) return 'alive';
  return 'alive';
}

function isLivenessSummaryChunk(value, aliveStatus) {
  const normalized = normalizeKey(value);
  if (!normalized) return false;
  if (aliveStatus === 'alive') {
    return /^(da chet|tu vong|tu tran|hy sinh|mat mang|qua doi|khong con song)$/.test(normalized);
  }
  if (aliveStatus === 'dead') {
    return /^(con song|van song|song sot|binh an|duoc cuu|duoc cuu song|thoat chet)$/.test(normalized);
  }
  return false;
}

function appendStateSummaryChunks(parts, summary, aliveStatus) {
  uniqueSummaryParts([summary]).forEach((chunk) => {
    if (!isLivenessSummaryChunk(chunk, aliveStatus)) {
      parts.push(chunk);
    }
  });
}

export function buildCharacterStateSummary(state, fallbackSummary = '') {
  const parts = [];
  if (state?.alive_status === 'dead') parts.push('Da chet');
  else if (state?.alive_status === 'alive') parts.push('Con song');
  if (state?.rescued) parts.push('Da duoc cuu');
  if (state?.injury_level && state.injury_level !== 'none') parts.push(`Bi thuong: ${state.injury_level}`);
  if (state?.current_location_name) parts.push(`Dang o ${state.current_location_name}`);
  if (state?.allegiance) parts.push(`Phe: ${state.allegiance}`);
  if (Array.isArray(state?.goals_active) && state.goals_active.length > 0) {
    parts.push(`Muc tieu: ${state.goals_active.join(', ')}`);
  }
  if (state?.summary) appendStateSummaryChunks(parts, state.summary, state?.alive_status);
  if (parts.length === 0 && fallbackSummary) appendStateSummaryChunks(parts, fallbackSummary, state?.alive_status);
  return uniqueSummaryParts(parts).join(' | ');
}

export function createInitialEntityState(character = {}) {
  return {
    project_id: character.project_id,
    entity_id: character.id,
    entity_type: 'character',
    alive_status: inferAliveStatus(character.current_status || ''),
    current_location_id: null,
    current_location_name: '',
    injury_level: 'none',
    rescued: false,
    goals_active: splitGoals(character.goals),
    goals_abandoned: [],
    knowledge: {},
    allegiance: '',
    summary: cleanText(character.current_status || ''),
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

export function createInitialThreadState(thread = {}) {
  return {
    project_id: thread.project_id,
    thread_id: thread.id,
    state: thread.state || 'active',
    summary: cleanText(thread.description || ''),
    focus_entity_ids: [],
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

function buildStateMaps(entityStates, threadStates) {
  const entityMap = new Map(entityStates.map((state) => [state.entity_id, cloneValue(state)]));
  const threadMap = new Map(threadStates.map((state) => [state.thread_id, cloneValue(state)]));
  return { entityMap, threadMap };
}

function buildFactStates(canonFacts) {
  return (canonFacts || []).map((fact) => ({ ...fact }));
}

function collectFactStatesFromSnapshot(snapshot, canonFacts) {
  const snapshotFacts = loadSnapshotValue(snapshot, 'factStates', null);
  return Array.isArray(snapshotFacts) ? snapshotFacts.map((fact) => ({ ...fact })) : buildFactStates(canonFacts);
}

function toEntityStateRecords(projectId, entityMap) {
  return Array.from(entityMap.values()).map((state) => ({
    ...state,
    project_id: projectId,
    updated_at: Date.now(),
  }));
}

function toThreadStateRecords(projectId, threadMap) {
  return Array.from(threadMap.values()).map((state) => ({
    ...state,
    project_id: projectId,
    updated_at: Date.now(),
  }));
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

function findCharacterByName(characters, name) {
  const target = normalizeKey(name);
  if (!target) return null;
  const matches = exactReferenceMatches(characters, target, (character) => {
    const aliases = Array.isArray(character.aliases) ? character.aliases : [];
    return [character.name, ...aliases];
  });
  return matches.length === 1 ? matches[0] : null;
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

function findFactByDescription(facts, description) {
  const target = normalizeKey(description);
  if (!target) return null;
  const matches = exactReferenceMatches(facts, target, (fact) => [fact.description]);
  return matches.length === 1 ? matches[0] : null;
}

function findObjectByName(objects, name) {
  const target = normalizeKey(name);
  if (!target) return null;
  const matches = exactReferenceMatches(objects, target, (object) => {
    const aliases = Array.isArray(object.aliases) ? object.aliases : [];
    return [object.name, ...aliases];
  });
  return matches.length === 1 ? matches[0] : null;
}

function buildOpFingerprint(op) {
  return [
    op.op_type,
    op.scene_id || '',
    op.subject_id || normalizeKey(op.subject_name),
    op.target_id || normalizeKey(op.target_name),
    op.location_id || normalizeKey(op.location_name),
    op.thread_id || normalizeKey(op.thread_title),
    op.fact_id || normalizeKey(op.fact_description),
    normalizeKey(op.summary),
  ].join('|');
}

function buildSemanticOpFingerprint(op) {
  const payload = normalizePayload(op.payload);
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

function dedupeCandidateOps(candidateOps = []) {
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
      CANON_OP_TYPES.OBJECT_STATUS_CHANGED,
      CANON_OP_TYPES.OBJECT_TRANSFERRED,
      CANON_OP_TYPES.OBJECT_CONSUMED,
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

export function applyEventToEntityState(prevState, event) {
  const next = {
    ...(prevState || {}),
    goals_active: Array.isArray(prevState?.goals_active) ? [...prevState.goals_active] : [],
    goals_abandoned: Array.isArray(prevState?.goals_abandoned) ? [...prevState.goals_abandoned] : [],
    knowledge: prevState?.knowledge ? { ...prevState.knowledge } : {},
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.CHARACTER_STATUS_CHANGED:
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      next.alive_status = inferAliveStatus(next.summary || payload.status_summary);
      break;
    case CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED:
      next.current_location_id = event.location_id || payload.location_id || null;
      next.current_location_name = cleanText(event.location_name || payload.location_name || '');
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    case CANON_OP_TYPES.CHARACTER_RESCUED:
      next.rescued = true;
      next.alive_status = 'alive';
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc cuu');
      break;
    case CANON_OP_TYPES.CHARACTER_DIED:
      next.alive_status = 'dead';
      next.rescued = false;
      next.summary = cleanText(payload.status_summary || event.summary || 'Da chet');
      break;
    case CANON_OP_TYPES.GOAL_CHANGED: {
      const newGoals = uniqueList([
        ...splitGoals(payload.new_goal || ''),
        ...splitGoals(payload.goals_active || []),
      ]);
      const abandoned = uniqueList([
        ...splitGoals(payload.old_goal || ''),
        ...splitGoals(payload.goals_abandoned || []),
      ]);
      next.goals_active = newGoals.length > 0 ? newGoals : next.goals_active;
      next.goals_abandoned = uniqueList([...next.goals_abandoned, ...abandoned]);
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    }
    case CANON_OP_TYPES.ALLEGIANCE_CHANGED:
      next.allegiance = cleanText(payload.allegiance || payload.new_allegiance || event.summary || '');
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    case CANON_OP_TYPES.SECRET_REVEALED: {
      const knowledgeKey = String(event.fact_id || normalizeKey(event.fact_description || payload.fact_description || ''));
      if (knowledgeKey) next.knowledge[knowledgeKey] = true;
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    }
    default:
      break;
  }

  return next;
}

export function applyEventToThreadState(prevState, event) {
  const next = {
    ...(prevState || {}),
    focus_entity_ids: Array.isArray(prevState?.focus_entity_ids) ? [...prevState.focus_entity_ids] : [],
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.THREAD_OPENED:
    case CANON_OP_TYPES.THREAD_PROGRESS:
      next.state = 'active';
      next.summary = cleanText(payload.summary || event.summary || next.summary || '');
      next.focus_entity_ids = uniqueList([...next.focus_entity_ids, event.subject_id, event.target_id]);
      break;
    case CANON_OP_TYPES.THREAD_RESOLVED:
      next.state = 'resolved';
      next.summary = cleanText(payload.summary || event.summary || next.summary || '');
      next.focus_entity_ids = uniqueList([...next.focus_entity_ids, event.subject_id, event.target_id]);
      break;
    default:
      break;
  }

  return next;
}

export function applyEventToItemState(prevState, event) {
  const next = {
    ...(prevState || {}),
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.OBJECT_STATUS_CHANGED:
      next.availability = cleanText(payload.availability || next.availability || 'available') || 'available';
      next.is_damaged = Boolean(payload.is_damaged ?? next.is_damaged);
      next.is_consumed = Boolean(payload.is_consumed ?? next.is_consumed);
      next.current_location_id = payload.location_id || next.current_location_id || null;
      next.current_location_name = cleanText(payload.location_name || next.current_location_name || '');
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_TRANSFERRED:
      next.owner_character_id = event.target_id || payload.owner_character_id || next.owner_character_id || null;
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      break;
    case CANON_OP_TYPES.OBJECT_CONSUMED:
      next.availability = cleanText(payload.availability || 'consumed') || 'consumed';
      next.is_consumed = true;
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc su dung het');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    default:
      break;
  }

  return next;
}

export function applyEventToRelationshipState(prevState, event) {
  const next = {
    ...(prevState || {}),
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED:
      next.relationship_type = cleanText(payload.relationship_type || payload.status || next.relationship_type || 'other') || 'other';
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      next.emotional_aftermath = cleanText(payload.emotional_aftermath || next.emotional_aftermath || '');
      if (payload.secrecy_state) next.secrecy_state = cleanText(payload.secrecy_state) || next.secrecy_state;
      break;
    case CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED:
      next.secrecy_state = cleanText(payload.secrecy_state || payload.secret_state || next.secrecy_state || 'public') || 'public';
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      break;
    case CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED:
      next.intimacy_level = cleanText(payload.intimacy_level || payload.level || next.intimacy_level || 'none') || 'none';
      next.consent_state = cleanText(payload.consent_state || next.consent_state || 'unknown') || 'unknown';
      next.emotional_aftermath = cleanText(payload.emotional_aftermath || next.emotional_aftermath || '');
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      if (payload.secrecy_state) next.secrecy_state = cleanText(payload.secrecy_state) || next.secrecy_state;
      break;
    default:
      break;
  }

  return next;
}

function applyEventToFactStates(prevFactStates, event, chapterOrder) {
  const facts = prevFactStates.map((fact) => ({ ...fact }));
  const payload = normalizePayload(event.payload);

  if (event.op_type === CANON_OP_TYPES.SECRET_REVEALED) {
    const targetFact = facts.find((fact) => fact.id === event.fact_id)
      || facts.find((fact) => normalizeKey(fact.description) === normalizeKey(event.fact_description));
    if (targetFact) {
      targetFact.revealed_at_chapter = chapterOrder + 1;
      targetFact.fact_type = 'fact';
    }
    return facts;
  }

  if (event.op_type === CANON_OP_TYPES.FACT_REGISTERED) {
    facts.push({
      id: event.fact_id || `event:${event.id || `${event.chapter_id}:${facts.length}`}`,
      description: cleanText(event.fact_description || payload.description || event.summary || ''),
      fact_type: cleanText(payload.fact_type || 'fact') || 'fact',
      status: 'active',
      source_chapter_id: event.chapter_id,
      revealed_at_chapter: payload.fact_type === 'secret' ? null : chapterOrder + 1,
    });
  }

  return facts;
}

function tokenizeFactDescription(description) {
  return normalizeKey(description)
    .split(' ')
    .filter((token) => token.length > 3);
}

function loadRevisionOps(revision) {
  if (!revision?.candidate_ops) return [];
  try {
    const parsed = typeof revision.candidate_ops === 'string'
      ? JSON.parse(revision.candidate_ops)
      : revision.candidate_ops;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sendAiTask(taskType, messages, options = {}) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType,
      messages,
      stream: false,
      routeOptions: options.routeOptions,
      nsfwMode: options.nsfwMode,
      superNsfwMode: options.superNsfwMode,
      onComplete: (text) => resolve(text),
      onError: reject,
    });
  });
}

function buildCanonExtractError(error, rawText = '') {
  const baseMessage = cleanText(error?.message || 'Canon extract failed');
  const rawSnippet = cleanText(rawText).slice(0, 240);
  if (rawSnippet) {
    return new Error(`${baseMessage} | Raw: ${rawSnippet}`);
  }
  return new Error(baseMessage);
}

async function getChapterScenes(chapterId) {
  return db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index');
}

async function getChapterAndProject(projectId, chapterId) {
  const [project, chapter] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.get(chapterId),
  ]);
  return { project, chapter };
}

async function getOrCreateChapterCommit(projectId, chapterId) {
  const existing = await db.chapter_commits
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .first();
  if (existing) return existing;
  const now = Date.now();
  const id = await db.chapter_commits.add({
    project_id: projectId,
    chapter_id: chapterId,
    current_revision_id: null,
    canonical_revision_id: null,
    status: CHAPTER_COMMIT_STATUS.DRAFT,
    warning_count: 0,
    error_count: 0,
    updated_at: now,
  });
  return db.chapter_commits.get(id);
}

export async function createChapterRevision({
  projectId,
  chapterId,
  chapterText,
  status = CHAPTER_REVISION_STATUS.DRAFT,
  metadata = {},
}) {
  const existing = await db.chapter_revisions
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .toArray();
  const revisionNumber = existing.reduce((maxValue, item) => Math.max(maxValue, item.revision_number || 0), 0) + 1;
  const now = Date.now();
  const revisionId = await db.chapter_revisions.add({
    project_id: projectId,
    chapter_id: chapterId,
    revision_number: revisionNumber,
    status,
    chapter_text: chapterText,
    candidate_ops: '[]',
    validator_summary: null,
    ...metadata,
    created_at: now,
    updated_at: now,
  });
  return db.chapter_revisions.get(revisionId);
}

async function updateChapterCommitSummary(projectId, chapterId, status, reports, revisionId) {
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const warningCount = reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length;
  const errorCount = reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length;
  await db.chapter_commits.update(commit.id, {
    current_revision_id: revisionId || commit.current_revision_id || null,
    status,
    warning_count: warningCount,
    error_count: errorCount,
    updated_at: Date.now(),
  });
}

async function replaceValidatorReports(projectId, revisionId, reports) {
  const existing = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  if (existing.length > 0) {
    await db.validator_reports.bulkDelete(existing.map((item) => item.id));
  }
  if (reports.length > 0) {
    await db.validator_reports.bulkAdd(reports);
  }
}

async function loadPreChapterTruth(projectId, chapterId) {
  const [characters, locations, plotThreads, canonFacts, chapters, objects, relationships] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.relationships.where('project_id').equals(projectId).toArray(),
  ]);

  const chapter = chapters.find((item) => item.id === chapterId) || null;
  const chapterOrder = chapter?.order_index ?? 0;
  const snapshots = await db.chapter_snapshots.where('project_id').equals(projectId).toArray();
  const snapshot = snapshots
    .filter((item) => {
      const snapChapter = chapters.find((chapterItem) => chapterItem.id === item.chapter_id);
      return snapChapter && snapChapter.order_index < chapterOrder;
    })
    .sort((a, b) => {
      const chapterA = chapters.find((item) => item.id === a.chapter_id);
      const chapterB = chapters.find((item) => item.id === b.chapter_id);
      return (chapterB?.order_index || 0) - (chapterA?.order_index || 0);
    })[0] || null;

  const entityStates = snapshot
    ? loadSnapshotValue(snapshot, 'entityStates', []).map((state) => ({ ...state }))
    : characters.map((character) => createInitialEntityState(character));
  const threadStates = snapshot
    ? loadSnapshotValue(snapshot, 'threadStates', []).map((state) => ({ ...state }))
    : plotThreads.map((thread) => createInitialThreadState(thread));
  const factStates = collectFactStatesFromSnapshot(snapshot, canonFacts);
  const itemStates = snapshot
    ? loadSnapshotValue(snapshot, 'itemStates', []).map((state) => ({ ...state }))
    : objects.map((object) => createInitialItemState(object));
  const relationshipStates = snapshot
    ? loadSnapshotValue(snapshot, 'relationshipStates', []).map((state) => ({ ...state }))
    : relationships.map((relationship) => createInitialRelationshipState(relationship));

  return {
    chapter,
    chapterOrder,
    chapters,
    characters,
    locations,
    plotThreads,
    objects,
    relationships,
    canonFacts,
    entityStates,
    threadStates,
    factStates,
    itemStates,
    relationshipStates,
  };
}

export function validateCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  candidateOps = [],
  entityStates = [],
  threadStates = [],
  factStates = [],
  itemStates = [],
  relationshipStates = [],
}) {
  const reports = [];
  const entityMap = new Map(entityStates.map((state) => [state.entity_id, state]));
  const threadMap = new Map(threadStates.map((state) => [state.thread_id, state]));
  const factMap = new Map(factStates.map((fact) => [fact.id, fact]));
  const itemMap = new Map(itemStates.map((state) => [state.object_id, state]));
  const relationshipMap = new Map(relationshipStates.map((state) => [state.pair_key, state]));
  const seenFingerprints = new Set();

  candidateOps.forEach((op) => {
    const fingerprint = buildSemanticOpFingerprint(op);
    if (!normalizeOpType(op.op_type)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'INVALID_OP_TYPE',
        message: `Op type khong hop le: ${op.op_type || '(trong)'}.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        evidence: op.evidence,
      }));
      return;
    }

    (op.mapping_errors || []).forEach((mappingError) => {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: mappingError.ruleCode || 'AMBIGUOUS_REFERENCE',
        message: `Khong the map ro rang "${mappingError.rawValue}" vao ${mappingError.kind || 'reference'}; co ${mappingError.candidateIds?.length || 0} ket qua trung ten.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: mappingError.kind === 'CHARACTER' ? mappingError.candidateIds : [],
        evidence: op.evidence || mappingError.rawValue,
      }));
    });

    if (seenFingerprints.has(fingerprint)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DUPLICATE_CANON_OP',
        message: `Op ${op.op_type} bi lap trong cung mot revision.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        relatedThreadIds: [op.thread_id],
        evidence: op.evidence,
      }));
      return;
    }
    seenFingerprints.add(fingerprint);

    if (!op.scene_id) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'MISSING_SCENE_LINK',
        message: `Op ${op.op_type} chua gan scene cu the.`,
        projectId,
        chapterId,
        revisionId,
        evidence: op.evidence,
      }));
    }

    if (op.confidence > 0 && op.confidence < CANON_MIN_CONFIDENCE) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'LOW_CONFIDENCE_CANON_OP_FILTERED',
        message: `Op ${op.op_type} co do tin cay thap (${op.confidence.toFixed(2)}) va se khong duoc commit.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        relatedThreadIds: [op.thread_id],
        evidence: op.evidence,
      }));
    }

    if (
      [
        CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
        CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED,
        CANON_OP_TYPES.CHARACTER_RESCUED,
        CANON_OP_TYPES.CHARACTER_DIED,
        CANON_OP_TYPES.GOAL_CHANGED,
        CANON_OP_TYPES.ALLEGIANCE_CHANGED,
      ].includes(op.op_type)
      && !op.subject_id
    ) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_SUBJECT_REFERENCE',
        message: `Op ${op.op_type} khong map duoc nhan vat chinh.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        evidence: op.evidence,
      }));
    }

    if (op.op_type === CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED && !op.location_id) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_LOCATION_REFERENCE',
        message: 'Op doi vi tri nhan vat khong map duoc dia diem cu the.',
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id],
        evidence: op.evidence,
      }));
    }

    if (
      [
        CANON_OP_TYPES.THREAD_OPENED,
        CANON_OP_TYPES.THREAD_PROGRESS,
        CANON_OP_TYPES.THREAD_RESOLVED,
      ].includes(op.op_type)
      && !op.thread_id
    ) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_THREAD_REFERENCE',
        message: `Op ${op.op_type} khong map duoc tuyen truyện cu the.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        evidence: op.evidence,
      }));
    }

    if (op.op_type === CANON_OP_TYPES.SECRET_REVEALED && !op.fact_id) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_FACT_REFERENCE',
        message: 'Op tiet lo bi mat khong map duoc bi mat canon cu the.',
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        evidence: op.evidence,
      }));
    }

    if (op.op_type === CANON_OP_TYPES.FACT_REGISTERED && !cleanText(op.fact_description || op.payload?.description || op.summary)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'EMPTY_FACT_DESCRIPTION',
        message: 'Op ghi nhan su that moi nhung khong co mo ta ro rang.',
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        evidence: op.evidence,
      }));
    }

    if (
      [
        CANON_OP_TYPES.OBJECT_STATUS_CHANGED,
        CANON_OP_TYPES.OBJECT_TRANSFERRED,
        CANON_OP_TYPES.OBJECT_CONSUMED,
      ].includes(op.op_type)
      && !op.object_id
    ) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_OBJECT_REFERENCE',
        message: `Op ${op.op_type} khong map duoc vat pham cu the.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        evidence: op.evidence,
      }));
    }

    if (op.object_id) {
      const itemState = itemMap.get(op.object_id);
      if (
        itemState
        && ['consumed', 'destroyed'].includes(cleanText(itemState.availability))
        && [CANON_OP_TYPES.OBJECT_TRANSFERRED, CANON_OP_TYPES.OBJECT_CONSUMED].includes(op.op_type)
      ) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'ITEM_UNAVAILABLE_REUSED',
          message: `${op.object_name || 'Vat pham'} da het hieu luc hoac da bi dung het nhung van bi dung tiep.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      }
      if (
        itemState
        && op.op_type === CANON_OP_TYPES.OBJECT_CONSUMED
        && (itemState.is_consumed || cleanText(itemState.availability) === 'consumed')
      ) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'ITEM_ALREADY_CONSUMED',
          message: `${op.object_name || 'Vat pham'} da duoc danh dau la da dung het truoc do.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      }
    }

    if (
      [
        CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
        CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
        CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
      ].includes(op.op_type)
      && (!op.subject_id || !op.target_id)
    ) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'MISSING_RELATIONSHIP_REFERENCE',
        message: `Op ${op.op_type} phai map duoc ca hai nhan vat trong cap quan he.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        evidence: op.evidence,
      }));
    }

    if (op.subject_id && op.target_id) {
      const pairKey = buildRelationshipPairKey(op.subject_id, op.target_id);
      const relationshipState = relationshipMap.get(pairKey);
      if (op.op_type === CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED) {
        const payload = normalizePayload(op.payload);
        if (!cleanText(payload.consent_state || '')) {
          reports.push(createReport({
            severity: CANON_SEVERITY.WARNING,
            ruleCode: 'INTIMACY_CONSENT_UNSPECIFIED',
            message: 'Thay doi muc do than mat nhung chua co consent_state ro rang.',
            projectId,
            chapterId,
            revisionId,
            sceneId: op.scene_id || null,
            relatedEntityIds: [op.subject_id, op.target_id],
            evidence: op.evidence,
          }));
        }
      }
      if (
        relationshipState
        && op.op_type === CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED
        && relationshipState.secrecy_state === 'secret_exposed'
      ) {
        const payload = normalizePayload(op.payload);
        const nextSecrecy = cleanText(payload.secrecy_state || payload.secret_state || '');
        if (nextSecrecy === 'secret' && !cleanText(payload.reason || op.summary)) {
          reports.push(createReport({
            severity: CANON_SEVERITY.WARNING,
            ruleCode: 'RELATIONSHIP_SECRET_RESET',
            message: 'Quan he da lo nhung draft lai dua ve bi mat ma khong co ly do ro rang.',
            projectId,
            chapterId,
            revisionId,
            sceneId: op.scene_id || null,
            relatedEntityIds: [op.subject_id, op.target_id],
            evidence: op.evidence,
          }));
        }
      }
    }

    if (op.subject_id) {
      const subjectState = entityMap.get(op.subject_id);
      if (subjectState?.alive_status === 'dead'
        && ![CANON_OP_TYPES.CHARACTER_DIED].includes(op.op_type)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'DEAD_CHARACTER_ACTIVE',
          message: `${op.subject_name || 'Nhan vat'} da chet nhung van phat sinh hanh dong ${op.op_type}.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.thread_id) {
      const threadState = threadMap.get(op.thread_id);
      if (threadState?.state === 'active'
        && op.op_type === CANON_OP_TYPES.THREAD_OPENED) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'THREAD_ALREADY_ACTIVE',
          message: `Thread "${op.thread_title || 'khong ro'}" dang mo, khong nen mo lai ma khong co ly do ro rang.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedThreadIds: [op.thread_id],
          evidence: op.evidence,
        }));
      }
      if (threadState?.state === 'resolved'
        && [CANON_OP_TYPES.THREAD_OPENED, CANON_OP_TYPES.THREAD_PROGRESS].includes(op.op_type)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'THREAD_ALREADY_RESOLVED',
          message: `Thread "${op.thread_title || 'khong ro'}" da dong nhung draft van day tiep.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedThreadIds: [op.thread_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED && op.subject_id) {
      const state = entityMap.get(op.subject_id);
      const payload = normalizePayload(op.payload);
      const nextLocationName = cleanText(payload.location_name || op.location_name || '');
      if (
        state?.current_location_name
        && nextLocationName
        && normalizeKey(state.current_location_name) !== normalizeKey(nextLocationName)
        && !cleanText(payload.reason || payload.status_summary || op.summary)
      ) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'LOCATION_CHANGE_WITHOUT_REASON',
          message: `${op.subject_name || 'Nhan vat'} doi dia diem tu "${state.current_location_name}" sang "${nextLocationName}" nhung chua co ly do ro rang.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.SECRET_REVEALED) {
      const fact = factMap.get(op.fact_id);
      if (fact?.revealed_at_chapter) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'SECRET_ALREADY_REVEALED',
          message: `Bi mat "${fact.description}" da duoc tiet lo truoc do.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.GOAL_CHANGED && op.subject_id) {
      const state = entityMap.get(op.subject_id);
      const payload = normalizePayload(op.payload);
      const nextGoals = splitGoals(payload.new_goal || payload.goals_active || '');
      const abandoned = new Set(state?.goals_abandoned || []);
      const conflicting = nextGoals.filter((goal) => abandoned.has(goal));
      if (conflicting.length > 0 && !cleanText(payload.reason || op.summary)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'GOAL_REVERSAL_WITHOUT_REASON',
          message: `${op.subject_name || 'Nhan vat'} quay lai muc tieu cu "${conflicting.join(', ')}" ma khong co giai thich ro rang.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.ALLEGIANCE_CHANGED && op.subject_id) {
      const state = entityMap.get(op.subject_id);
      const payload = normalizePayload(op.payload);
      const nextAllegiance = cleanText(payload.allegiance || payload.new_allegiance || op.summary || '');
      if (state?.allegiance && nextAllegiance && normalizeKey(state.allegiance) !== normalizeKey(nextAllegiance) && !cleanText(payload.reason || payload.status_summary)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'ALLEGIANCE_CHANGE_WITHOUT_REASON',
          message: `${op.subject_name || 'Nhan vat'} doi phe nhung chua co ly do ro rang trong payload.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.subject_id && op.target_id && op.op_type === CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED) {
      const relationshipState = relationshipMap.get(buildRelationshipPairKey(op.subject_id, op.target_id));
      const payload = normalizePayload(op.payload);
      const nextRelationshipType = cleanText(payload.relationship_type || payload.status || '');
      const currentRelationshipType = cleanText(relationshipState?.relationship_type || '');
      const hostileTypes = new Set(['enemy', 'rival']);
      const alliedTypes = new Set(['ally', 'friend', 'lover', 'family', 'mentor', 'subordinate']);
      const isSharpReversal = (
        (alliedTypes.has(currentRelationshipType) && hostileTypes.has(nextRelationshipType))
        || (hostileTypes.has(currentRelationshipType) && alliedTypes.has(nextRelationshipType))
      );

      if (relationshipState && isSharpReversal && !cleanText(payload.reason || payload.status_summary || op.summary)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'RELATIONSHIP_REVERSAL_WITHOUT_REASON',
          message: `Cap quan he ${op.subject_name || op.subject_id}/${op.target_name || op.target_id} dao chieu manh nhung chua co ly do ro rang.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id, op.target_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.subject_id && op.target_id && op.op_type === CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED) {
      const payload = normalizePayload(op.payload);
      const intimacyLevel = cleanText(payload.intimacy_level || '');
      if (['medium', 'high'].includes(intimacyLevel) && !cleanText(payload.emotional_aftermath || payload.status_summary || op.summary)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'INTIMACY_AFTERMATH_MISSING',
          message: 'Canh thay doi do than mat thieu du am cam xuc/hau qua, de gay dut continuity NSFW.',
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id, op.target_id],
          evidence: op.evidence,
        }));
      }
    }
  });

  return reports;
}

export function reportsHaveErrors(reports = []) {
  return reports.some((report) => report.severity === CANON_SEVERITY.ERROR);
}

function filterCommitReadyOps(candidateOps = [], {
  projectId,
  chapterId,
  revisionId = null,
  requireConfidence = false,
} = {}) {
  const reports = [];
  const ops = [];

  candidateOps.forEach((op) => {
    const confidence = clampConfidence(op.confidence);
    const hasConfidence = Number.isFinite(Number(op.confidence)) && Number(op.confidence) > 0;
    const shouldFilter = requireConfidence
      ? confidence < CANON_MIN_CONFIDENCE
      : (hasConfidence && confidence < CANON_MIN_CONFIDENCE);

    if (shouldFilter) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'LOW_CONFIDENCE_CANON_OP_FILTERED',
        message: `Op ${op.op_type} co do tin cay thap (${confidence.toFixed(2)}) va da bi loai khoi commit.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id, op.target_id],
        relatedThreadIds: [op.thread_id],
        evidence: op.evidence,
      }));
      return;
    }

    ops.push(op);
  });

  return { ops, reports };
}

function validateDraftTextAgainstTruth({
  projectId,
  chapterId,
  revisionId = null,
  sceneText = '',
  entityStates = [],
  threadStates = [],
  factStates = [],
  characters = [],
  objects = [],
  itemStates = [],
}) {
  const reports = [];
  const normalizedText = normalizeKey(sceneText);
  if (!normalizedText) return reports;

  threadStates.forEach((threadState) => {
    if (threadState.state !== 'resolved') return;
    const threadText = normalizeKey(threadState.summary || '');
    if (threadText && normalizedText.includes(threadText)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.INFO,
        ruleCode: 'DRAFT_REFERENCES_RESOLVED_THREAD',
        message: 'Draft dang goi lai mot thread da dong.',
        projectId,
        chapterId,
        revisionId,
        relatedThreadIds: [threadState.thread_id],
      }));
    }
  });

  factStates.forEach((fact) => {
    if (fact.fact_type !== 'secret' || fact.revealed_at_chapter) return;
    const tokens = tokenizeFactDescription(fact.description).slice(0, 5);
    if (tokens.length < 2) return;
    const hitCount = tokens.filter((token) => normalizedText.includes(token)).length;
    if (hitCount >= Math.min(3, tokens.length)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_TOUCHES_HIDDEN_SECRET',
        message: `Draft co dau hieu dong vao bi mat chua lo: "${fact.description}".`,
        projectId,
        chapterId,
        revisionId,
      }));
    }
  });

  itemStates.forEach((state) => {
    if (!(state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability)))) return;
    const object = objects.find((item) => item.id === state.object_id);
    if (!object?.name) return;
    const target = normalizeKey(object.name);
    if (target && normalizedText.includes(target)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_REFERENCES_SPENT_ITEM',
        message: `Draft dang goi lai vat pham ${object.name}, trong khi canon hien tai ghi nhan vat pham nay khong con dung duoc.`,
        projectId,
        chapterId,
        revisionId,
      }));
    }
  });

  return reports;
}

export async function extractCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  chapterText = '',
  scenes = [],
  routeOptions = null,
}) {
  const { project } = await getChapterAndProject(projectId, chapterId);
  const [characters, locations, plotThreads, canonFacts, objects, relationships] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.relationships.where('project_id').equals(projectId).toArray(),
  ]);

  let promptTemplates = {};
  if (project?.prompt_templates) {
    try {
      promptTemplates = JSON.parse(project.prompt_templates);
    } catch {
      promptTemplates = {};
    }
  }

  const messages = buildPrompt(TASK_TYPES.CANON_EXTRACT_OPS, {
    projectId,
    chapterId,
    sceneText: chapterText,
    sceneList: scenes.map((scene, index) => ({
      index: index + 1,
      title: scene.title || `Canh ${index + 1}`,
      text: cleanText(scene.draft_text || scene.final_text || ''),
    })),
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
    relationships,
    genre: project?.genre_primary || '',
    projectTitle: project?.title || '',
    promptTemplates,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });

  const rawText = await sendAiTask(TASK_TYPES.CANON_EXTRACT_OPS, messages, {
    routeOptions: routeOptions || undefined,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  if (!cleanText(rawText)) {
    throw buildCanonExtractError(new Error('AI canon extract returned empty response'), rawText);
  }

  let parsed;
  try {
    parsed = parseAIJsonValue(rawText);
  } catch (error) {
    throw buildCanonExtractError(error, rawText);
  }

  const candidateOps = mapAiOpsToCandidateOps(normalizeAiOpsResponse(parsed), {
    chapterId,
    scenes,
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
  });

  if (revisionId) {
    await db.chapter_revisions.update(revisionId, {
      candidate_ops: JSON.stringify(candidateOps),
      updated_at: Date.now(),
    });
  }

  return candidateOps;
}

export async function validateRevision(chapterRevisionId, mode = 'draft', options = {}) {
  const revision = await db.chapter_revisions.get(chapterRevisionId);
  if (!revision) {
    throw new Error('Khong tim thay chapter revision de validate.');
  }

  const scenes = await getChapterScenes(revision.chapter_id);
  const preTruth = await loadPreChapterTruth(revision.project_id, revision.chapter_id);
  let candidateOps = loadRevisionOps(revision);
  const extractionFallbackReports = [];
  const commitReadinessReports = [];
  const shouldFailClosed = mode === 'canonicalize';
  let extractionAttempted = false;

  if (candidateOps.length === 0 && cleanText(revision.chapter_text)) {
    extractionAttempted = true;
    try {
      candidateOps = await extractCandidateOps({
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        chapterText: revision.chapter_text,
        scenes,
        routeOptions: options.routeOptions || null,
      });
    } catch (error) {
      console.warn('[Canon] extractCandidateOps failed, falling back to heuristic-only validation:', error);
      candidateOps = [];
      extractionFallbackReports.push(createReport({
        severity: shouldFailClosed ? CANON_SEVERITY.ERROR : CANON_SEVERITY.WARNING,
        ruleCode: 'CANON_EXTRACT_FALLBACK',
        message: shouldFailClosed
          ? 'Khong trich xuat duoc canon ops tu AI nen khong canon hoa chuong nay.'
          : 'Khong trich xuat duoc canon ops tu AI, he thong tiep tuc bang heuristic validator de tranh vo luong canon hoa.',
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        evidence: error?.message || '',
      }));
    }
  }

  if (shouldFailClosed) {
    const filtered = filterCommitReadyOps(candidateOps, {
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
      requireConfidence: extractionAttempted,
    });
    candidateOps = filtered.ops;
    commitReadinessReports.push(...filtered.reports);

    if (cleanText(revision.chapter_text) && extractionAttempted && candidateOps.length === 0) {
      commitReadinessReports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'NO_COMMITTABLE_CANON_OPS',
        message: 'AI khong tra ve canon op hop le de commit cho chuong co noi dung. Can xem lai extraction hoac canon hoa thu cong.',
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        evidence: cleanText(revision.chapter_text).slice(0, 240),
      }));
    }
  }

  const schemaReports = validateCandidateOps({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    candidateOps,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    itemStates: preTruth.itemStates,
    relationshipStates: preTruth.relationshipStates,
  });

  const heuristicReports = validateDraftTextAgainstTruth({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    sceneText: revision.chapter_text,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  });

  const reports = [...schemaReports, ...heuristicReports, ...commitReadinessReports, ...extractionFallbackReports];
  await replaceValidatorReports(revision.project_id, revision.id, reports);

  const hasErrors = reportsHaveErrors(reports);
  const status = hasErrors
    ? CHAPTER_REVISION_STATUS.BLOCKED
    : (mode === 'canonicalize' ? CHAPTER_REVISION_STATUS.VALIDATED : CHAPTER_REVISION_STATUS.DRAFT);

  await db.chapter_revisions.update(revision.id, {
    status,
    candidate_ops: JSON.stringify(candidateOps),
    validator_summary: JSON.stringify({
      warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
      error_count: reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
    }),
    updated_at: Date.now(),
  });

  await updateChapterCommitSummary(
    revision.project_id,
    revision.chapter_id,
    hasErrors ? CHAPTER_COMMIT_STATUS.BLOCKED
      : (reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.DRAFT),
    reports,
    revision.id
  );

  return {
    revision: await db.chapter_revisions.get(revision.id),
    candidateOps,
    reports,
    hasErrors,
  };
}

function buildStoryEventsFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    op_type: op.op_type,
    subject_id: op.subject_id,
    target_id: op.target_id,
    thread_id: op.thread_id,
    location_id: op.location_id,
    fact_id: op.fact_id,
    object_id: op.object_id || null,
    status: 'committed',
    subject_name: op.subject_name,
    target_name: op.target_name,
    thread_title: op.thread_title,
    location_name: op.location_name,
    fact_description: op.fact_description,
    object_name: op.object_name,
    summary: op.summary,
    payload: op.payload,
    confidence: op.confidence,
    created_at: Date.now(),
  }));
}

function buildEvidenceFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op, index) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    target_type: 'candidate_op',
    target_id: `${revisionId}:${index}:${op.op_type}`,
    source_type: 'chapter_text',
    evidence_text: op.evidence,
    summary: op.summary,
    created_at: Date.now(),
  }));
}

async function writeSnapshot(projectId, chapterId, revisionId, snapshot) {
  const existing = await db.chapter_snapshots
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .first();
  const record = {
    project_id: projectId,
    chapter_id: chapterId,
    revision_id: revisionId,
    snapshot_json: JSON.stringify(snapshot),
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  if (existing) {
    await db.chapter_snapshots.update(existing.id, record);
    return existing.id;
  }
  return db.chapter_snapshots.add(record);
}

function cleanLegacyProjectionStatus(value) {
  const parts = uniqueSummaryParts([value]);
  if (parts.length === 0) return cleanText(value);
  const hasAliveLabel = parts.some((part) => isLivenessSummaryChunk(part, 'dead'));
  const hasDeadLabel = parts.some((part) => isLivenessSummaryChunk(part, 'alive'));
  if (!hasAliveLabel || !hasDeadLabel) {
    return cleanText(value);
  }
  const aliveStatus = inferAliveStatus(value);
  return uniqueSummaryParts(parts.filter((part) => !isLivenessSummaryChunk(part, aliveStatus))).join(' | ');
}

async function cleanLegacyCharacterProjection(projectId) {
  const characters = await db.characters.where('project_id').equals(projectId).toArray();
  await Promise.all(characters.map((character) => {
    const currentStatus = cleanText(character.current_status || '');
    if (!currentStatus) return Promise.resolve();
    const cleanedStatus = cleanLegacyProjectionStatus(currentStatus);
    if (!cleanedStatus || cleanedStatus === currentStatus) return Promise.resolve();
    return db.characters.update(character.id, {
      current_status: cleanedStatus,
      updated_at: Date.now(),
    });
  }));
}

async function clearCanonProjection(projectId) {
  const [entityRows, threadRows, itemRows, relationshipRows, timelineRows, snapshotRows] = await Promise.all([
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.entityTimeline.where('project_id').equals(projectId).toArray(),
    db.chapter_snapshots.where('project_id').equals(projectId).toArray(),
  ]);

  await Promise.all([
    entityRows.length > 0 ? db.entity_state_current.bulkDelete(entityRows.map((row) => row.id)) : Promise.resolve(),
    threadRows.length > 0 ? db.plot_thread_state.bulkDelete(threadRows.map((row) => row.id)) : Promise.resolve(),
    itemRows.length > 0 ? db.item_state_current.bulkDelete(itemRows.map((row) => row.id)) : Promise.resolve(),
    relationshipRows.length > 0 ? db.relationship_state_current.bulkDelete(relationshipRows.map((row) => row.id)) : Promise.resolve(),
    timelineRows.length > 0 ? db.entityTimeline.bulkDelete(timelineRows.map((row) => row.id)) : Promise.resolve(),
    snapshotRows.length > 0 ? db.chapter_snapshots.bulkDelete(snapshotRows.map((row) => row.id)) : Promise.resolve(),
  ]);
}

function appendCompatibilityTimeline(timelineEvents, event) {
  if (!event.subject_id) return;
  timelineEvents.push({
    project_id: event.project_id,
    entity_id: event.subject_id,
    entity_type: 'character',
    chapter_id: event.chapter_id,
    type: event.op_type,
    description: cleanText(event.summary || event.op_type),
    oldValue: null,
    newValue: cleanText(event.summary || ''),
    timestamp: event.created_at,
  });
}

export async function invalidateFromChapter(projectId, chapterId) {
  const chapters = await db.chapters.where('project_id').equals(projectId).sortBy('order_index');
  const targetChapter = chapters.find((chapter) => chapter.id === chapterId);
  if (!targetChapter) return [];

  const downstream = chapters.filter((chapter) => chapter.order_index > targetChapter.order_index);
  const invalidatedIds = [];
  for (const chapter of downstream) {
    const commit = await db.chapter_commits
      .where('[project_id+chapter_id]')
      .equals([projectId, chapter.id])
      .first();
    if (!commit || !commit.canonical_revision_id) continue;
    invalidatedIds.push(chapter.id);
    await db.chapter_commits.update(commit.id, {
      status: CHAPTER_COMMIT_STATUS.INVALIDATED,
      updated_at: Date.now(),
    });
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.INVALIDATED,
      updated_at: Date.now(),
    });
  }
  return invalidatedIds;
}

async function bulkDeleteByIds(table, rows = []) {
  if (!rows.length) return;
  await table.bulkDelete(rows.map((row) => row.id));
}

function buildPurgeArchivePayload(payload = {}) {
  return JSON.stringify(payload);
}

export async function purgeChapterCanonState(projectId, chapterId) {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter || chapter.project_id !== projectId) {
    return null;
  }

  const [
    commit,
    revisions,
    events,
    reports,
    evidence,
    snapshots,
    sourceFacts,
    sourceCharacters,
    sourceLocations,
    sourceTerms,
    sourceObjects,
  ] = await Promise.all([
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, chapterId]).first(),
    db.chapter_revisions.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.story_events.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.validator_reports.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).filter((item) => item.chapter_id === chapterId).toArray(),
    db.chapter_snapshots.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.canonFacts.where('project_id').equals(projectId).filter((fact) => fact.source_chapter_id === chapterId).toArray(),
    db.characters.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.locations.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.worldTerms.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.objects.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
  ]);

  const warnings = [
    'Manual or legacy codex entries without source provenance were preserved for review.',
  ];

  const archivePayload = {
    chapter: {
      id: chapter.id,
      title: chapter.title || '',
      order_index: chapter.order_index ?? null,
    },
    removed: {
      chapter_commit: commit ? cloneValue(commit) : null,
      chapter_revisions: revisions.map((item) => cloneValue(item)),
      story_events: events.map((item) => cloneValue(item)),
      validator_reports: reports.map((item) => cloneValue(item)),
      memory_evidence: evidence.map((item) => cloneValue(item)),
      chapter_snapshots: snapshots.map((item) => cloneValue(item)),
      canon_facts: sourceFacts.map((item) => cloneValue(item)),
      characters: sourceCharacters.map((item) => cloneValue(item)),
      locations: sourceLocations.map((item) => cloneValue(item)),
      world_terms: sourceTerms.map((item) => cloneValue(item)),
      objects: sourceObjects.map((item) => cloneValue(item)),
    },
    warnings,
  };

  await db.transaction(
    'rw',
    db.chapter_commits,
    db.chapter_revisions,
    db.story_events,
    db.validator_reports,
    db.memory_evidence,
    db.chapter_snapshots,
    db.canonFacts,
    db.characters,
    db.locations,
    db.worldTerms,
    db.objects,
    db.canon_purge_archives,
    async () => {
      if (commit?.id) {
        await db.chapter_commits.delete(commit.id);
      }
      await Promise.all([
        bulkDeleteByIds(db.chapter_revisions, revisions),
        bulkDeleteByIds(db.story_events, events),
        bulkDeleteByIds(db.validator_reports, reports),
        bulkDeleteByIds(db.memory_evidence, evidence),
        bulkDeleteByIds(db.chapter_snapshots, snapshots),
        bulkDeleteByIds(db.canonFacts, sourceFacts),
        bulkDeleteByIds(db.characters, sourceCharacters),
        bulkDeleteByIds(db.locations, sourceLocations),
        bulkDeleteByIds(db.worldTerms, sourceTerms),
        bulkDeleteByIds(db.objects, sourceObjects),
      ]);

      await db.canon_purge_archives.add({
        project_id: projectId,
        chapter_id: chapterId,
        chapter_title: chapter.title || '',
        chapter_order_index: chapter.order_index ?? null,
        warnings,
        removed_counts: {
          revisions: revisions.length,
          events: events.length,
          reports: reports.length,
          evidence: evidence.length,
          snapshots: snapshots.length,
          facts: sourceFacts.length,
          characters: sourceCharacters.length,
          locations: sourceLocations.length,
          world_terms: sourceTerms.length,
          objects: sourceObjects.length,
        },
        payload_json: buildPurgeArchivePayload(archivePayload),
        created_at: Date.now(),
      });
    },
  );

  return archivePayload;
}

export async function rebuildCanonFromChapter(projectId, chapterId = null, options = {}) {
  const chapters = await db.chapters.where('project_id').equals(projectId).sortBy('order_index');
  const commits = await db.chapter_commits.where('project_id').equals(projectId).toArray();
  const canonicalCommits = commits
    .filter((commit) => commit.canonical_revision_id && commit.status === CHAPTER_COMMIT_STATUS.CANONICAL)
    .sort((a, b) => {
      const chapterA = chapters.find((chapter) => chapter.id === a.chapter_id);
      const chapterB = chapters.find((chapter) => chapter.id === b.chapter_id);
      return (chapterA?.order_index || 0) - (chapterB?.order_index || 0);
    });

  const baseCharacters = await db.characters.where('project_id').equals(projectId).toArray();
  const baseThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
  const baseFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
  const baseObjects = await db.objects.where('project_id').equals(projectId).toArray();
  const baseRelationships = await db.relationships.where('project_id').equals(projectId).toArray();
  const { entityMap, threadMap } = buildStateMaps(
    baseCharacters.map((character) => createInitialEntityState(character)),
    baseThreads.map((thread) => createInitialThreadState(thread))
  );
  const itemMap = new Map(baseObjects.map((object) => [object.id, createInitialItemState(object)]));
  const relationshipMap = new Map(
    baseRelationships.map((relationship) => [
      buildRelationshipPairKey(relationship.character_a_id, relationship.character_b_id),
      createInitialRelationshipState(relationship),
    ])
  );
  let factStates = buildFactStates(baseFacts);
  const timelineEvents = [];

  await clearCanonProjection(projectId);

  for (const commit of canonicalCommits) {
    const chapter = chapters.find((item) => item.id === commit.chapter_id);
    if (!chapter) continue;
    const events = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();

    events
      .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || a.id - b.id)
      .forEach((event) => {
        if (event.subject_id) {
          const current = entityMap.get(event.subject_id)
            || createInitialEntityState({ id: event.subject_id, project_id: projectId });
          entityMap.set(event.subject_id, applyEventToEntityState(current, event));
        }
        if (event.target_id && event.op_type === CANON_OP_TYPES.CHARACTER_RESCUED) {
          const targetState = entityMap.get(event.target_id)
            || createInitialEntityState({ id: event.target_id, project_id: projectId });
          entityMap.set(event.target_id, applyEventToEntityState(targetState, {
            ...event,
            subject_id: event.target_id,
            summary: event.summary || 'Da duoc cuu',
          }));
        }
        if (event.thread_id) {
          const currentThread = threadMap.get(event.thread_id)
            || createInitialThreadState({ id: event.thread_id, project_id: projectId });
          threadMap.set(event.thread_id, applyEventToThreadState(currentThread, event));
        }
        if (event.object_id) {
          const currentItem = itemMap.get(event.object_id)
            || createInitialItemState({ id: event.object_id, project_id: projectId });
          itemMap.set(event.object_id, applyEventToItemState(currentItem, event));
        }
        if (event.subject_id && event.target_id && [
          CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
          CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
          CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
        ].includes(event.op_type)) {
          const pairKey = buildRelationshipPairKey(event.subject_id, event.target_id);
          const currentRelationship = relationshipMap.get(pairKey)
            || createInitialRelationshipState({
              project_id: projectId,
              character_a_id: Math.min(event.subject_id, event.target_id),
              character_b_id: Math.max(event.subject_id, event.target_id),
            });
          relationshipMap.set(pairKey, applyEventToRelationshipState(currentRelationship, event));
        }
        factStates = applyEventToFactStates(factStates, event, chapter.order_index);
        appendCompatibilityTimeline(timelineEvents, event);
      });

    await writeSnapshot(projectId, chapter.id, commit.canonical_revision_id, {
      entityStates: toEntityStateRecords(projectId, entityMap),
      threadStates: toThreadStateRecords(projectId, threadMap),
      factStates,
      itemStates: Array.from(itemMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() })),
      relationshipStates: Array.from(relationshipMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() })),
    });
  }

  const finalEntityStates = toEntityStateRecords(projectId, entityMap);
  const finalThreadStates = toThreadStateRecords(projectId, threadMap);
  const finalItemStates = Array.from(itemMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() }));
  const finalRelationshipStates = Array.from(relationshipMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() }));
  if (finalEntityStates.length > 0) {
    await db.entity_state_current.bulkPut(finalEntityStates);
  }
  if (finalThreadStates.length > 0) {
    await db.plot_thread_state.bulkPut(finalThreadStates);
  }
  if (finalItemStates.length > 0) {
    await db.item_state_current.bulkPut(finalItemStates);
  }
  if (finalRelationshipStates.length > 0) {
    await db.relationship_state_current.bulkPut(finalRelationshipStates);
  }
  if (timelineEvents.length > 0) {
    await db.entityTimeline.bulkAdd(timelineEvents);
  }
  if (options.cleanLegacyProjection) {
    await cleanLegacyCharacterProjection(projectId);
  }

  return {
    entityStates: finalEntityStates,
    threadStates: finalThreadStates,
    factStates,
    itemStates: finalItemStates,
    relationshipStates: finalRelationshipStates,
  };
}

export async function canonicalizeChapter(projectId, chapterId, options = {}) {
  const scenes = await getChapterScenes(chapterId);
  const chapterText = chapterTextFromScenes(scenes);
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const validation = await validateRevision(revision.id, 'canonicalize', {
    routeOptions: options.routeOptions || null,
  });
  if (validation.hasErrors) {
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, validation.reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports: validation.reports,
    };
  }

  const candidateOps = validation.candidateOps;
  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, candidateOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, candidateOps);

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(candidateOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: validation.reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: validation.reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  await rebuildCanonFromChapter(projectId, chapterId);
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports: validation.reports,
    invalidatedChapterIds,
  };
}

function buildRelationshipPairKey(characterAId, characterBId) {
  const a = Number(characterAId) || characterAId;
  const b = Number(characterBId) || characterBId;
  return [a, b].sort((left, right) => Number(left) - Number(right)).join(':');
}

export function createInitialItemState(object = {}) {
  return {
    project_id: object.project_id,
    object_id: object.id,
    availability: 'available',
    owner_character_id: object.owner_character_id || null,
    current_location_id: null,
    current_location_name: '',
    is_consumed: false,
    is_damaged: false,
    usage_notes: '',
    summary: cleanText(object.description || ''),
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

export function createInitialRelationshipState(relationship = {}) {
  return {
    project_id: relationship.project_id,
    pair_key: buildRelationshipPairKey(relationship.character_a_id, relationship.character_b_id),
    character_a_id: relationship.character_a_id,
    character_b_id: relationship.character_b_id,
    relationship_type: cleanText(relationship.relation_type || 'other') || 'other',
    trust_level: 'unknown',
    intimacy_level: 'none',
    secrecy_state: 'public',
    consent_state: 'unknown',
    emotional_aftermath: '',
    summary: cleanText(relationship.description || ''),
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

export async function canonicalizeCandidateOps({
  projectId,
  chapterId,
  candidateOps = [],
  chapterText = '',
  sourceType = 'manual_review',
}) {
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const currentCanonicalRevision = commit.canonical_revision_id
    ? await db.chapter_revisions.get(commit.canonical_revision_id)
    : null;
  const baseOps = loadRevisionOps(currentCanonicalRevision);
  const mergedOps = dedupeCandidateOps([...baseOps, ...candidateOps]);
  const fallbackText = chapterText || chapterTextFromScenes(await getChapterScenes(chapterId));
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: fallbackText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const filtered = filterCommitReadyOps(mergedOps, {
    projectId,
    chapterId,
    revisionId: revision.id,
    requireConfidence: false,
  });
  const commitReadyOps = filtered.ops;
  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const reports = [
    ...validateCandidateOps({
      projectId,
      chapterId,
      revisionId: revision.id,
      candidateOps: commitReadyOps,
      entityStates: preTruth.entityStates,
      threadStates: preTruth.threadStates,
      factStates: preTruth.factStates,
      itemStates: preTruth.itemStates,
      relationshipStates: preTruth.relationshipStates,
    }),
    ...filtered.reports,
  ];
  if (mergedOps.length > 0 && commitReadyOps.length === 0) {
    reports.push(createReport({
      severity: CANON_SEVERITY.ERROR,
      ruleCode: 'NO_COMMITTABLE_CANON_OPS',
      message: 'Tat ca canon ops de xuat deu bi loai, khong co op hop le de commit.',
      projectId,
      chapterId,
      revisionId: revision.id,
      evidence: cleanText(fallbackText).slice(0, 240),
    }));
  }

  await replaceValidatorReports(projectId, revision.id, reports);

  if (reportsHaveErrors(reports)) {
    await db.chapter_revisions.update(revision.id, {
      status: CHAPTER_REVISION_STATUS.BLOCKED,
      candidate_ops: JSON.stringify(commitReadyOps),
      updated_at: Date.now(),
    });
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports,
    };
  }

  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, commitReadyOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, commitReadyOps).map((item) => ({
    ...item,
    source_type: sourceType,
  }));

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(commitReadyOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  await rebuildCanonFromChapter(projectId, chapterId);
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports,
    invalidatedChapterIds,
  };
}

export async function buildRetrievalPacket({
  projectId,
  chapterId,
  sceneId = null,
  detectedCharacterIds = [],
  detectedObjectIds = [],
  mode = 'standard',
}) {
  const modeConfig = resolveRetrievalModeConfig(mode);
  const [
    project,
    chapters,
    chapterCommits,
    entityStates,
    threadStates,
    canonFacts,
    scenes,
    plotThreads,
    objects,
    itemStates,
    relationshipStates,
    chapterMetas,
    memoryEvidence,
    storyEvents,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    chapterId ? db.scenes.where('chapter_id').equals(chapterId).toArray() : Promise.resolve([]),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.chapterMeta.where('project_id').equals(projectId).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).toArray(),
    db.story_events.where('project_id').equals(projectId).toArray(),
  ]);

  const chapter = chapters.find((item) => item.id === chapterId) || null;
  const scene = sceneId ? scenes.find((item) => item.id === sceneId) || null : null;
  let sceneCharacters = [];
  if (scene?.characters_present) {
    try {
      sceneCharacters = JSON.parse(scene.characters_present);
    } catch {
      sceneCharacters = [];
    }
  }

  const relevantCharacterIds = uniqueList([
    ...detectedCharacterIds,
    scene?.pov_character_id,
    ...sceneCharacters,
  ]);
  const relevantObjectIds = uniqueList([
    ...detectedObjectIds,
  ]);
  const relevantEntityStates = relevantCharacterIds.length > 0
    ? entityStates.filter((state) => relevantCharacterIds.includes(state.entity_id))
    : entityStates.slice(0, modeConfig.entityCap);
  const relevantItemStates = relevantObjectIds.length > 0
    ? itemStates.filter((state) => relevantObjectIds.includes(state.object_id))
    : itemStates.slice(0, modeConfig.itemCap);
  const relevantRelationshipStates = relevantCharacterIds.length > 0
    ? relationshipStates.filter((state) => relevantCharacterIds.includes(state.character_a_id) || relevantCharacterIds.includes(state.character_b_id))
    : relationshipStates.slice(0, modeConfig.relationshipCap);

  const activeThreadStates = threadStates.filter((threadState) => threadState.state !== 'resolved');
  const commit = chapterCommits.find((row) => row.chapter_id === chapterId) || null;
  const snapshots = await db.chapter_snapshots.where('project_id').equals(projectId).toArray();
  const latestSnapshot = snapshots
    .filter((item) => {
      const snapChapter = chapters.find((chapterItem) => chapterItem.id === item.chapter_id);
      return snapChapter && (!chapter || snapChapter.order_index < chapter.order_index);
    })
    .sort((a, b) => {
      const chapterA = chapters.find((item) => item.id === a.chapter_id);
      const chapterB = chapters.find((item) => item.id === b.chapter_id);
      return (chapterB?.order_index || 0) - (chapterA?.order_index || 0);
    })[0] || null;

  const factStates = collectFactStatesFromSnapshot(latestSnapshot, canonFacts)
    .map((fact) => {
      if (fact.fact_type === 'secret' && fact.revealed_at_chapter && chapter && fact.revealed_at_chapter <= chapter.order_index + 1) {
        return { ...fact, fact_type: 'fact' };
      }
      return fact;
    });

  const previousChapters = chapter
    ? chapters.filter((item) => item.order_index < chapter.order_index).slice(-modeConfig.chapterMemoryCount)
    : chapters.slice(-modeConfig.chapterMemoryCount);
  const recentChapterMemory = await Promise.all(previousChapters.map(async (memoryChapter) => {
    const [chapterScenes, chapterMeta] = await Promise.all([
      db.scenes.where('chapter_id').equals(memoryChapter.id).sortBy('order_index'),
      Promise.resolve(chapterMetas.find((meta) => meta.chapter_id === memoryChapter.id) || null),
    ]);
    const prose = chapterScenes
      .map((chapterScene) => cleanText(chapterScene.draft_text || chapterScene.final_text || ''))
      .filter(Boolean)
      .join('\n\n');
    const chapterEvents = storyEvents
      .filter((event) => event.chapter_id === memoryChapter.id && event.status !== 'superseded')
      .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0))
      .slice(0, modeConfig.chapterEventCount);
    const chapterEvidence = memoryEvidence
      .filter((item) => item.chapter_id === memoryChapter.id)
      .slice(0, modeConfig.chapterEvidenceCount);
    return {
      chapter_id: memoryChapter.id,
      chapter_title: memoryChapter.title || `Chuong ${memoryChapter.order_index + 1}`,
      chapter_order: memoryChapter.order_index,
      summary: chapterMeta?.summary || memoryChapter.summary || '',
      bridge_buffer: chapterMeta?.last_prose_buffer || '',
      emotional_state: chapterMeta?.emotional_state || null,
      prose: modeConfig.includeFullProse ? prose : '',
      events: chapterEvents,
      evidence: chapterEvidence,
    };
  }));

  const recentChapterIds = new Set(previousChapters.map((item) => item.id));
  const relevantEvidence = memoryEvidence
    .filter((item) => recentChapterIds.has(item.chapter_id))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, modeConfig.relevantEvidenceCount);

  const criticalConstraints = {
    deadCharacters: entityStates
      .filter((state) => state.alive_status === 'dead')
      .map((state) => state.entity_id),
    locationAnchors: relevantEntityStates
      .filter((state) => state.current_location_name)
      .map((state) => ({
        entity_id: state.entity_id,
        location_name: state.current_location_name,
      })),
    unavailableItems: relevantItemStates
      .filter((state) => state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability)))
      .map((state) => ({
        object_id: state.object_id,
        object_name: objects.find((object) => object.id === state.object_id)?.name || '',
        availability: state.availability,
      })),
    resolvedThreads: threadStates
      .filter((state) => state.state === 'resolved')
      .map((state) => state.thread_id),
    revealedFacts: factStates
      .filter((fact) => fact.fact_type === 'fact')
      .map((fact) => ({
        id: fact.id,
        description: fact.description,
      })),
    relationshipConstraints: relevantRelationshipStates.map((state) => ({
      pair_key: state.pair_key,
      intimacy_level: state.intimacy_level,
      secrecy_state: state.secrecy_state,
      consent_state: state.consent_state,
      emotional_aftermath: state.emotional_aftermath,
      summary: state.summary,
    })),
  };

  return {
    retrievalMode: mode,
    project,
    chapter,
    chapterCommit: commit,
    relevantEntityStates,
    relevantItemStates,
    relevantRelationshipStates,
    activeThreadStates,
    factStates,
    plotThreads,
    recentChapterMemory,
    relevantEvidence,
    criticalConstraints,
  };
}

export async function validateSceneDraft({
  projectId,
  chapterId,
  sceneId = null,
  sceneText = '',
}) {
  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const reports = validateDraftTextAgainstTruth({
    projectId,
    chapterId,
    sceneText,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  });

  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: sceneText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });
  const scopedReports = reports.map((report) => ({ ...report, scene_id: sceneId || report.scene_id }));
  await replaceValidatorReports(projectId, revision.id, scopedReports);
  await updateChapterCommitSummary(
    projectId,
    chapterId,
    scopedReports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : commit.status,
    scopedReports,
    revision.id
  );

  return {
    revisionId: revision.id,
    reports: scopedReports,
  };
}

export async function getChapterCanonState(projectId, chapterId) {
  const commit = await db.chapter_commits
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .first();
  if (!commit) {
    return {
      status: CHAPTER_COMMIT_STATUS.DRAFT,
      warningCount: 0,
      errorCount: 0,
      reports: [],
      revision: null,
    };
  }
  const revision = commit.current_revision_id ? await db.chapter_revisions.get(commit.current_revision_id) : null;
  const reports = commit.current_revision_id
    ? await db.validator_reports.where('[project_id+revision_id]').equals([projectId, commit.current_revision_id]).toArray()
    : [];
  return {
    status: commit.status,
    warningCount: commit.warning_count || 0,
    errorCount: commit.error_count || 0,
    reports,
    revision,
    commit,
  };
}

export async function getProjectCanonOverview(projectId, { limit = 12 } = {}) {
  const [
    chapters,
    plotThreads,
    objects,
    commits,
    revisions,
    events,
    reports,
    evidence,
    entityStates,
    threadStates,
    itemStates,
    relationshipStates,
    purgeArchives,
  ] = await Promise.all([
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.chapter_revisions.where('project_id').equals(projectId).toArray(),
    db.story_events.where('project_id').equals(projectId).toArray(),
    db.validator_reports.where('project_id').equals(projectId).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.canon_purge_archives.where('project_id').equals(projectId).toArray(),
  ]);

  const chapterMap = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const threadMap = new Map(plotThreads.map((thread) => [thread.id, thread]));
  const revisionMap = new Map(revisions.map((revision) => [revision.id, revision]));
  const objectMap = new Map(objects.map((object) => [object.id, object]));

  const chapterCommits = commits
    .map((commit) => {
      const chapter = chapterMap.get(commit.chapter_id) || null;
      return {
        ...commit,
        chapter_title: chapter?.title || `Chuong ${chapter?.order_index || commit.chapter_id}`,
        chapter_order: chapter?.order_index || 0,
        current_revision: revisionMap.get(commit.current_revision_id) || null,
        canonical_revision: revisionMap.get(commit.canonical_revision_id) || null,
      };
    })
    .sort((a, b) => a.chapter_order - b.chapter_order);

  const recentEvents = events
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((event) => {
      const chapter = chapterMap.get(event.chapter_id) || null;
      return {
        ...event,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
        thread_title: threadMap.get(event.thread_id)?.title || event.thread_title || '',
      };
    });

  const recentReports = reports
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((report) => {
      const chapter = chapterMap.get(report.chapter_id) || null;
      return {
        ...report,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const recentEvidence = evidence
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((item) => {
      const chapter = chapterMap.get(item.chapter_id) || null;
      return {
        ...item,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const recentRevisions = revisions
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((revision) => {
      const chapter = chapterMap.get(revision.chapter_id) || null;
      return {
        ...revision,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const decoratedThreadStates = threadStates
    .map((threadState) => ({
      ...threadState,
      thread_title: threadMap.get(threadState.thread_id)?.title || threadState.summary || `Thread ${threadState.thread_id}`,
    }))
    .sort((a, b) => String(a.thread_title || '').localeCompare(String(b.thread_title || '')));

  const decoratedItemStates = itemStates
    .map((itemState) => ({
      ...itemState,
      object_name: objectMap.get(itemState.object_id)?.name || `Vat pham ${itemState.object_id}`,
    }))
    .sort((a, b) => String(a.object_name || '').localeCompare(String(b.object_name || '')));

  const decoratedRelationshipStates = relationshipStates
    .slice()
    .sort((a, b) => String(a.pair_key || '').localeCompare(String(b.pair_key || '')));

  const criticalConstraints = {
    deadCharacters: entityStates.filter((state) => state.alive_status === 'dead'),
    blockedItems: decoratedItemStates.filter((state) => state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability))),
    sensitiveRelationships: decoratedRelationshipStates.filter((state) => (
      (state.intimacy_level && state.intimacy_level !== 'none')
      || (state.secrecy_state && state.secrecy_state !== 'public')
      || (state.emotional_aftermath && cleanText(state.emotional_aftermath))
    )),
    activeWarnings: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING || report.severity === CANON_SEVERITY.ERROR)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, limit),
  };

  const stats = {
    chapter_count: chapters.length,
    canonical_count: chapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.CANONICAL).length,
    blocked_count: chapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.BLOCKED).length,
    invalidated_count: chapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.INVALIDATED).length,
    warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
    error_count: reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
    event_count: events.length,
    evidence_count: evidence.length,
    revision_count: revisions.length,
    item_count: decoratedItemStates.length,
    relationship_count: decoratedRelationshipStates.length,
    purge_archive_count: purgeArchives.length,
  };

  const recentPurgeArchives = purgeArchives
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, Math.max(3, Math.min(limit, 8)))
    .map((item) => {
      let payload = null;
      try {
        payload = typeof item.payload_json === 'string' ? JSON.parse(item.payload_json) : item.payload_json;
      } catch {
        payload = null;
      }
      return {
        ...item,
        payload,
      };
    });

  return {
    stats,
    chapterCommits,
    entityStates: entityStates.slice().sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id))),
    threadStates: decoratedThreadStates,
    itemStates: decoratedItemStates,
    relationshipStates: decoratedRelationshipStates,
    recentEvents,
    recentReports,
    recentEvidence,
    recentRevisions,
    recentPurgeArchives,
    plotThreads,
    criticalConstraints,
  };
}

export async function getChapterRevisionHistory(projectId, chapterId) {
  const [chapter, commit, revisions, reports, events, evidence, snapshots] = await Promise.all([
    db.chapters.get(chapterId),
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, chapterId]).first(),
    db.chapter_revisions.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.validator_reports.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.story_events.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).filter((item) => item.chapter_id === chapterId).toArray(),
    db.chapter_snapshots.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
  ]);

  const history = revisions
    .map((revision) => ({
      ...revision,
      report_count: reports.filter((report) => report.revision_id === revision.id).length,
      event_count: events.filter((event) => event.revision_id === revision.id).length,
      evidence_count: evidence.filter((item) => item.revision_id === revision.id).length,
      has_snapshot: snapshots.some((snapshot) => snapshot.revision_id === revision.id),
      is_current: commit?.current_revision_id === revision.id,
      is_canonical: commit?.canonical_revision_id === revision.id,
    }))
    .sort((a, b) => (b.revision_number || 0) - (a.revision_number || 0) || (b.created_at || 0) - (a.created_at || 0));

  return {
    chapter,
    commit,
    revisions: history,
  };
}

export async function getChapterRevisionDetail(projectId, revisionId) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision || revision.project_id !== projectId) return null;

  const [chapter, commit, reports, events, evidence, snapshot] = await Promise.all([
    db.chapters.get(revision.chapter_id),
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, revision.chapter_id]).first(),
    db.validator_reports.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.story_events.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.memory_evidence.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.chapter_snapshots.where('[project_id+revision_id]').equals([projectId, revisionId]).first(),
  ]);

  let snapshotData = null;
  if (snapshot?.snapshot_json) {
    try {
      snapshotData = typeof snapshot.snapshot_json === 'string'
        ? JSON.parse(snapshot.snapshot_json)
        : snapshot.snapshot_json;
    } catch {
      snapshotData = null;
    }
  }

  const sortedEvents = events
    .slice()
    .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0));

  const sortedEvidence = evidence
    .slice()
    .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0));

  return {
    chapter,
    commit,
    revision: {
      ...revision,
      is_current: commit?.current_revision_id === revision.id,
      is_canonical: commit?.canonical_revision_id === revision.id,
    },
    reports: reports.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    events: sortedEvents,
    evidence: sortedEvidence,
    snapshot,
    snapshotData,
  };
}

export async function repairChapterRevision({ projectId, chapterId, revisionId, reportId = null }) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision) {
    throw new Error('Khong tim thay revision can repair.');
  }
  const reports = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  const scopedReports = reportId
    ? reports.filter((report) => String(report.id) === String(reportId))
    : reports;
  if (reportId && scopedReports.length === 0) {
    throw new Error('Khong tim thay report can sua.');
  }
  const { project, chapter } = await getChapterAndProject(projectId, chapterId);
  const messages = buildPrompt(TASK_TYPES.CANON_REPAIR, {
    projectId,
    chapterTitle: chapter?.title || '',
    projectTitle: project?.title || '',
    sceneText: revision.chapter_text || '',
    validatorReports: scopedReports,
    genre: project?.genre_primary || '',
  });
  const text = await sendAiTask(TASK_TYPES.CANON_REPAIR, messages, {
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  return {
    text,
    report: scopedReports[0] || null,
    reports: scopedReports,
    revision,
  };
}

export async function saveRepairDraftRevision({
  projectId,
  chapterId,
  revisionId,
  reportId = null,
  chapterText,
}) {
  const trimmedText = String(chapterText || '').trim();
  if (!trimmedText) {
    throw new Error('Khong co noi dung de luu thanh draft.');
  }

  const draftRevision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: trimmedText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
    metadata: {
      source_revision_id: revisionId || null,
      source_report_id: reportId || null,
      repair_source: 'validator_report',
    },
  });

  return draftRevision;
}
