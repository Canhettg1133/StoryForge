import { TASK_TYPES } from './router';
import { TASK_INSTRUCTIONS } from './promptBuilder/taskInstructions';
import { composeTaskInstruction } from './promptBuilder/taskInstructionProtection';
import { resolveSystemIdentityPrompt } from './promptBuilder/systemIdentity';
import { buildStyleDNALayer } from './promptBuilder/layers';
import { detectWritingStyle } from '../../utils/constants';

export const PROJECT_STYLE_RUNTIME_HEADER = '[PROJECT STYLE - BẮT BUỘC]';

export const PROJECT_STYLE_RUNTIME_SECTIONS = [
  { number: 1, label: 'Luật cốt lõi', slug: 'luat cot loi' },
  { number: 2, label: 'Giọng kể / POV', slug: 'giong ke pov' },
  { number: 3, label: 'Nhịp chương', slug: 'nhip chuong' },
  { number: 4, label: 'Scene grammar', slug: 'scene grammar' },
  { number: 5, label: 'Cần tránh', slug: 'can tranh' },
  { number: 6, label: 'QA tự kiểm ngầm', slug: 'qa tu kiem ngam' },
];

export const PROJECT_STYLE_RUNTIME_TASK_PROMPT_KEYS = [
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.OUTLINE,
  TASK_TYPES.ARC_OUTLINE,
  TASK_TYPES.QA_CHECK,
  TASK_TYPES.CONTINUITY_CHECK,
];

const PROJECT_STYLE_RUNTIME_TASKS = new Set([
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
  TASK_TYPES.OUTLINE,
  TASK_TYPES.ARC_OUTLINE,
  TASK_TYPES.QA_CHECK,
  TASK_TYPES.CONTINUITY_CHECK,
]);

function stripDiacritics(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[Đđ]/g, (char) => (char === 'Đ' ? 'D' : 'd'));
}

function normalizeForSectionMatch(value = '') {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForHash(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeForHash(value[key]);
        return acc;
      }, {});
  }
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  return value ?? '';
}

function stableStringify(value) {
  return JSON.stringify(normalizeForHash(value));
}

function hashString(value = '') {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parsePromptTemplates(rawValue) {
  if (!rawValue) return {};
  if (rawValue && typeof rawValue === 'object') return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function listFromTemplate(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  return [];
}

function resolveWritingStyle(genre = '', writingStyle = '') {
  if (writingStyle) return writingStyle;
  const genreKey = genre ? String(genre).toLowerCase().replace(/\s+/g, '_') : '';
  return detectWritingStyle(genreKey || '');
}

export function buildProjectStyleRuntimeSources({
  aiGuidelines = '',
  promptTemplates = {},
  genre = '',
  writingStyle = '',
  systemIdentityPrompt = resolveSystemIdentityPrompt(),
} = {}) {
  const templates = parsePromptTemplates(promptTemplates);
  const resolvedWritingStyle = resolveWritingStyle(genre, writingStyle);

  const taskPrompts = PROJECT_STYLE_RUNTIME_TASK_PROMPT_KEYS.reduce((acc, key) => {
    const editable = templates[key] || TASK_INSTRUCTIONS[key] || '';
    acc[key] = composeTaskInstruction(key, editable);
    return acc;
  }, {});

  return {
    system_identity: systemIdentityPrompt || '',
    default_style_dna: buildStyleDNALayer(TASK_TYPES.FREE_PROMPT, resolvedWritingStyle) || '',
    ai_guidelines: String(aiGuidelines || ''),
    constitution: listFromTemplate(templates.constitution),
    style_dna: listFromTemplate(templates.style_dna),
    anti_ai_blacklist: listFromTemplate(templates.anti_ai_blacklist),
    task_prompts: taskPrompts,
  };
}

export function computeProjectStyleRuntimeSourceHash(input = {}) {
  return hashString(stableStringify(buildProjectStyleRuntimeSources(input)));
}

export function normalizeProjectStyleRuntimeMeta(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

export function hasRequiredProjectStyleRuntimeSections(block = '') {
  const normalized = normalizeForSectionMatch(block);
  if (!normalized) return false;

  return PROJECT_STYLE_RUNTIME_SECTIONS.every((section) => {
    const withNumber = `${section.number} ${section.slug}`;
    return normalized.includes(withNumber) || normalized.includes(section.slug);
  });
}

export function formatProjectStyleRuntimeBlock(block = '') {
  const text = String(block || '').trim();
  if (!text) return '';
  if (text.startsWith(PROJECT_STYLE_RUNTIME_HEADER)) {
    return `\n${text}`;
  }
  return `\n${PROJECT_STYLE_RUNTIME_HEADER}\n${text}`;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  return text ? [text] : [];
}

export function normalizeProjectStyleRuntimeResult(raw = {}, { sourceHash = '' } = {}) {
  const block = String(
    raw?.project_style_runtime_block
      || raw?.runtime_block
      || raw?.block
      || raw?.system_prompt_block
      || '',
  ).trim();

  if (!block) {
    throw new Error('AI không trả về project_style_runtime_block.');
  }
  if (!hasRequiredProjectStyleRuntimeSections(block)) {
    throw new Error('Project Style Runtime chưa đủ 6 mục bắt buộc.');
  }

  const meta = {
    source_hash: String(sourceHash || raw?.source_hash || '').trim(),
    generated_at: Number.isFinite(Number(raw?.generated_at)) ? Number(raw.generated_at) : Date.now(),
    source_coverage: normalizeStringList(raw?.source_coverage),
    merged_rules: normalizeStringList(raw?.merged_rules),
    dropped_rules: normalizeStringList(raw?.dropped_rules),
    risks: normalizeStringList(raw?.risks),
    how_it_combines_with_base_system: String(raw?.how_it_combines_with_base_system || '').trim(),
  };

  return {
    project_style_runtime_block: formatProjectStyleRuntimeBlock(block).trim(),
    meta,
  };
}

export function getProjectStyleRuntimeState({
  taskType,
  skipWritingLayers = false,
  aiGuidelines = '',
  promptTemplates = {},
  genre = '',
  writingStyle = '',
  projectStyleRuntimeBlock = '',
  projectStyleRuntimeEnabled = false,
  projectStyleRuntimeMeta = null,
  systemIdentityPrompt,
} = {}) {
  const sourceHash = computeProjectStyleRuntimeSourceHash({
    aiGuidelines,
    promptTemplates,
    genre,
    writingStyle,
    systemIdentityPrompt,
  });
  const block = String(projectStyleRuntimeBlock || '').trim();
  const meta = normalizeProjectStyleRuntimeMeta(projectStyleRuntimeMeta);
  const enabled = projectStyleRuntimeEnabled === true || projectStyleRuntimeEnabled === 'true';
  const taskSupported = PROJECT_STYLE_RUNTIME_TASKS.has(taskType);
  const validBlock = hasRequiredProjectStyleRuntimeSections(block);
  const stale = Boolean(enabled && block && (!meta.source_hash || meta.source_hash !== sourceHash));
  const active = Boolean(
    enabled
    && block
    && validBlock
    && taskSupported
    && !skipWritingLayers
    && meta.source_hash === sourceHash,
  );

  return {
    active,
    enabled,
    stale,
    validBlock,
    taskSupported,
    sourceHash,
    meta,
    block,
    systemBlock: active ? formatProjectStyleRuntimeBlock(block) : '',
  };
}

export function buildProjectStyleRuntimeBlockForProjectChat(project = {}) {
  if (!project) return '';
  const promptTemplates = parsePromptTemplates(project.prompt_templates);
  const state = getProjectStyleRuntimeState({
    taskType: TASK_TYPES.FREE_PROMPT,
    skipWritingLayers: false,
    aiGuidelines: project.ai_guidelines || '',
    promptTemplates,
    genre: project.genre_primary || '',
    projectStyleRuntimeBlock: project.project_style_runtime_block || '',
    projectStyleRuntimeEnabled: project.project_style_runtime_enabled,
    projectStyleRuntimeMeta: project.project_style_runtime_meta,
  });
  return state.active ? state.systemBlock.trim() : '';
}
