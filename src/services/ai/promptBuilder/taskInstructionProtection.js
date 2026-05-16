import { TASK_TYPES } from '../router';
import { TASK_INSTRUCTIONS } from './taskInstructions';

const TASK_INSTRUCTION_PROTECTION_MARKERS = {
  [TASK_TYPES.CHECK_CONFLICT]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.CONTINUITY_CHECK]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.OUTLINE]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.FEEDBACK_EXTRACT]: 'Trả về CHÍNH XÁC format này:',
  [TASK_TYPES.STYLE_ANALYZE]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.QA_CHECK]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.AI_GENERATE_ENTITY]: 'Trả về CHÍNH XÁC JSON theo schema được chỉ rõ trong user prompt. Không thêm bất kỳ text nào ngoài JSON.',
  [TASK_TYPES.SUGGEST_UPDATES]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.CANON_EXTRACT_OPS]: 'Trả về CHÍNH XÁC JSON format:',
  [TASK_TYPES.ARC_OUTLINE]: 'Trả về CHÍNH XÁC JSON format:',
  [TASK_TYPES.GENERATE_MACRO_MILESTONES]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.ANALYZE_MACRO_CONTRACT]: 'Trả về CHÍNH XÁC JSON format sau:',
  [TASK_TYPES.AUDIT_ARC_ALIGNMENT]: 'Trả về CHÍNH XÁC JSON format sau:',
};

const TASK_INSTRUCTION_LEGACY_PROTECTION_MARKERS = {
  [TASK_TYPES.CHECK_CONFLICT]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.CONTINUITY_CHECK]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.OUTLINE]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.FEEDBACK_EXTRACT]: ['Tra ve CHINH XAC format nay:'],
  [TASK_TYPES.STYLE_ANALYZE]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.QA_CHECK]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.AI_GENERATE_ENTITY]: ['Tra ve CHINH XAC JSON theo schema duoc chi ro trong user prompt. Khong them bat ky text nao ngoai JSON.'],
  [TASK_TYPES.SUGGEST_UPDATES]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.CANON_EXTRACT_OPS]: ['Tra ve CHINH XAC JSON format:'],
  [TASK_TYPES.ARC_OUTLINE]: ['Tra ve CHINH XAC JSON format:'],
  [TASK_TYPES.GENERATE_MACRO_MILESTONES]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.ANALYZE_MACRO_CONTRACT]: ['Tra ve CHINH XAC JSON format sau:'],
  [TASK_TYPES.AUDIT_ARC_ALIGNMENT]: ['Tra ve CHINH XAC JSON format sau:'],
};

function getTaskInstructionProtectionMarker(taskType) {
  return TASK_INSTRUCTION_PROTECTION_MARKERS[taskType] || '';
}

function getTaskInstructionProtectionMarkers(taskType) {
  return [
    getTaskInstructionProtectionMarker(taskType),
    ...(TASK_INSTRUCTION_LEGACY_PROTECTION_MARKERS[taskType] || []),
  ].filter(Boolean);
}

export function getTaskInstructionProtection(taskType) {
  const marker = getTaskInstructionProtectionMarker(taskType);
  const defaultInstruction = String(TASK_INSTRUCTIONS[taskType] || '');
  if (!marker || !defaultInstruction) return null;

  const markerIndex = defaultInstruction.indexOf(marker);
  if (markerIndex < 0) return null;

  return {
    marker,
    legacyMarkers: TASK_INSTRUCTION_LEGACY_PROTECTION_MARKERS[taskType] || [],
    lockedPrompt: defaultInstruction.slice(markerIndex).trim(),
    label: 'JSON contract được khóa',
    description: 'Phần schema/output JSON này được app giữ bất biến để tránh vỡ parser.',
  };
}

export function stripProtectedTaskInstruction(taskType, value) {
  const raw = String(value || '').trim();
  const protection = getTaskInstructionProtection(taskType);
  if (!protection || !raw) return raw;

  const markerIndex = getTaskInstructionProtectionMarkers(taskType)
    .map((marker) => raw.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (markerIndex >= 0) {
    return raw.slice(0, markerIndex).trimEnd();
  }

  if (protection.lockedPrompt && raw.endsWith(protection.lockedPrompt)) {
    return raw.slice(0, raw.length - protection.lockedPrompt.length).trimEnd();
  }

  return raw;
}

export function composeTaskInstruction(taskType, editableInstruction) {
  const editable = stripProtectedTaskInstruction(taskType, editableInstruction);
  const protection = getTaskInstructionProtection(taskType);
  if (!protection?.lockedPrompt) {
    return editable;
  }

  return [editable, protection.lockedPrompt]
    .filter(Boolean)
    .join('\n\n');
}
