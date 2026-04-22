import { TASK_TYPES } from '../router';
import { TASK_INSTRUCTIONS } from './taskInstructions';

const TASK_INSTRUCTION_PROTECTION_MARKERS = {
  [TASK_TYPES.CHECK_CONFLICT]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.CONTINUITY_CHECK]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.OUTLINE]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.FEEDBACK_EXTRACT]: 'Tra ve CHINH XAC format nay:',
  [TASK_TYPES.STYLE_ANALYZE]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.QA_CHECK]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.AI_GENERATE_ENTITY]: 'Tra ve CHINH XAC JSON theo schema duoc chi ro trong user prompt. Khong them bat ky text nao ngoai JSON.',
  [TASK_TYPES.SUGGEST_UPDATES]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.CANON_EXTRACT_OPS]: 'Tra ve CHINH XAC JSON format:',
  [TASK_TYPES.ARC_OUTLINE]: 'Tra ve CHINH XAC JSON format:',
  [TASK_TYPES.GENERATE_MACRO_MILESTONES]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.ANALYZE_MACRO_CONTRACT]: 'Tra ve CHINH XAC JSON format sau:',
  [TASK_TYPES.AUDIT_ARC_ALIGNMENT]: 'Tra ve CHINH XAC JSON format sau:',
};

function getTaskInstructionProtectionMarker(taskType) {
  return TASK_INSTRUCTION_PROTECTION_MARKERS[taskType] || '';
}

export function getTaskInstructionProtection(taskType) {
  const marker = getTaskInstructionProtectionMarker(taskType);
  const defaultInstruction = String(TASK_INSTRUCTIONS[taskType] || '');
  if (!marker || !defaultInstruction) return null;

  const markerIndex = defaultInstruction.indexOf(marker);
  if (markerIndex < 0) return null;

  return {
    marker,
    lockedPrompt: defaultInstruction.slice(markerIndex).trim(),
    label: 'JSON contract duoc khoa',
    description: 'Phan schema/output JSON nay duoc app giu bat bien de tranh vo parser.',
  };
}

export function stripProtectedTaskInstruction(taskType, value) {
  const raw = String(value || '').trim();
  const protection = getTaskInstructionProtection(taskType);
  if (!protection || !raw) return raw;

  const markerIndex = raw.indexOf(protection.marker);
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
