import { CANON_OP_TYPES, CANON_SEVERITY } from './constants';
import { resolveCanonFactRegistration } from '../entityIdentity/factIdentity.js';
import { CANON_MIN_CONFIDENCE, createReport } from './core';
import { buildSemanticOpFingerprint, normalizeOpType } from './opMapping';
import { buildRelationshipPairKey } from './state';
import { cleanText, clampConfidence, normalizeKey, normalizePayload, splitGoals } from './utils';

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
        message: `Op ${op.op_type} khong map duoc tuyen truyen cu the.`,
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
    if (op.op_type === CANON_OP_TYPES.FACT_REGISTERED) {
      const factResolution = resolveCanonFactRegistration({
        fact_description: op.fact_description || op.payload?.description || op.summary || '',
        fact_type: op.payload?.fact_type || 'fact',
        subject_type: op.payload?.subject_type || '',
        subject_id: op.subject_id ?? op.payload?.subject_id ?? null,
        subject_name: op.subject_name || op.payload?.subject_name || '',
      }, factStates);
      if (factResolution.existingFact) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'DUPLICATE_FACT_REGISTRATION',
          message: 'Op ghi nhan su that moi trung voi canon fact da ton tai; he thong se reuse fingerprint hien co.',
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
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

export function filterCommitReadyOps(candidateOps = [], {
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

function tokenizeFactDescription(description) {
  return normalizeKey(description)
    .split(' ')
    .filter((token) => token.length > 3);
}

export function validateDraftTextAgainstTruth({
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
