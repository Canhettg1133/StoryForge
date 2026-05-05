import {
  stripProtectedTaskInstruction,
  getTaskInstructionProtection,
} from '../ai/promptBuilder/taskInstructionProtection.js';

export const STYLE_IMPORTER_START = '[STYLE IMPORTER PATCH]';
export const STYLE_IMPORTER_END = '[/STYLE IMPORTER PATCH]';

const LIST_TARGETS = new Set(['constitution', 'style_dna', 'anti_ai_blacklist']);
const ALLOWED_TARGETS = new Set([
  'ai_guidelines',
  'constitution',
  'style_dna',
  'anti_ai_blacklist',
  'free_prompt',
  'continue',
  'scene_draft',
  'arc_chapter_draft',
  'outline',
  'arc_outline',
  'qa_check',
  'continuity_check',
  'check_conflict',
]);
const TARGET_ALIASES = {
  AI_GUIDELINES: 'ai_guidelines',
  CONSTITUTION: 'constitution',
  STYLE_DNA: 'style_dna',
  ANTI_AI_BLACKLIST: 'anti_ai_blacklist',
  FREE_PROMPT: 'free_prompt',
  CONTINUE: 'continue',
  SCENE_DRAFT: 'scene_draft',
  ARC_CHAPTER_DRAFT: 'arc_chapter_draft',
  OUTLINE: 'outline',
  ARC_OUTLINE: 'arc_outline',
  QA_CHECK: 'qa_check',
  CONTINUITY_CHECK: 'continuity_check',
  CHECK_CONFLICT: 'check_conflict',
};

function cleanText(value = '') {
  return String(value || '').trim();
}

function markerRegex() {
  return /\[STYLE IMPORTER PATCH\][\s\S]*?\[\/STYLE IMPORTER PATCH\]/u;
}

function makePatchBlock(patchText = '') {
  return `${STYLE_IMPORTER_START}\n${cleanText(patchText)}\n${STYLE_IMPORTER_END}`;
}

export function normalizeTargetPromptKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const alias = TARGET_ALIASES[raw.toUpperCase()];
  return alias || raw.toLowerCase();
}

export function isStyleImporterTargetAllowed(targetKey) {
  return ALLOWED_TARGETS.has(normalizeTargetPromptKey(targetKey));
}

export function applyStyleImporterPatchBlock(existing = '', patchText = '') {
  const base = String(existing || '').trim();
  const block = makePatchBlock(patchText);
  if (!base) return block;
  if (markerRegex().test(base)) {
    return base.replace(markerRegex(), block).trim();
  }
  return `${base}\n\n${block}`.trim();
}

function extractTemplateVariables(value = '') {
  return [...new Set(String(value || '').match(/\{\{\s*[\w.-]+\s*\}\}/gu) || [])].sort();
}

export function validatePromptPatchSafety({ before = '', after = '', targetKey = '' } = {}) {
  const beforeVariables = extractTemplateVariables(before);
  const afterVariables = extractTemplateVariables(after);
  const missingVariables = beforeVariables.filter((variable) => !afterVariables.includes(variable));
  if (missingVariables.length > 0) {
    return {
      ok: false,
      code: 'MISSING_TEMPLATE_VARIABLES',
      message: 'Patch làm mất biến template.',
      missingVariables,
    };
  }

  const protection = getTaskInstructionProtection(normalizeTargetPromptKey(targetKey));
  if (protection?.marker && String(after || '').includes(protection.marker)) {
    return {
      ok: false,
      code: 'LOCKED_CONTRACT_TOUCHED',
      message: 'Patch chạm vào JSON contract locked.',
    };
  }

  if (!cleanText(after)) {
    return {
      ok: false,
      code: 'EMPTY_PROMPT',
      message: 'Patch tạo prompt rỗng.',
    };
  }

  return { ok: true, code: 'OK', message: 'Patch hợp lệ.' };
}

function splitListText(value = '') {
  return String(value || '')
    .split('\n')
    .map((line) => cleanListEntry(line))
    .filter(Boolean);
}

function cleanListEntry(value = '') {
  return cleanText(value)
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/u, '')
    .replace(/^\s*,\s*/u, '')
    .replace(/^["'“”`]+/u, '')
    .replace(/["'“”`,]+$/u, '')
    .trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanListEntry(item)).filter(Boolean);
  return splitListText(value);
}

function applyListPatch(existingValue, patch) {
  const list = normalizeList(existingValue);
  const additions = splitListText(patch.after);
  if (additions.length === 0) return list;

  if (patch.operation === 'replace_sentence' && patch.before) {
    const index = list.findIndex((item) => item === cleanText(patch.before));
    if (index >= 0) {
      const next = [...list];
      next.splice(index, 1, ...additions);
      return [...new Set(next)];
    }
  }

  if (patch.operation === 'insert_after' && patch.anchor) {
    const index = list.findIndex((item) => item.includes(cleanText(patch.anchor)));
    if (index >= 0) {
      const next = [...list];
      next.splice(index + 1, 0, ...additions);
      return [...new Set(next)];
    }
  }

  return [...new Set([...list, ...additions])];
}

function applyTextOperation(existing = '', patch = {}) {
  const base = String(existing || '').trim();
  const after = cleanText(patch.after);

  if (patch.operation === 'replace_sentence' && patch.before) {
    const before = String(patch.before || '');
    if (before && base.includes(before)) {
      return base.replace(before, after).trim();
    }
  }

  if (patch.operation === 'insert_after' && patch.anchor) {
    if (markerRegex().test(base)) return applyStyleImporterPatchBlock(base, after);

    const anchor = String(patch.anchor || '');
    const anchorIndex = base.indexOf(anchor);
    if (anchorIndex >= 0) {
      const insertAt = anchorIndex + anchor.length;
      return `${base.slice(0, insertAt)}\n\n${makePatchBlock(after)}${base.slice(insertAt)}`.trim();
    }
  }

  return applyStyleImporterPatchBlock(base, after);
}

function patchIdFor(patch, index) {
  return `${patch.target_prompt}:${index}`;
}

export function applyStyleImporterPatches({
  currentPromptTemplates = {},
  basePromptTemplates = {},
  currentAiGuidelines = '',
  patches = [],
  selectedPatchIds = null,
} = {}) {
  const promptTemplates = {
    ...(currentPromptTemplates && typeof currentPromptTemplates === 'object' ? currentPromptTemplates : {}),
  };
  let aiGuidelines = String(currentAiGuidelines || '');
  const applied = [];
  const rejected = [];

  patches.forEach((patch, index) => {
    const rawTarget = patch?.target_prompt || patch?.targetPrompt || patch?.target || '';
    const id = patchIdFor({ target_prompt: rawTarget }, index);
    if (selectedPatchIds && !selectedPatchIds.has(id)) return;

    const targetKey = normalizeTargetPromptKey(rawTarget);
    if (!ALLOWED_TARGETS.has(targetKey)) {
      rejected.push({ id, targetKey, reason: 'Target không được phép patch.' });
      return;
    }

    const normalizedPatch = {
      ...patch,
      operation: ['append', 'insert_after', 'replace_sentence'].includes(patch?.operation)
        ? patch.operation
        : 'append',
      after: cleanText(patch?.after),
    };
    if (!normalizedPatch.after) {
      rejected.push({ id, targetKey, reason: 'Patch không có nội dung after.' });
      return;
    }

    if (LIST_TARGETS.has(targetKey)) {
      const existingList = Object.prototype.hasOwnProperty.call(promptTemplates, targetKey)
        ? promptTemplates[targetKey]
        : basePromptTemplates[targetKey];
      promptTemplates[targetKey] = applyListPatch(existingList, normalizedPatch);
      applied.push({ id, targetKey, operation: normalizedPatch.operation });
      return;
    }

    const before = targetKey === 'ai_guidelines'
      ? aiGuidelines
      : String(Object.prototype.hasOwnProperty.call(promptTemplates, targetKey)
        ? promptTemplates[targetKey] || ''
        : basePromptTemplates[targetKey] || '');
    const patched = applyTextOperation(before, normalizedPatch);
    const editablePatched = targetKey === 'ai_guidelines'
      ? patched
      : stripProtectedTaskInstruction(targetKey, patched);
    const safety = validatePromptPatchSafety({
      before,
      after: editablePatched,
      targetKey,
    });

    if (!safety.ok) {
      rejected.push({ id, targetKey, reason: safety.message, safety });
      return;
    }

    if (targetKey === 'ai_guidelines') {
      aiGuidelines = editablePatched;
    } else {
      promptTemplates[targetKey] = editablePatched;
    }
    applied.push({ id, targetKey, operation: normalizedPatch.operation });
  });

  return {
    promptTemplates,
    aiGuidelines: aiGuidelines.trim(),
    applied,
    rejected,
  };
}
