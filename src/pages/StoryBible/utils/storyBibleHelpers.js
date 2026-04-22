import {
  buildMacroArcPersistenceSnapshot,
  parseStoredMacroArcContract,
  validateMacroArcChapterAnchors,
} from '../../../services/ai/macroArcContract';

export function getSuggestedMacroMilestoneCount(targetLength) {
  const length = Number(targetLength) || 0;
  if (length >= 1200) return 10;
  if (length >= 800) return 8;
  if (length >= 400) return 6;
  if (length >= 150) return 5;
  if (length >= 60) return 4;
  return 3;
}

export function deriveMacroArcContractJson(macroArc = {}) {
  const snapshot = buildMacroArcPersistenceSnapshot(macroArc);
  return snapshot?.contract_json || '';
}

export function getMacroArcAnchorIssues(macroArc = {}) {
  return validateMacroArcChapterAnchors(macroArc);
}

export function buildMacroArcEditorSnapshot(macroArc = {}, options = {}) {
  const snapshot = buildMacroArcPersistenceSnapshot(macroArc, options);
  if (!snapshot) return null;
  const { contract, ...rest } = snapshot;
  return rest;
}

export function buildMacroArcDbPayload(macroArc = {}, options = {}) {
  const snapshot = buildMacroArcPersistenceSnapshot(macroArc, options);
  if (!snapshot) return null;
  return {
    title: snapshot.title || '',
    description: snapshot.description || '',
    chapter_from: snapshot.chapter_from || 0,
    chapter_to: snapshot.chapter_to || 0,
    emotional_peak: snapshot.emotional_peak || '',
    chapter_anchors: snapshot.chapter_anchors || [],
    contract_json: snapshot.contract_json || '',
  };
}

export function uniqueValues(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function shallowEqualObject(a = {}, b = {}) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function syncDraftMap(previousDrafts = {}, items = [], buildDraft) {
  const nextDrafts = {};
  for (const item of items) {
    const nextDraft = buildDraft(item);
    const previousDraft = previousDrafts[item.id];
    nextDrafts[item.id] = previousDraft && shallowEqualObject(previousDraft, nextDraft)
      ? previousDraft
      : nextDraft;
  }
  return nextDrafts;
}

export function getSelectOptionsWithFallback(options = [], value = '', fallbackLabelPrefix = 'Khác') {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return options;
  if (options.some((item) => item.value === normalizedValue)) {
    return options;
  }
  return [
    { value: normalizedValue, label: `${fallbackLabelPrefix}: ${normalizedValue}` },
    ...options,
  ];
}

export function buildDisplayMacroArcContract(macroArc = {}, allCharacters = []) {
  const stored = parseStoredMacroArcContract(macroArc, { allCharacters });
  const objectives = stored?.objectives || [];
  const targetStates = stored?.targetStates || [];
  const forbiddenOutcomes = stored?.forbiddenOutcomes || [];
  const focusedCharacters = uniqueValues(stored?.focusedCharacters || []);

  return {
    title: String(macroArc.title || stored?.title || '').trim(),
    chapterFrom: Number(macroArc.chapter_from) || stored?.chapterFrom || 0,
    chapterTo: Number(macroArc.chapter_to) || stored?.chapterTo || 0,
    emotionalPeak: String(macroArc.emotional_peak || stored?.emotionalPeak || '').trim(),
    narrativeSummary: String(stored?.narrativeSummary || '').trim(),
    objectives,
    targetStates,
    focusedCharacters,
    forbiddenOutcomes,
    maxRelationshipStage: Number(stored?.maxRelationshipStage) || 0,
    chapterAnchors: stored?.chapterAnchors || [],
    hasStructuredSource: Boolean(stored),
  };
}

export function getRelationshipStageLabel(stage = 0) {
  if (stage >= 3) return 'Trần mức payoff';
  if (stage === 2) return 'Mức gần gũi / rung động';
  if (stage === 1) return 'Mức gieo mầm / buildup';
  return 'Chưa khóa trần quan hệ';
}
