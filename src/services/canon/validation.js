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

const EPISTEMICALLY_RISKY_OP_TYPES = new Set([
  CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
  CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED,
  CANON_OP_TYPES.CHARACTER_RESCUED,
  CANON_OP_TYPES.CHARACTER_DIED,
  CANON_OP_TYPES.SECRET_REVEALED,
  CANON_OP_TYPES.ALLEGIANCE_CHANGED,
  CANON_OP_TYPES.THREAD_RESOLVED,
  CANON_OP_TYPES.FACT_REGISTERED,
  ...ITEM_OP_TYPES,
  CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
  CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
  CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
]);

const EXPLICIT_UNCERTAINTY_MARKERS = [
  'chi la tin don',
  'tin don',
  'lai don',
  'don rang',
  'cho rang',
  'chac da',
  'co the da',
  'khong dua ra bang chung',
  'khong co bang chung',
  'chua the xac dinh',
  'khong the xac minh',
  'bi tuong la',
  'giac mo',
  'hoi tuong',
  'loi noi doi',
  'gia chet',
  'sap chet',
  'gan chet',
];

function hasUnnegatedUncertaintyMarker(evidenceText) {
  return EXPLICIT_UNCERTAINTY_MARKERS.some((marker) => {
    const markerPattern = new RegExp(`\\b${marker.replace(/\s+/gu, '\\s+')}\\b`, 'gu');
    for (const match of evidenceText.matchAll(markerPattern)) {
      const markerIndex = match.index || 0;
      const prefix = evidenceText.slice(Math.max(0, markerIndex - 100), markerIndex);
      const negationMatches = [...prefix.matchAll(/\bkhong phai(?: la)?\b/gu)];
      const lastNegation = negationMatches.at(-1);
      const negationScope = lastNegation
        ? prefix.slice((lastNegation.index || 0) + lastNegation[0].length)
        : '';
      const scopeWasBroken = /\b(?:nhung|tuy nhien|song|sau do)\b/gu.test(negationScope);
      if (!lastNegation || scopeWasBroken) return true;
    }
    return false;
  });
}

const CANON_OP_LABELS = {
  [CANON_OP_TYPES.CHARACTER_STATUS_CHANGED]: 'đổi trạng thái nhân vật',
  [CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED]: 'đổi vị trí nhân vật',
  [CANON_OP_TYPES.CHARACTER_RESCUED]: 'nhân vật được cứu',
  [CANON_OP_TYPES.CHARACTER_DIED]: 'nhân vật tử vong',
  [CANON_OP_TYPES.SECRET_REVEALED]: 'tiết lộ bí mật',
  [CANON_OP_TYPES.GOAL_CHANGED]: 'đổi mục tiêu',
  [CANON_OP_TYPES.ALLEGIANCE_CHANGED]: 'đổi phe',
  [CANON_OP_TYPES.THREAD_OPENED]: 'mở tuyến truyện',
  [CANON_OP_TYPES.THREAD_PROGRESS]: 'đẩy tiếp tuyến truyện',
  [CANON_OP_TYPES.THREAD_RESOLVED]: 'khép tuyến truyện',
  [CANON_OP_TYPES.FACT_REGISTERED]: 'ghi nhận sự thật',
  [CANON_OP_TYPES.OBJECT_ACQUIRED]: 'nhận vật phẩm',
  [CANON_OP_TYPES.OBJECT_STATUS_CHANGED]: 'đổi trạng thái vật phẩm',
  [CANON_OP_TYPES.OBJECT_TRANSFERRED]: 'chuyển vật phẩm',
  [CANON_OP_TYPES.OBJECT_CONSUMED]: 'dùng hết vật phẩm',
  [CANON_OP_TYPES.OBJECT_LOST]: 'mất vật phẩm',
  [CANON_OP_TYPES.OBJECT_FOUND]: 'tìm lại vật phẩm',
  [CANON_OP_TYPES.OBJECT_RESTORED]: 'khôi phục vật phẩm',
  [CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED]: 'tiêu hao một phần vật phẩm',
  [CANON_OP_TYPES.OBJECT_SPENT]: 'tiêu hao vật phẩm',
  [CANON_OP_TYPES.OBJECT_RETURNED]: 'trả lại vật phẩm',
  [CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED]: 'đổi trạng thái quan hệ',
  [CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED]: 'đổi mức bí mật quan hệ',
  [CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED]: 'đổi mức độ thân mật',
};

function describeCanonOp(opType) {
  return CANON_OP_LABELS[opType] || `thao tác canon ${opType || '(trống)'}`;
}

function toOptionalNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const NUMERIC_PAYLOAD_FIELDS = [
  'quantity_delta',
  'quantity',
  'amount',
  'count',
  'quantity_remaining',
  'quantity_total',
  'location_id',
  'target_character_id',
  'receiver_character_id',
  'recipient_character_id',
  'owner_character_id',
  'holder_character_id',
  'return_to_character_id',
];

const NON_NEGATIVE_PAYLOAD_FIELDS = new Set([
  'quantity_remaining',
  'quantity_total',
]);

const BOOLEAN_PAYLOAD_FIELDS = [
  'is_consumed',
  'is_damaged',
  'is_physical_intimacy',
  'requires_consent',
];

const TEXT_PAYLOAD_FIELDS = [
  'status_summary',
  'summary',
  'description',
  'new_goal',
  'old_goal',
  'allegiance',
  'new_allegiance',
  'relationship_type',
  'status',
  'trust_level',
  'secrecy_state',
  'secret_state',
  'intimacy_level',
  'level',
  'consent_state',
  'availability',
  'usage_notes',
  'item_category',
  'item_type',
  'object_type',
  'quantity_unit',
  'unit',
  'fact_type',
  'subject_type',
  'subject_name',
  'reason',
  'emotional_aftermath',
  'transfer_kind',
  'transfer_mode',
  'transfer_type',
  'location_name',
];

function invalidCanonPayloadFields(op) {
  const payload = normalizePayload(op.payload);
  const invalid = [...(op.payload_validation_errors || [])];

  NUMERIC_PAYLOAD_FIELDS.forEach((field) => {
    const value = payload[field];
    if (value == null || value === '') return;
    const numeric = typeof value === 'number'
      ? value
      : (typeof value === 'string' && value.trim() ? Number(value) : Number.NaN);
    if (!Number.isFinite(numeric) || (NON_NEGATIVE_PAYLOAD_FIELDS.has(field) && numeric < 0)) {
      invalid.push(field);
    }
  });
  BOOLEAN_PAYLOAD_FIELDS.forEach((field) => {
    if (payload[field] != null && typeof payload[field] !== 'boolean') invalid.push(field);
  });
  TEXT_PAYLOAD_FIELDS.forEach((field) => {
    if (payload[field] != null && typeof payload[field] !== 'string') invalid.push(field);
  });

  const category = payload.item_category || payload.item_type || payload.object_type;
  if (typeof category === 'string' && category && !normalizeItemCategory(category)) {
    invalid.push('item_category');
  }
  ['goals_active', 'goals_abandoned'].forEach((field) => {
    const value = payload[field];
    if (value != null && typeof value !== 'string' && !Array.isArray(value)) invalid.push(field);
  });

  return [...new Set(invalid)];
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
      const availability = cleanText(previousState.availability || 'không khả dụng');
      const severity = strictUnique ? CANON_SEVERITY.ERROR : CANON_SEVERITY.WARNING;
      reports.push(createReport({
        severity,
        ruleCode: strictUnique ? 'ITEM_UNAVAILABLE_REUSED' : 'ITEM_REUSE_NEEDS_REVIEW',
        message: strictUnique
          ? `${op.object_name || 'Vật phẩm'} đang ở trạng thái ${availability} nhưng bị dùng lại mà chưa có sự kiện tìm lại/mua lại/khôi phục/trả lại trước đó.`
          : `${op.object_name || 'Vật phẩm'} đang ở trạng thái ${availability}, nhưng thiếu phân loại/số lượng hoặc dòng thời gian rõ ràng nên cần xem lại thay vì kết luận đúng sai.`,
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
            ? `${op.object_name || 'Vật phẩm'} đang ở trạng thái đã cạn và số lượng bằng 0, nhưng thiếu phân loại nên cần xem lại trước khi kết luận đúng sai.`
            : `${op.object_name || 'Vật phẩm'} đã hết số lượng trong canon nhưng bản nháp vẫn tiêu hao/dùng tiếp.`,
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
            ? `${op.object_name || 'Vật phẩm'} có dấu hiệu vượt quá số lượng đang có, nhưng thiếu phân loại nên cần xem lại trước khi kết luận tiêu hao quá mức.`
            : `${op.object_name || 'Vật phẩm'} chỉ còn ${knownQuantity}${previousState.quantity_unit ? ` ${previousState.quantity_unit}` : ''} nhưng bản nháp tiêu hao ${Math.abs(requestedQuantity)}.`,
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
          message: `${op.object_name || 'Vật phẩm'} là vật phẩm dạng cộng dồn/tài nguyên nhưng thao tác tiêu hao chưa ghi rõ số lượng và đơn vị.`,
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
        message: `Loại thao tác canon không hợp lệ: ${op.op_type || '(trống)'}.`,
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
        message: `Không thể khớp rõ ràng "${mappingError.rawValue}" vào ${mappingError.kind || 'tham chiếu'}; có ${mappingError.candidateIds?.length || 0} kết quả trùng tên.`,
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
        message: `Thao tác ${describeCanonOp(op.op_type)} bị lặp trong cùng một phiên bản.`,
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
        message: `Thao tác ${describeCanonOp(op.op_type)} chưa gắn với cảnh cụ thể.`,
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
        message: `Thao tác ${describeCanonOp(op.op_type)} có độ tin cậy thấp (${op.confidence.toFixed(2)}) và sẽ không được chốt.`,
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
        message: `Thao tác ${describeCanonOp(op.op_type)} không khớp được nhân vật chính.`,
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
        message: 'Thao tác đổi vị trí nhân vật không khớp được địa điểm cụ thể.',
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
        message: `Thao tác ${describeCanonOp(op.op_type)} không khớp được tuyến truyện cụ thể.`,
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
        message: 'Thao tác tiết lộ bí mật không khớp được bí mật canon cụ thể.',
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
        message: 'Thao tác ghi nhận sự thật mới nhưng không có mô tả rõ ràng.',
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
          message: 'Thao tác ghi nhận sự thật mới trùng với sự thật canon đã tồn tại; hệ thống sẽ dùng lại dấu vết nhận diện hiện có.',
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
        message: `Thao tác ${describeCanonOp(op.op_type)} không khớp được vật phẩm cụ thể.`,
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
        message: `Thao tác ${describeCanonOp(op.op_type)} phải khớp được cả hai nhân vật trong cặp quan hệ.`,
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
            message: 'Thay đổi mức độ thân mật nhưng chưa ghi rõ trạng thái đồng thuận.',
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
            message: 'Quan hệ đã lộ nhưng bản nháp lại đưa về bí mật mà không có lý do rõ ràng.',
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
        && ![CANON_OP_TYPES.CHARACTER_DIED, CANON_OP_TYPES.CHARACTER_RESCUED].includes(op.op_type)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'DEAD_CHARACTER_ACTIVE',
          message: `${op.subject_name || 'Nhân vật'} đã chết nhưng vẫn phát sinh hành động ${describeCanonOp(op.op_type)}.`,
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
          message: `Tuyến truyện "${op.thread_title || 'không rõ'}" đang mở, không nên mở lại mà không có lý do rõ ràng.`,
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
          message: `Tuyến truyện "${op.thread_title || 'không rõ'}" đã đóng nhưng bản nháp vẫn đẩy tiếp.`,
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
          message: `${op.subject_name || 'Nhân vật'} đổi địa điểm từ "${state.current_location_name}" sang "${nextLocationName}" nhưng chưa có lý do rõ ràng.`,
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
      const subjectKnowledge = op.subject_id
        ? entityMap.get(op.subject_id)?.knowledge
        : null;
      const subjectAlreadyKnows = Boolean(
        subjectKnowledge
        && Object.prototype.hasOwnProperty.call(subjectKnowledge, op.fact_id)
        && subjectKnowledge[op.fact_id],
      );
      if (subjectAlreadyKnows || (!op.subject_id && fact?.revealed_at_chapter)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'SECRET_ALREADY_REVEALED',
          message: op.subject_id
            ? `${op.subject_name || 'Nhân vật'} đã biết bí mật "${fact?.description || op.fact_description || ''}" trước đó.`
            : `Bí mật "${fact.description}" đã được tiết lộ trước đó.`,
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
          message: `${op.subject_name || 'Nhân vật'} quay lại mục tiêu cũ "${conflicting.join(', ')}" mà không có giải thích rõ ràng.`,
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
          message: `${op.subject_name || 'Nhân vật'} đổi phe nhưng chưa có lý do rõ ràng trong dữ liệu canon.`,
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
          message: `Cặp quan hệ ${op.subject_name || op.subject_id}/${op.target_name || op.target_id} đảo chiều mạnh nhưng chưa có lý do rõ ràng.`,
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
          message: 'Cảnh thay đổi độ thân mật thiếu dư âm cảm xúc/hậu quả, dễ gây đứt mạch liên tục của cảnh nhạy cảm.',
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
  requireEvidenceGrounding = false,
  sceneTextById = new Map(),
  entityStates = [],
} = {}) {
  const reports = [];
  const ops = [];
  const entityStateById = new Map(entityStates.map((state) => [state.entity_id, state]));

  candidateOps.forEach((op) => {
    const invalidPayloadFields = invalidCanonPayloadFields(op);
    if (invalidPayloadFields.length > 0) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'INVALID_CANON_OP_PAYLOAD',
        message: `Thao tác ${describeCanonOp(op.op_type)} có payload sai kiểu hoặc giá trị không hợp lệ tại: ${invalidPayloadFields.join(', ')}; thao tác đã bị loại khỏi phần chốt canon.`,
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

    const confidence = clampConfidence(op.confidence);
    const hasConfidence = Number.isFinite(Number(op.confidence)) && Number(op.confidence) > 0;
    const shouldFilter = requireConfidence
      ? confidence < CANON_MIN_CONFIDENCE
      : (hasConfidence && confidence < CANON_MIN_CONFIDENCE);

    if (shouldFilter) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'LOW_CONFIDENCE_CANON_OP_FILTERED',
        message: `Thao tác ${describeCanonOp(op.op_type)} có độ tin cậy thấp (${confidence.toFixed(2)}) và đã bị loại khỏi phần chốt canon.`,
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

    if (requireEvidenceGrounding) {
      const sceneText = normalizeKey(sceneTextById.get(op.scene_id) || '');
      const evidenceText = normalizeKey(op.evidence || '');
      if (!evidenceText || !sceneText.includes(evidenceText)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'CANON_EVIDENCE_NOT_GROUNDED',
          message: `Thao tác ${describeCanonOp(op.op_type)} có bằng chứng không xuất hiện trong cảnh đã chọn và đã bị loại khỏi phần chốt canon.`,
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
      if (
        EPISTEMICALLY_RISKY_OP_TYPES.has(op.op_type)
        && hasUnnegatedUncertaintyMarker(evidenceText)
      ) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'CANON_EVIDENCE_EXPLICITLY_UNCERTAIN',
          message: `Thao tác ${describeCanonOp(op.op_type)} chỉ dựa trên tin đồn hoặc thông tin chưa được xác minh và đã bị loại khỏi phần chốt canon.`,
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
    }

    const subjectKnowledge = op.subject_id != null
      ? entityStateById.get(op.subject_id)?.knowledge
      : null;
    if (
      op.op_type === CANON_OP_TYPES.SECRET_REVEALED
      && op.fact_id != null
      && subjectKnowledge?.[op.fact_id]
    ) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'SECRET_ALREADY_REVEALED',
        message: `${op.subject_name || 'Nhân vật'} đã biết bí mật này trước đó; thao tác lặp đã bị loại khỏi phần chốt canon.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        relatedEntityIds: [op.subject_id],
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
  candidateOps = [],
}) {
  const reports = [];
  const normalizedText = normalizeKey(sceneText);
  if (!normalizedText) return reports;
  const revealedFactIds = new Set(candidateOps
    .filter((op) => op.op_type === CANON_OP_TYPES.SECRET_REVEALED && op.fact_id != null)
    .map((op) => String(op.fact_id)));
  const recoveredObjectIds = new Set(candidateOps
    .filter((op) => ITEM_RECOVERY_OP_TYPES.has(op.op_type) && op.object_id != null)
    .map((op) => String(op.object_id)));

  threadStates.forEach((threadState) => {
    if (threadState.state !== 'resolved') return;
    const threadText = normalizeKey(threadState.summary || '');
    if (threadText && normalizedText.includes(threadText)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.INFO,
        ruleCode: 'DRAFT_REFERENCES_RESOLVED_THREAD',
        message: 'Bản nháp đang gọi lại một tuyến truyện đã đóng.',
        projectId,
        chapterId,
        revisionId,
        relatedThreadIds: [threadState.thread_id],
      }));
    }
  });

  factStates.forEach((fact) => {
    if (fact.fact_type !== 'secret' || fact.revealed_at_chapter) return;
    if (fact.id != null && revealedFactIds.has(String(fact.id))) return;
    const tokens = tokenizeFactDescription(fact.description).slice(0, 5);
    if (tokens.length < 2) return;
    const hitCount = tokens.filter((token) => normalizedText.includes(token)).length;
    const requiredHitCount = tokens.length <= 4 ? tokens.length : 4;
    if (hitCount >= requiredHitCount) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_TOUCHES_HIDDEN_SECRET',
        message: `Bản nháp có dấu hiệu đụng vào bí mật chưa lộ: "${fact.description}".`,
        projectId,
        chapterId,
        revisionId,
      }));
    }
  });

  itemStates.forEach((state) => {
    if (!(state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability)))) return;
    if (state.object_id != null && recoveredObjectIds.has(String(state.object_id))) return;
    const object = objects.find((item) => item.id === state.object_id);
    if (!object?.name) return;
    const target = normalizeKey(object.name);
    const reuseContext = target ? findSpentItemReuseContext(normalizedText, target) : '';
    if (reuseContext) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_REFERENCES_SPENT_ITEM',
        message: `Bản nháp đang gọi lại vật phẩm ${object.name}, trong khi canon hiện tại ghi nhận vật phẩm này không còn dùng được.`,
        projectId,
        chapterId,
        revisionId,
        evidence: reuseContext,
      }));
    }
  });

  return reports;
}

function normalizeSceneCastIds(sceneCast = []) {
  return new Set((sceneCast || [])
    .map((item) => item?.character?.id ?? item?.id)
    .filter((id) => id != null));
}

function characterProfileText(character = {}) {
  return [
    character.name,
    character.aliases,
    character.role,
    character.appearance,
    character.personality,
    character.personality_tags,
    character.flaws,
    character.goals,
    character.secrets,
    character.notes,
    character.story_function,
    character.current_status,
    character.speech_pattern,
  ].join(' ');
}

function hasCharacterNameInText(text, character) {
  const normalizedText = normalizeKey(text);
  const names = [
    character?.name,
    ...(Array.isArray(character?.aliases) ? character.aliases : []),
    ...(typeof character?.aliases === 'string' ? [character.aliases] : []),
  ].map((item) => normalizeKey(item)).filter(Boolean);
  return names.some((name) => {
    try {
      return new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(normalizedText);
    } catch {
      return normalizedText.includes(name);
    }
  });
}

function paragraphHasDialogueForCharacter(paragraph, character) {
  const normalized = normalizeKey(paragraph);
  const names = [
    character?.name,
    ...(Array.isArray(character?.aliases) ? character.aliases : []),
    ...(typeof character?.aliases === 'string' ? [character.aliases] : []),
  ].map((item) => normalizeKey(item)).filter(Boolean);
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cue = new RegExp(`(^|\\s)${escaped}\\s+(noi|hoi|dap|thot|goi|thi tham|len tieng|la len)(?=\\s|$)`);
    const quoted = new RegExp(`(^|\\s)${escaped}(?=\\s|$).{0,40}["“”]`);
    return cue.test(normalized) || quoted.test(normalized);
  });
}

function paragraphHasActionForCharacter(paragraph, character) {
  const normalized = normalizeKey(paragraph);
  const names = [
    character?.name,
    ...(Array.isArray(character?.aliases) ? character.aliases : []),
    ...(typeof character?.aliases === 'string' ? [character.aliases] : []),
  ].map((item) => normalizeKey(item)).filter(Boolean);
  const actionWords = 'buoc|di|dung|nhin|nam|cam|keo|day|mo|dong|chay|quay|ngoi|dua|rut|gap|cuoi|khoc|run|lao|nem|dat|nhat';
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}\\s+(${actionWords})(?=\\s|$)`).test(normalized);
  });
}

function hasKnownBackstoryMarker(marker, characters = [], factStates = []) {
  const normalizedMarker = normalizeKey(marker);
  const canonText = [
    ...characters.map(characterProfileText),
    ...factStates.map((fact) => fact.description || ''),
  ].map((item) => normalizeKey(item)).join(' ');
  return canonText.includes(normalizedMarker);
}

function paragraphHasDenseDialogue(paragraph) {
  const quoteCount = (paragraph.match(/["“”]/g) || []).length;
  const speakerCueCount = (normalizeKey(paragraph).match(/\b\w+\s+(noi|hoi|dap|thot|goi|thi tham|len tieng)\b/g) || []).length;
  return quoteCount >= 4 || speakerCueCount >= 2;
}

function paragraphHasMechanicalShortSentences(paragraph) {
  const sentences = String(paragraph || '')
    .split(/[.!?。！？]+/)
    .map((sentence) => normalizeKey(sentence))
    .filter(Boolean);
  if (sentences.length < 5) return false;
  const shortCount = sentences.filter((sentence) => sentence.split(' ').filter(Boolean).length <= 4).length;
  return shortCount >= 5;
}

function isCommittedDeadCharacter(character, entityStates = []) {
  const state = entityStates.find((item) => String(item.entity_id) === String(character?.id));
  return state?.alive_status === 'dead';
}

function findCharacterLiveCanonActionConstraint(paragraphs = [], character = {}, entityStates = []) {
  const state = entityStates.find((item) => String(item.entity_id) === String(character?.id));
  const statusText = normalizeKey([
    character?.current_status,
    character?.status,
    state?.summary,
  ].join(' '));
  if (!statusText) return null;

  const leftHandRestricted = [
    'khong the dung tay trai',
    'khong duoc dung tay trai',
    'tay trai con dau',
    'tay trai bi thuong',
    'dau tay trai',
    'liet tay trai',
  ].some((marker) => statusText.includes(normalizeKey(marker)));
  if (!leftHandRestricted) return null;

  return paragraphs.find((paragraph) => {
    if (!hasCharacterNameInText(paragraph, character)) return false;
    const normalized = normalizeKey(paragraph);
    return normalized.includes('tay trai') && /(dung|nam|cam|rut|vung|danh|keo|day|mo|giu|nang)/.test(normalized);
  }) || null;
}

function extractUnknownKnowledgeConstraints(character = {}, entityStates = []) {
  const state = entityStates.find((item) => String(item.entity_id) === String(character?.id));
  const source = [
    character?.current_status,
    character?.status,
    state?.summary,
  ].join(' ');
  const constraints = [];
  const rx = /(chưa biết|chua biet|không biết|khong biet|chưa rõ|chua ro|chưa hay|chua hay)\s+([^.;|\n]+)/giu;
  let match = rx.exec(source);
  while (match) {
    const raw = cleanText(match[2] || '');
    const normalized = normalizeKey(raw);
    if (normalized.split(' ').filter(Boolean).length > 0) {
      constraints.push({ raw, normalized });
    }
    match = rx.exec(source);
  }
  return constraints;
}

function findKnowledgeContradictionParagraph(paragraphs = [], character = {}, constraints = []) {
  if (!constraints.length) return null;
  const knowledgeVerbs = /\b(biet|nhan ra|hieu|hieu ra|da ro|noi ve|ke ve|tiet lo|xac nhan)\b/;
  return paragraphs.find((paragraph) => {
    if (!hasCharacterNameInText(paragraph, character)) return false;
    const normalized = normalizeKey(paragraph);
    if (!knowledgeVerbs.test(normalized)) return false;
    return constraints.some((constraint) => {
      const tokens = constraint.normalized.split(' ').filter((token) => token.length >= 3);
      if (tokens.length === 0) return false;
      const hitCount = tokens.filter((token) => normalized.includes(token)).length;
      return hitCount >= Math.min(2, tokens.length);
    });
  }) || null;
}

export function validateGeneratedProseDiscipline({
  projectId,
  chapterId,
  revisionId = null,
  sceneId = null,
  sceneText = '',
  characters = [],
  entityStates = [],
  factStates = [],
  sceneCast = [],
  characterContextGate = null,
}) {
  const reports = [];
  const text = String(sceneText || '');
  if (!text.trim()) return reports;

  const effectiveSceneCast = Array.isArray(sceneCast) && sceneCast.length > 0
    ? sceneCast
    : (characterContextGate?.sceneCast || []);
  const sceneCastIds = normalizeSceneCastIds(effectiveSceneCast);
  const paragraphs = text.split(/\n{1,}/).map((item) => item.trim()).filter(Boolean);

  if (sceneCastIds.size > 0 && characters.length > 0) {
    characters
      .filter((character) => !sceneCastIds.has(character.id) && hasCharacterNameInText(text, character))
      .forEach((character) => {
        const dialogueParagraph = paragraphs.find((paragraph) => paragraphHasDialogueForCharacter(paragraph, character));
        if (dialogueParagraph) {
          reports.push(createReport({
            severity: CANON_SEVERITY.WARNING,
            ruleCode: 'OUT_OF_SCENE_CHARACTER_DIALOGUE',
            message: `Nhân vật ${character.name || 'ngoài cảnh'} có dấu hiệu nói thoại dù không nằm trong danh sách nhân vật của cảnh.`,
            projectId,
            chapterId,
            revisionId,
            sceneId,
            relatedEntityIds: [character.id],
            evidence: dialogueParagraph,
          }));
          return;
        }
        const actionParagraph = paragraphs.find((paragraph) => paragraphHasActionForCharacter(paragraph, character));
        if (actionParagraph) {
          reports.push(createReport({
            severity: CANON_SEVERITY.WARNING,
            ruleCode: 'OUT_OF_SCENE_CHARACTER_ACTION',
            message: `Nhân vật ${character.name || 'ngoài cảnh'} có dấu hiệu hành động trực tiếp dù không nằm trong danh sách nhân vật của cảnh.`,
            projectId,
            chapterId,
            revisionId,
            sceneId,
            relatedEntityIds: [character.id],
            evidence: actionParagraph,
          }));
        }
      });
  }

  characters
    .filter((character) => isCommittedDeadCharacter(character, entityStates) && hasCharacterNameInText(text, character))
    .forEach((character) => {
      const activeParagraph = paragraphs.find((paragraph) => (
        paragraphHasDialogueForCharacter(paragraph, character)
        || paragraphHasActionForCharacter(paragraph, character)
      ));
      if (!activeParagraph) return;
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DEAD_CHARACTER_ACTIVE',
        message: `Nhân vật ${character.name || 'không rõ'} đã chết theo canon đã duyệt nhưng có dấu hiệu xuất hiện hoặc hành động trực tiếp.`,
        projectId,
        chapterId,
        revisionId,
        sceneId,
        relatedEntityIds: [character.id],
        evidence: activeParagraph,
      }));
    });

  characters.forEach((character) => {
    const restrictedActionParagraph = findCharacterLiveCanonActionConstraint(paragraphs, character, entityStates);
    if (restrictedActionParagraph) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'LIVE_CANON_ACTION_CONSTRAINT',
        message: `Nhân vật ${character.name || 'không rõ'} đang có ràng buộc hành vi trong trạng thái hiện tại nhưng bản nháp viết như ràng buộc đó không tồn tại.`,
        projectId,
        chapterId,
        revisionId,
        sceneId,
        relatedEntityIds: [character.id],
        evidence: restrictedActionParagraph,
      }));
    }

    const knowledgeParagraph = findKnowledgeContradictionParagraph(
      paragraphs,
      character,
      extractUnknownKnowledgeConstraints(character, entityStates),
    );
    if (knowledgeParagraph) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'LIVE_CANON_KNOWLEDGE_CONSTRAINT',
        message: `Nhân vật ${character.name || 'không rõ'} có trạng thái hiện tại ghi chưa biết một bí mật/thông tin, nhưng bản nháp viết như nhân vật đã biết.`,
        projectId,
        chapterId,
        revisionId,
        sceneId,
        relatedEntityIds: [character.id],
        evidence: knowledgeParagraph,
      }));
    }
  });

  const normalizedText = normalizeKey(text);
  ['con nuôi', 'cha ruột', 'mẹ ruột', 'huyết thống', 'bị bỏ rơi', 'được nhận nuôi'].forEach((marker) => {
    if (!normalizedText.includes(normalizeKey(marker))) return;
    if (hasKnownBackstoryMarker(marker, characters, factStates)) return;
    reports.push(createReport({
      severity: CANON_SEVERITY.WARNING,
      ruleCode: 'POSSIBLE_FABRICATED_BACKSTORY',
      message: `Bản nháp có dấu hiệu thêm thân thế nhạy cảm "${marker}" nhưng chưa thấy trong hồ sơ/canon.`,
      projectId,
      chapterId,
      revisionId,
      sceneId,
      evidence: marker,
    }));
  });

  const markdownLine = text.split('\n').find((line) => /^\s*(#{1,6}\s+|[-*]\s+|\d+\.\s+)/.test(line));
  if (markdownLine) {
    reports.push(createReport({
      severity: CANON_SEVERITY.WARNING,
      ruleCode: 'PROSE_MARKDOWN_OR_OUTLINE',
      message: 'Bản nháp có dấu hiệu gạch đầu dòng/markdown/tiêu đề kỹ thuật trong phần văn xuôi.',
      projectId,
      chapterId,
      revisionId,
      sceneId,
      evidence: markdownLine,
    }));
  }

  const denseDialogue = paragraphs.find(paragraphHasDenseDialogue);
  if (denseDialogue) {
    reports.push(createReport({
      severity: CANON_SEVERITY.WARNING,
      ruleCode: 'DIALOGUE_FORMAT_DENSE',
      message: 'Một đoạn có nhiều lượt thoại dồn lại, nên tách người nói theo dòng/đoạn riêng.',
      projectId,
      chapterId,
      revisionId,
      sceneId,
      evidence: denseDialogue,
    }));
  }

  const mechanicalParagraph = paragraphs.find(paragraphHasMechanicalShortSentences);
  if (mechanicalParagraph) {
    reports.push(createReport({
      severity: CANON_SEVERITY.WARNING,
      ruleCode: 'MECHANICAL_SHORT_SENTENCES',
      message: 'Bản nháp có chuỗi câu ngắn cụt liên tiếp, dễ tạo cảm giác máy móc.',
      projectId,
      chapterId,
      revisionId,
      sceneId,
      evidence: mechanicalParagraph,
    }));
  }

  return reports;
}
