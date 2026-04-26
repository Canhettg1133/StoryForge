import { normalizeCanonPack } from './canonPackSchema.js';

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function stableId(parts = []) {
  return parts
    .map((part) => clean(part).toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .filter(Boolean)
    .join('_')
    .replace(/^_+|_+$/g, '');
}

function actionRecord({ type, action, source, existing = null, reason = '', path = '' }) {
  return {
    id: stableId(['merge', type, action, source?.name || source?.description || source?.title || source, path || Math.random().toString(36).slice(2)]),
    type,
    action,
    source,
    existing,
    reason,
    path,
  };
}

function sameMeaning(a, b) {
  return normalizeKey(typeof a === 'string' ? a : JSON.stringify(a))
    === normalizeKey(typeof b === 'string' ? b : JSON.stringify(b));
}

function mergeTextList(base = [], incoming = []) {
  const next = [...asArray(base)];
  for (const item of asArray(incoming)) {
    if (!next.some((existing) => sameMeaning(existing, item))) {
      next.push(item);
    }
  }
  return next;
}

function mergeCharacter(existing = {}, incoming = {}) {
  return {
    ...existing,
    aliases: mergeTextList(existing.aliases, incoming.aliases),
    evidence: mergeTextList(existing.evidence, incoming.evidence),
    role: existing.role || incoming.role || '',
    status: existing.status || incoming.status || '',
    personality: existing.personality || incoming.personality || '',
    goals: existing.goals || incoming.goals || '',
    voice: existing.voice || incoming.voice || '',
  };
}

export function buildCanonPackMergePlan({ basePack = {}, incomingPack = {}, ingestBatch = {} } = {}) {
  const actions = [];
  const baseCharacters = new Map(asArray(basePack.characterCanon).map((character) => [normalizeKey(character.name), character]));

  for (const character of asArray(incomingPack.characterCanon)) {
    const name = clean(character.name);
    if (!name) continue;
    const existing = baseCharacters.get(normalizeKey(name));
    if (!existing) {
      actions.push(actionRecord({
        type: 'character',
        action: 'create',
        source: character,
        reason: 'Nhân vật mới từ lượt nạp thêm.',
        path: 'characterCanon',
      }));
      continue;
    }

    const existingStatus = clean(existing.status || existing.current_status);
    const incomingStatus = clean(character.status || character.current_status);
    const conflict = existingStatus && incomingStatus && normalizeKey(existingStatus) !== normalizeKey(incomingStatus);
    actions.push(actionRecord({
      type: 'character',
      action: conflict ? 'conflict' : 'update',
      source: character,
      existing,
      reason: conflict ? 'Trùng nhân vật nhưng trạng thái khác nhau, cần duyệt tay.' : 'Bổ sung alias/evidence cho nhân vật đã có.',
      path: 'characterCanon',
    }));
  }

  const textGroups = [
    ['canon_restriction', 'canonRestrictions'],
    ['creative_gap', 'creativeGaps'],
    ['chapter_canon', 'chapterCanon'],
    ['relationship', 'relationshipCanon'],
  ];

  for (const [type, path] of textGroups) {
    for (const item of asArray(incomingPack[path])) {
      const duplicate = asArray(basePack[path]).some((existing) => sameMeaning(existing, item));
      actions.push(actionRecord({
        type,
        action: duplicate ? 'skip' : 'create',
        source: item,
        reason: duplicate ? 'Mục tương tự đã có trong Canon Pack.' : 'Mục mới từ lượt nạp thêm.',
        path,
      }));
    }
  }

  for (const note of asArray(incomingPack.adultCanon?.notes)) {
    const duplicate = asArray(basePack.adultCanon?.notes).some((existing) => sameMeaning(existing, note));
    actions.push(actionRecord({
      type: 'adult_canon',
      action: duplicate ? 'skip' : 'create',
      source: note,
      reason: duplicate ? 'Adult Canon tương tự đã có.' : 'Adult Canon mới từ lượt nạp thêm.',
      path: 'adultCanon.notes',
    }));
  }

  const summary = actions.reduce((acc, action) => {
    acc[action.action] = (acc[action.action] || 0) + 1;
    return acc;
  }, { create: 0, update: 0, conflict: 0, skip: 0 });

  return {
    id: stableId(['merge_plan', basePack.id || 'base', ingestBatch.id || incomingPack.id || Date.now()]),
    canonPackId: basePack.id || null,
    ingestBatchId: ingestBatch.id || null,
    status: 'draft',
    actions,
    summary,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function applyCanonPackMergePlan({ basePack = {}, mergePlan = {}, selectedActionIds = [] } = {}) {
  const selected = new Set(selectedActionIds);
  const next = normalizeCanonPack({
    ...basePack,
    characterCanon: [...asArray(basePack.characterCanon)],
    relationshipCanon: [...asArray(basePack.relationshipCanon)],
    chapterCanon: [...asArray(basePack.chapterCanon)],
    canonRestrictions: [...asArray(basePack.canonRestrictions)],
    creativeGaps: [...asArray(basePack.creativeGaps)],
    adultCanon: {
      ...(basePack.adultCanon || {}),
      notes: [...asArray(basePack.adultCanon?.notes)],
    },
    metadata: {
      ...(basePack.metadata || {}),
      sourceBatches: [...asArray(basePack.metadata?.sourceBatches)],
    },
  });

  for (const action of asArray(mergePlan.actions)) {
    if (!selected.has(action.id)) continue;
    if (!['create', 'update'].includes(action.action)) continue;

    if (action.path === 'characterCanon') {
      const key = normalizeKey(action.source?.name);
      const existingIndex = next.characterCanon.findIndex((character) => normalizeKey(character.name) === key);
      if (existingIndex >= 0) {
        next.characterCanon[existingIndex] = mergeCharacter(next.characterCanon[existingIndex], action.source);
      } else {
        next.characterCanon.push(action.source);
      }
    } else if (action.path === 'adultCanon.notes') {
      next.adultCanon = {
        ...(next.adultCanon || {}),
        enabled: true,
        detailsHidden: next.adultCanon?.detailsHidden !== false,
        notes: mergeTextList(next.adultCanon?.notes, [action.source]),
      };
    } else if (action.path && Array.isArray(next[action.path])) {
      next[action.path] = mergeTextList(next[action.path], [action.source]);
    }
  }

  if (mergePlan.ingestBatchId && !next.metadata.sourceBatches.includes(mergePlan.ingestBatchId)) {
    next.metadata.sourceBatches.push(mergePlan.ingestBatchId);
  }
  next.metadata.updatedAt = Date.now();
  return normalizeCanonPack(next);
}
