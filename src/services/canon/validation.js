import { CANON_OP_TYPES, CANON_SEVERITY } from './constants';
import { resolveCanonFactRegistration } from '../entityIdentity/factIdentity.js';
import { CANON_MIN_CONFIDENCE, createReport } from './core';
import { buildSemanticOpFingerprint, normalizeOpType } from './opMapping';
import {
  ITEM_CATEGORIES,
  applyEventToItemState,
  buildRelationshipPairKey,
  normalizeItemCategory,
} from './state';
import { cleanText, clampConfidence, normalizeKey, normalizePayload, splitGoals } from './utils';

const ITEM_OP_TYPES = new Set([
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
]);

const ITEM_USE_OP_TYPES = new Set([
  CANON_OP_TYPES.OBJECT_TRANSFERRED,
  CANON_OP_TYPES.OBJECT_CONSUMED,
  CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
  CANON_OP_TYPES.OBJECT_SPENT,
]);

const ITEM_RECOVERY_OP_TYPES = new Set([
  CANON_OP_TYPES.OBJECT_ACQUIRED,
  CANON_OP_TYPES.OBJECT_FOUND,
  CANON_OP_TYPES.OBJECT_RESTORED,
  CANON_OP_TYPES.OBJECT_RETURNED,
]);

const STACK_LIKE_ITEM_CATEGORIES = new Set([
  ITEM_CATEGORIES.STACK,
  ITEM_CATEGORIES.CONSUMABLE,
  ITEM_CATEGORIES.CURRENCY,
  ITEM_CATEGORIES.RESOURCE,
]);

const STRICT_UNIQUE_ITEM_CATEGORIES = new Set([
  ITEM_CATEGORIES.UNIQUE,
  ITEM_CATEGORIES.EQUIPMENT,
  ITEM_CATEGORIES.CONTAINER,
  ITEM_CATEGORIES.QUEST_ITEM,
]);

function toOptionalNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getPayloadQuantity(payload) {
  return toOptionalNumber(payload.quantity_delta ?? payload.quantity ?? payload.amount ?? payload.count);
}

function getStateQuantity(state) {
  return toOptionalNumber(state?.quantity_remaining);
}

function hasQuantitySignal(state, payload) {
  return getStateQuantity(state) != null
    || getPayloadQuantity(payload) != null
    || toOptionalNumber(payload.quantity_remaining) != null;
}

function getSceneTimelineOrder(op, index, sceneOrderMap = new Map()) {
  if (op.scene_id != null && sceneOrderMap.has(op.scene_id)) {
    return Number(sceneOrderMap.get(op.scene_id));
  }
  const payload = normalizePayload(op.payload);
  const explicitOrder = toOptionalNumber(
    op.scene_order_index
    ?? op.scene_index
    ?? payload.scene_order_index
    ?? payload.scene_index
  );
  return explicitOrder != null ? explicitOrder : index;
}

function getEffectiveItemCategory(state, payload = {}) {
  return normalizeItemCategory(
    payload.item_category
    || payload.item_type
    || payload.object_type
    || state?.item_category
  );
}

function isUnavailableItemState(state) {
  const availability = normalizeKey(state?.availability || '');
  return Boolean(state?.is_consumed)
    || ['consumed', 'destroyed', 'lost', 'unavailable'].includes(availability);
}

function hasRecoverySemantics(op) {
  const payload = normalizePayload(op.payload);
  const availability = normalizeKey(payload.availability || '');
  return ITEM_RECOVERY_OP_TYPES.has(op.op_type)
    || (op.op_type === CANON_OP_TYPES.OBJECT_STATUS_CHANGED
      && ['available', 'found', 'restored', 'recovered', 'acquired'].includes(availability));
}

function isConsumptiveItemOp(op) {
  return [
    CANON_OP_TYPES.OBJECT_CONSUMED,
    CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
    CANON_OP_TYPES.OBJECT_SPENT,
  ].includes(op.op_type);
}

function validateItemTimeline({
  projectId,
  chapterId,
  revisionId,
  candidateOps,
  itemMap,
  sceneOrderMap = new Map(),
}) {
  const reports = [];
  const timelineStates = new Map();
  const itemOps = candidateOps
    .map((op, index) => ({
      op,
      index,
      sceneOrder: getSceneTimelineOrder(op, index, sceneOrderMap),
    }))
    .filter(({ op }) => ITEM_OP_TYPES.has(op.op_type) && op.object_id)
    .sort((left, right) => (
      left.sceneOrder - right.sceneOrder
      || (Number(left.op.scene_id) || 0) - (Number(right.op.scene_id) || 0)
      || left.index - right.index
    ));

  itemOps.forEach(({ op }) => {
    const previousState = timelineStates.get(op.object_id)
      || itemMap.get(op.object_id)
      || {
        project_id: projectId,
        object_id: op.object_id,
        availability: 'available',
        item_category: '',
        quantity_remaining: null,
        is_consumed: false,
      };
    const payload = normalizePayload(op.payload);
    const category = getEffectiveItemCategory(previousState, payload);
    const knownQuantity = getStateQuantity(previousState);
    const requestedQuantity = getPayloadQuantity(payload);
    const hasQuantity = hasQuantitySignal(previousState, payload);
    const stackLike = STACK_LIKE_ITEM_CATEGORIES.has(category);
    const strictUnique = STRICT_UNIQUE_ITEM_CATEGORIES.has(category);
    const missingClassification = !category;

    if (ITEM_USE_OP_TYPES.has(op.op_type) && isUnavailableItemState(previousState) && !hasRecoverySemantics(op)) {
      const availability = cleanText(previousState.availability || 'khong kha dung');
      const severity = strictUnique ? CANON_SEVERITY.ERROR : CANON_SEVERITY.WARNING;
      reports.push(createReport({
        severity,
        ruleCode: strictUnique ? 'ITEM_UNAVAILABLE_REUSED' : 'ITEM_REUSE_NEEDS_REVIEW',
        message: strictUnique
          ? `${op.object_name || 'Vat pham'} dang o trang thai ${availability} nhung bi dung lai ma chua co su kien tim lai/mua lai/khoi phuc/tra lai truoc do.`
          : `${op.object_name || 'Vat pham'} dang o trang thai ${availability}, nhung thieu phan loai/so luong hoac timeline ro rang nen can review thay vi ket luan dung sai.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        evidence: op.evidence,
      }));
    }

    if (isConsumptiveItemOp(op)) {
      if (knownQuantity != null && knownQuantity <= 0 && !hasRecoverySemantics(op)) {
        reports.push(createReport({
          severity: missingClassification ? CANON_SEVERITY.WARNING : CANON_SEVERITY.ERROR,
          ruleCode: missingClassification ? 'ITEM_REUSE_NEEDS_REVIEW' : 'ITEM_QUANTITY_DEPLETED',
          message: missingClassification
            ? `${op.object_name || 'Vat pham'} dang o trang thai da can va so luong bang 0, nhung thieu phan loai nen can review truoc khi ket luan dung sai.`
            : `${op.object_name || 'Vat pham'} da het so luong trong canon nhung draft van tieu hao/dung tiep.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      } else if (knownQuantity != null && requestedQuantity != null && Math.abs(requestedQuantity) > knownQuantity) {
        reports.push(createReport({
          severity: missingClassification ? CANON_SEVERITY.WARNING : CANON_SEVERITY.ERROR,
          ruleCode: missingClassification ? 'ITEM_QUANTITY_NEEDS_REVIEW' : 'ITEM_QUANTITY_OVERSPENT',
          message: missingClassification
            ? `${op.object_name || 'Vat pham'} co dau hieu vuot qua so luong dang co, nhung thieu phan loai nen can review truoc khi ket luan overspend.`
            : `${op.object_name || 'Vat pham'} chi con ${knownQuantity}${previousState.quantity_unit ? ` ${previousState.quantity_unit}` : ''} nhung draft tieu hao ${Math.abs(requestedQuantity)}.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      } else if (stackLike && !hasQuantity) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'ITEM_QUANTITY_NEEDS_REVIEW',
          message: `${op.object_name || 'Vat pham'} la vat pham dang stack/tai nguyen nhung op tieu hao chua ghi ro so luong va don vi.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      }
    }

    timelineStates.set(op.object_id, applyEventToItemState(previousState, op));
  });

  return reports;
}

export function validateCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  candidateOps = [],
  sceneOrderMap = new Map(),
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
      ITEM_OP_TYPES.has(op.op_type)
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
        const intimacyLevel = cleanText(payload.intimacy_level || payload.level || '');
        const relationshipType = cleanText(payload.relationship_type || relationshipState?.relationship_type || '');
        const requiresConsent = ['medium', 'high'].includes(intimacyLevel)
          || ['lover'].includes(relationshipType)
          || Boolean(payload.is_physical_intimacy || payload.requires_consent);
        if (requiresConsent && !cleanText(payload.consent_state || '')) {
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

  reports.push(...validateItemTimeline({
    projectId,
    chapterId,
    revisionId,
    candidateOps,
    itemMap,
    sceneOrderMap,
  }));

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

const SPENT_ITEM_REUSE_MARKERS = [
  // Generic usage across genres.
  'su dung',
  'su dung lai',
  'dung',
  'dung lai',
  'dung tiep',
  'tiep tuc dung',
  'dung de',
  'dem dung',
  'dem ra dung',
  'lay ra dung',
  'dua vao su dung',
  'dua ra su dung',
  'tan dung',
  'van dung',
  'phat huy tac dung',
  'phat huy cong dung',
  'phat huy hieu luc',
  'co tac dung',
  'co hieu luc',

  // Consumables: pills, medicine, food, potions, blood, fuel, mana.
  'uong',
  'nuot',
  'an',
  'nhai',
  'ngam',
  'phuc dung',
  'dung thuoc',
  'thoa',
  'boi',
  'tiem',
  'hut',
  'hap thu',
  'hap thau',
  'luyen hoa',
  'tieu hoa',
  'hoa giai',
  'tri thuong',
  'chua thuong',
  'hoi phuc',
  'hoi mau',
  'hoi mana',
  'hoi linh luc',
  'giai doc',
  'bo sung',
  'nap vao',

  // Magical, cultivation, sci-fi, tech, key, device activation.
  'kich hoat',
  'phat dong',
  'khoi dong',
  'khoi phat',
  'mo khoa',
  'giai phong',
  'van chuyen',
  'truyen linh luc vao',
  'truyen chan khi vao',
  'truyen ma luc vao',
  'truyen nang luong vao',
  'nap linh luc',
  'nap chan khi',
  'nap ma luc',
  'nap nang luong',
  'bom nang luong',
  'ket noi',
  'dong bo',
  'quet',
  'giai ma',
  'trieu hoi',
  'trien khai',
  'mo cong',
  'mo tran',
  'dung lam phap khi',
  'dung lam tran nhan',

  // Weapons, armor, tools, vehicles, artifacts.
  'cam',
  'cam len',
  'nam',
  'nam lay',
  'rut',
  'rut ra',
  'vung',
  'chem',
  'dam',
  'ban',
  'ban ra',
  'khai hoa',
  'len dan',
  'nem',
  'phong',
  'deo',
  'mac',
  'khoac',
  'doi',
  'mang vao',
  'trang bi',
  'lap vao',
  'gan vao',
  'lap rap',
  'dieu khien',
  'dieu dong',
  'cuoi',
  'dung nhu vu khi',
  'dung lam vu khi',
  'dung nhu cong cu',
  'dung lam cong cu',

  // Retrieval, possession, ownership, transfer. These matter for lost/destroyed items.
  'lay',
  'lay ra',
  'lay lai',
  'nhat',
  'nhat len',
  'tim thay',
  'tim lai',
  'thu hoi',
  'nhan lai',
  'doat lai',
  'trao',
  'dua cho',
  'chuyen cho',
  'giao cho',
  'ban cho',
  'mua lai',
  'cat vao',
  'bo vao tui',
  'bo vao nhan',
  'mang theo',
  'cam theo',
  'giu',

  // Repair/revival/restoration of destroyed or spent artifacts.
  'sua',
  'sua lai',
  'khoi phuc',
  'phuc hoi',
  'tai tao',
  'tao lai',
  'ren lai',
  'han lai',
  'chua lanh',
  'lam moi',
  'nap lai',
  'hoi sinh',
  'trung sinh',
];

const SPENT_ITEM_REFERENCE_ONLY_MARKERS = [
  'da dung het',
  'dung het',
  'het roi',
  'da het',
  'khong con',
  'khong the dung',
  'khong the su dung',
  'khong con dung duoc',
  'da bi pha huy',
  'bi pha huy',
  'da mat',
  'bi mat',
  'khong con ton tai',
  'chi con la ky uc',
  'nho ve',
  'nghi ve',
  'nhac den',
  'tung dung',
  'da tung dung',
];

function findTokenSequence(words, targetWords) {
  const positions = [];
  if (targetWords.length === 0 || words.length < targetWords.length) return positions;

  for (let index = 0; index <= words.length - targetWords.length; index += 1) {
    const matches = targetWords.every((word, offset) => words[index + offset] === word);
    if (matches) positions.push(index);
  }
  return positions;
}

function hasTokenPhrase(words, phrase) {
  return findTokenSequence(words, phrase.split(' ').filter(Boolean)).length > 0;
}

function removeTokenPhrase(words, phrase) {
  const targetWords = phrase.split(' ').filter(Boolean);
  if (targetWords.length === 0) return words;
  const result = [...words];
  findTokenSequence(words, targetWords).forEach((position) => {
    for (let offset = 0; offset < targetWords.length; offset += 1) {
      result[position + offset] = '';
    }
  });
  return result.filter(Boolean);
}

function hasNearbyActionMarker(contextWords, targetWords, marker, maxDistance = 4) {
  const markerWords = marker.split(' ').filter(Boolean);
  if (markerWords.length === 0 || targetWords.length === 0) return false;
  const targetPositions = findTokenSequence(contextWords, targetWords);
  const markerPositions = findTokenSequence(contextWords, markerWords);

  return markerPositions.some((markerStart) => {
    const markerEnd = markerStart + markerWords.length - 1;
    return targetPositions.some((targetStart) => {
      const targetEnd = targetStart + targetWords.length - 1;
      const overlapsTarget = markerStart <= targetEnd && markerEnd >= targetStart;
      if (overlapsTarget) return false;
      const distance = markerEnd < targetStart
        ? targetStart - markerEnd
        : markerStart - targetEnd;
      return distance <= maxDistance;
    });
  });
}

function findSpentItemReuseContext(normalizedText, target) {
  const words = normalizedText.split(' ').filter(Boolean);
  const targetWords = target.split(' ').filter(Boolean);
  const positions = findTokenSequence(words, targetWords);

  for (const position of positions) {
    const start = Math.max(0, position - 12);
    const end = Math.min(words.length, position + targetWords.length + 12);
    const contextWords = words.slice(start, end);
    const actionContextWords = SPENT_ITEM_REFERENCE_ONLY_MARKERS.reduce(
      (currentWords, marker) => removeTokenPhrase(currentWords, marker),
      contextWords
    );

    if (SPENT_ITEM_REUSE_MARKERS.some((marker) => hasNearbyActionMarker(actionContextWords, targetWords, marker))) {
      return contextWords.join(' ');
    }
  }

  return '';
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
    const reuseContext = target ? findSpentItemReuseContext(normalizedText, target) : '';
    if (reuseContext) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_REFERENCES_SPENT_ITEM',
        message: `Draft dang goi lai vat pham ${object.name}, trong khi canon hien tai ghi nhan vat pham nay khong con dung duoc.`,
        projectId,
        chapterId,
        revisionId,
        evidence: reuseContext,
      }));
    }
  });

  return reports;
}
