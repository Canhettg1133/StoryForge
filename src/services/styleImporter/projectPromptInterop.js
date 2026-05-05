import {
  DEFAULT_NSFW_INTIMATE_PROMPT,
  DEFAULT_NSFW_RULES,
  TASK_INSTRUCTIONS,
  stripProtectedTaskInstruction,
} from '../ai/promptBuilder.js';
import { TASK_TYPES } from '../ai/router.js';
import { PROJECT_PROMPT_GROUPS } from '../ai/promptManagerMeta.js';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates.js';
import { normalizeTargetPromptKey } from './patchApplier.js';

export const STYLE_IMPORTER_ALLOWED_TARGETS = [
  'ai_guidelines',
  'constitution',
  'style_dna',
  'anti_ai_blacklist',
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.OUTLINE,
  TASK_TYPES.ARC_OUTLINE,
  TASK_TYPES.QA_CHECK,
  TASK_TYPES.CONTINUITY_CHECK,
  TASK_TYPES.CHECK_CONFLICT,
];

const TARGET_PATCH_GUIDANCE = {
  ai_guidelines: {
    patch_priority: 'required',
    patch_role: 'Bản tóm tắt định hướng ngắn cho project, được inject sớm trước task instruction.',
    patch_constraints: 'Chỉ tóm tắt phong cách và nguyên tắc dùng lại; không nhồi toàn bộ Style DNA, không copy canon/tên riêng từ tác phẩm mẫu.',
  },
  constitution: {
    patch_priority: 'recommended',
    patch_role: 'Luật cứng xuyên suốt của truyện hiện tại.',
    patch_constraints: 'Chỉ thêm rule bắt buộc như POV đã khóa, tính cách không lệch, hệ thống/tài nguyên/timeline nhất quán nếu đã là canon project; không biến canon mẫu thành canon project.',
  },
  style_dna: {
    patch_priority: 'required',
    patch_role: 'Nơi chính để lưu quy tắc văn phong, POV, nhịp câu, thoại, nội tâm, scene grammar, mở/kết chương và pacing theo loại cảnh.',
    patch_constraints: 'Bắt buộc ưu tiên target này khi Style Pack có dữ liệu văn phong; viết thành các rule ngắn, tái sử dụng được, không sao chép văn bản mẫu.',
  },
  anti_ai_blacklist: {
    patch_priority: 'optional',
    patch_role: 'Danh sách từ/cụm từ cụ thể cần tránh trong output.',
    patch_constraints: 'Chỉ patch khi Style Pack rút ra được từ/cụm từ cấm thật sự; không đưa các hành vi viết sai chung chung vào blacklist.',
  },
  free_prompt: {
    patch_priority: 'required',
    patch_role: 'Prompt cho ô nhập yêu cầu tự do trong truyện; đây là luồng viết/chỉnh tự do quan trọng của project.',
    patch_constraints: 'Chỉ thêm bridge ngắn buộc đọc ai_guidelines, constitution và style_dna trước khi viết/chỉnh; không nhồi lại toàn bộ Style DNA.',
  },
  continue: {
    patch_priority: 'bridge_only',
    patch_role: 'Prompt viết tiếp trực tiếp từ đoạn đang dở.',
    patch_constraints: 'Chỉ thêm bridge ngắn; không lặp lại toàn bộ Style DNA vốn phải nằm trong style_dna.',
  },
  scene_draft: {
    patch_priority: 'bridge_only',
    patch_role: 'Prompt viết nháp một cảnh cụ thể.',
    patch_constraints: 'Chỉ thêm bridge ngắn về việc áp dụng style_dna/constitution/ai_guidelines và pacing theo loại cảnh.',
  },
  arc_chapter_draft: {
    patch_priority: 'bridge_only',
    patch_role: 'Prompt viết trọn một chương theo arc.',
    patch_constraints: 'Chỉ thêm bridge ngắn về style_dna, cấu trúc chương và không vượt outline/arc.',
  },
  outline: {
    patch_priority: 'recommended',
    patch_role: 'Prompt lập dàn ý chương hiện tại.',
    patch_constraints: 'Patch pacing, cấu trúc beat, mở/kết chương, hook/cliffhanger và vòng lặp chương; không đưa văn prose dài vào đây.',
  },
  arc_outline: {
    patch_priority: 'recommended',
    patch_role: 'Prompt lập kế hoạch nhiều chương trong một arc.',
    patch_constraints: 'Patch nhịp arc, vòng lặp chương, vị trí hook/cliffhanger và phân bổ nhịp nhanh/chậm theo loại cảnh.',
  },
  qa_check: {
    patch_priority: 'required',
    patch_role: 'Prompt rà chất lượng sau khi viết.',
    patch_constraints: 'Bắt lỗi sai POV, lệch giọng, generic, pacing sai loại cảnh, thiếu hook/kết chương nếu Style Pack yêu cầu.',
  },
  continuity_check: {
    patch_priority: 'recommended',
    patch_role: 'Prompt kiểm tra continuity, timeline, world rules và trạng thái.',
    patch_constraints: 'Chỉ patch các rule continuity tái sử dụng được nếu đã thuộc project; không copy quan hệ/tên riêng của tác phẩm mẫu.',
  },
  check_conflict: {
    patch_priority: 'optional',
    patch_role: 'Prompt bắt mâu thuẫn canon rõ ràng.',
    patch_constraints: 'Chỉ patch nếu Style Pack có world-rule/canon-rule rõ ràng của project; không biến lỗi style thành conflict canon.',
  },
};

function getTargetPatchGuidance(key) {
  return TARGET_PATCH_GUIDANCE[key] || {
    patch_priority: 'optional',
    patch_role: 'Prompt project có thể được cập nhật nếu Style Pack có dữ liệu phù hợp.',
    patch_constraints: 'Chỉ sửa/cập nhật phần editable, không đổi contract hay biến template.',
  };
}

export function parsePromptTemplates(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object') return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyList(value) {
  if (!Array.isArray(value)) return '';
  return value.join('\n');
}

function parseListText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildProjectPromptItemMap() {
  const itemMap = new Map();
  PROJECT_PROMPT_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      itemMap.set(item.key, item);
    });
  });
  return itemMap;
}

export function buildDefaultPromptValue(key, genreKey = 'fantasy') {
  const template = GENRE_TEMPLATES[genreKey] || {};
  const item = buildProjectPromptItemMap().get(key) || {};

  if (key === 'ai_guidelines') return '';
  if (key === 'constitution') return stringifyList(template.constitution || []);
  if (key === 'style_dna') return stringifyList(template.style_dna || []);
  if (key === 'anti_ai_blacklist') return stringifyList(template.anti_ai_blacklist || []);
  if (key === 'nsfw_system_prompt') return DEFAULT_NSFW_RULES;
  if (key === 'nsfw_rules') return '';
  if (key === 'nsfw_intimate_prompt') return DEFAULT_NSFW_INTIMATE_PROMPT;
  if (item.type === 'list') return stringifyList(template[key] || []);
  return stripProtectedTaskInstruction(key, TASK_INSTRUCTIONS[key] || '');
}

export function normalizeOverrideValue(key, value) {
  const item = buildProjectPromptItemMap().get(key) || {};
  if (item.type === 'list') {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    return parseListText(value);
  }
  if (typeof value === 'string') return stripProtectedTaskInstruction(key, value);
  return '';
}

export function buildStyleImporterPromptBases({ currentProject } = {}) {
  const genreKey = currentProject?.genre_primary || 'fantasy';
  const itemMap = buildProjectPromptItemMap();
  const parsedTemplates = parsePromptTemplates(currentProject?.prompt_templates);
  const basePromptTemplates = {};
  const currentPromptTemplates = {};
  const currentPromptsForAI = {};

  STYLE_IMPORTER_ALLOWED_TARGETS.forEach((target) => {
    const key = normalizeTargetPromptKey(target);
    const item = itemMap.get(key) || { key, label: key, type: 'text' };
    const defaultValue = buildDefaultPromptValue(key, genreKey);

    if (item.type === 'list') {
      basePromptTemplates[key] = parseListText(defaultValue);
      if (Object.prototype.hasOwnProperty.call(parsedTemplates, key)) {
        currentPromptTemplates[key] = normalizeOverrideValue(key, parsedTemplates[key]);
      }
      currentPromptsForAI[key] = {
        label: item.label || key,
        type: 'list',
        current_value: Object.prototype.hasOwnProperty.call(currentPromptTemplates, key)
          ? currentPromptTemplates[key]
          : basePromptTemplates[key],
        ...getTargetPatchGuidance(key),
      };
      return;
    }

    if (key === 'ai_guidelines') {
      currentPromptsForAI[key] = {
        label: item.label || 'Chỉ dẫn AI của truyện',
        type: 'text',
        current_value: String(currentProject?.ai_guidelines || ''),
        ...getTargetPatchGuidance(key),
      };
      return;
    }

    basePromptTemplates[key] = defaultValue;
    if (typeof parsedTemplates[key] === 'string') {
      currentPromptTemplates[key] = stripProtectedTaskInstruction(key, parsedTemplates[key]);
    }
    currentPromptsForAI[key] = {
      label: item.label || key,
      type: 'text',
      current_value: Object.prototype.hasOwnProperty.call(currentPromptTemplates, key)
        ? currentPromptTemplates[key]
        : basePromptTemplates[key],
      ...getTargetPatchGuidance(key),
    };
  });

  return {
    basePromptTemplates,
    currentPromptTemplates,
    currentPromptsForAI,
    currentAiGuidelines: String(currentProject?.ai_guidelines || ''),
  };
}

export function cleanPromptTemplatesForSave(value = {}) {
  const itemMap = buildProjectPromptItemMap();
  const cleaned = {};

  Object.entries(value || {}).forEach(([key, rawValue]) => {
    const item = itemMap.get(key) || {};
    if (key === 'ai_guidelines' || item.persistAs === 'projectField') return;

    if (item.type === 'list' || ['constitution', 'style_dna', 'anti_ai_blacklist'].includes(key)) {
      const list = Array.isArray(rawValue) ? rawValue : parseListText(rawValue);
      const normalized = list.map((entry) => String(entry || '').trim()).filter(Boolean);
      if (normalized.length > 0) cleaned[key] = normalized;
      return;
    }

    const text = stripProtectedTaskInstruction(key, String(rawValue || '').trim());
    if (text) cleaned[key] = text;
  });

  return cleaned;
}
