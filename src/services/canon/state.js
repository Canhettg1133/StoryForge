import { CANON_OP_TYPES } from './constants';
import {
  buildCanonFactFingerprint,
  normalizeCanonFactRecord,
  resolveCanonFactRegistration,
} from '../entityIdentity/factIdentity.js';
import {
  cleanText,
  normalizeKey,
  normalizePayload,
  splitGoals,
  uniqueList,
  uniqueSummaryParts,
} from './utils';

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

export function isLivenessSummaryChunk(value, aliveStatus) {
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

export function buildRelationshipPairKey(characterAId, characterBId) {
  const a = Number(characterAId) || characterAId;
  const b = Number(characterBId) || characterBId;
  return [a, b].sort((left, right) => Number(left) - Number(right)).join(':');
}

export const ITEM_CATEGORIES = {
  UNIQUE: 'unique',
  STACK: 'stack',
  CONSUMABLE: 'consumable',
  CURRENCY: 'currency',
  RESOURCE: 'resource',
  EQUIPMENT: 'equipment',
  CONTAINER: 'container',
  QUEST_ITEM: 'quest_item',
};

const ITEM_CATEGORY_SET = new Set(Object.values(ITEM_CATEGORIES));

export function normalizeItemCategory(value = '') {
  const normalized = normalizeKey(value).replace(/\s+/g, '_');
  return ITEM_CATEGORY_SET.has(normalized) ? normalized : '';
}

function toOptionalNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveItemQuantity(payload, key, fallback = null) {
  return toOptionalNumber(payload[key] ?? payload[key.replace('quantity_', '')] ?? fallback);
}

export function createInitialItemState(object = {}) {
  const category = normalizeItemCategory(object.item_category || object.item_type || object.object_type);
  const quantityRemaining = toOptionalNumber(object.quantity_remaining ?? object.quantity);
  const quantityTotal = toOptionalNumber(object.quantity_total ?? object.quantity);
  const ownerId = object.owner_character_id || null;
  return {
    project_id: object.project_id,
    object_id: object.id,
    item_category: category || '',
    availability: 'available',
    owner_character_id: ownerId,
    holder_character_id: object.holder_character_id || ownerId,
    current_location_id: null,
    current_location_name: '',
    quantity_remaining: quantityRemaining,
    quantity_total: quantityTotal,
    quantity_unit: cleanText(object.quantity_unit || object.unit || ''),
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
  const itemCategory = normalizeItemCategory(payload.item_category || payload.item_type || payload.object_type);
  const quantityDelta = resolveItemQuantity(payload, 'quantity_delta', payload.quantity ?? payload.amount);
  const quantityRemaining = resolveItemQuantity(payload, 'quantity_remaining');
  const quantityTotal = resolveItemQuantity(payload, 'quantity_total');
  const quantityUnit = cleanText(payload.quantity_unit || payload.unit || '');
  const transferKind = normalizeKey(payload.transfer_kind || payload.transfer_mode || payload.transfer_type || '');

  if (itemCategory) next.item_category = itemCategory;
  if (quantityUnit) next.quantity_unit = quantityUnit;
  if (quantityTotal != null) next.quantity_total = quantityTotal;

  const setAvailable = () => {
    next.availability = cleanText(payload.availability || 'available') || 'available';
    next.is_consumed = Boolean(payload.is_consumed ?? false);
  };

  const applyQuantityGain = () => {
    if (quantityRemaining != null) {
      next.quantity_remaining = quantityRemaining;
    } else if (quantityDelta != null && next.quantity_remaining != null) {
      next.quantity_remaining = Math.max(0, Number(next.quantity_remaining) + quantityDelta);
    } else if (quantityDelta != null) {
      next.quantity_remaining = quantityDelta;
    }
  };

  const applyQuantityLoss = (consumeAll = false) => {
    if (quantityRemaining != null) {
      next.quantity_remaining = quantityRemaining;
    } else if (consumeAll) {
      next.quantity_remaining = 0;
    } else if (quantityDelta != null && next.quantity_remaining != null) {
      next.quantity_remaining = Math.max(0, Number(next.quantity_remaining) - Math.abs(quantityDelta));
    }

    if (next.quantity_remaining != null) {
      next.is_consumed = Number(next.quantity_remaining) <= 0;
      next.availability = next.is_consumed ? 'consumed' : 'available';
    }
  };

  const resolveRecipientCharacterId = () => (
    payload.target_character_id
    || payload.receiver_character_id
    || payload.recipient_character_id
    || payload.owner_character_id
    || payload.holder_character_id
    || event.target_id
    || event.subject_id
    || null
  );

  const isTemporaryTransfer = () => [
    'lend',
    'loan',
    'borrow',
    'temporary',
    'custody',
    'store',
    'stored',
    'entrust',
  ].includes(transferKind);

  switch (event.op_type) {
    case CANON_OP_TYPES.OBJECT_ACQUIRED:
      setAvailable();
      applyQuantityGain();
      next.owner_character_id = resolveRecipientCharacterId() || next.owner_character_id || null;
      next.holder_character_id = payload.holder_character_id || resolveRecipientCharacterId() || next.owner_character_id || null;
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || 'Da co duoc vat pham');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_STATUS_CHANGED:
      next.availability = cleanText(payload.availability || next.availability || 'available') || 'available';
      next.is_damaged = Boolean(payload.is_damaged ?? next.is_damaged);
      next.is_consumed = Boolean(payload.is_consumed ?? next.is_consumed);
      if (quantityRemaining != null) next.quantity_remaining = quantityRemaining;
      next.current_location_id = payload.location_id || next.current_location_id || null;
      next.current_location_name = cleanText(payload.location_name || next.current_location_name || '');
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_TRANSFERRED:
      if (!isTemporaryTransfer()) {
        next.owner_character_id = resolveRecipientCharacterId() || next.owner_character_id || null;
      } else if (payload.owner_character_id) {
        next.owner_character_id = payload.owner_character_id;
      }
      next.holder_character_id = payload.holder_character_id || resolveRecipientCharacterId() || next.holder_character_id || null;
      next.availability = cleanText(payload.availability || next.availability || 'available') || 'available';
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      break;
    case CANON_OP_TYPES.OBJECT_CONSUMED:
      applyQuantityLoss(true);
      next.availability = cleanText(payload.availability || next.availability || 'consumed') || 'consumed';
      next.is_consumed = true;
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc su dung het');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED:
    case CANON_OP_TYPES.OBJECT_SPENT:
      applyQuantityLoss(false);
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || 'Da duoc su dung mot phan');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_LOST:
      next.availability = cleanText(payload.availability || 'lost') || 'lost';
      next.holder_character_id = null;
      next.current_location_id = payload.location_id || null;
      next.current_location_name = cleanText(payload.location_name || '');
      next.summary = cleanText(payload.status_summary || event.summary || 'Da bi mat');
      break;
    case CANON_OP_TYPES.OBJECT_FOUND:
      setAvailable();
      applyQuantityGain();
      next.holder_character_id = event.subject_id || event.target_id || payload.holder_character_id || next.holder_character_id || null;
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc tim thay');
      break;
    case CANON_OP_TYPES.OBJECT_RESTORED:
      setAvailable();
      next.is_damaged = Boolean(payload.is_damaged ?? false);
      applyQuantityGain();
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc khoi phuc');
      next.usage_notes = cleanText(payload.usage_notes || next.usage_notes || '');
      break;
    case CANON_OP_TYPES.OBJECT_RETURNED:
      setAvailable();
      next.holder_character_id = payload.return_to_character_id || payload.holder_character_id || event.target_id || next.owner_character_id || null;
      if (payload.owner_character_id) {
        next.owner_character_id = payload.owner_character_id;
      } else if (!next.owner_character_id) {
        next.owner_character_id = payload.return_to_character_id || event.target_id || null;
      }
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc tra lai');
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

export function applyEventToFactStates(prevFactStates, event, chapterOrder) {
  const facts = prevFactStates.map((fact) => ({
    ...fact,
    ...normalizeCanonFactRecord(fact),
  }));
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
    const candidate = {
      id: event.fact_id || `event:${event.id || `${event.chapter_id}:${facts.length}`}`,
      description: cleanText(event.fact_description || payload.description || event.summary || ''),
      fact_type: cleanText(payload.fact_type || 'fact') || 'fact',
      subject_type: cleanText(payload.subject_type || event.subject_type || ''),
      subject_id: event.subject_id ?? payload.subject_id ?? null,
      subject_name: cleanText(payload.subject_name || event.subject_name || ''),
      status: 'active',
      source_chapter_id: event.chapter_id,
      revealed_at_chapter: payload.fact_type === 'secret' ? null : chapterOrder + 1,
    };
    const resolved = resolveCanonFactRegistration(candidate, facts);
    const existingIndex = facts.findIndex((fact) => {
      return buildCanonFactFingerprint(fact) === resolved.fact_fingerprint
        || fact.id === event.fact_id;
    });
    if (existingIndex >= 0) {
      facts[existingIndex] = {
        ...facts[existingIndex],
        ...candidate,
        ...resolved,
        id: facts[existingIndex].id,
      };
    } else {
      facts.push({
        ...candidate,
        ...resolved,
      });
    }
  }

  return facts;
}
