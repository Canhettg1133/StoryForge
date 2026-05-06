import aiService from '../ai/client.js';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';
import {
  buildPromptPatchMessages,
  buildStyleAnalysisMessages,
  buildStyleMergeMessages,
} from './prompts.js';

const STRING_FIELDS = [
  'narrative_voice',
  'sentence_rhythm',
  'pov_and_pronouns',
  'description_density',
  'dialogue_style',
  'action_scene_style',
  'inner_monologue_style',
  'chapter_opening_pattern',
  'chapter_ending_pattern',
];
const LIST_FIELDS = [
  'pacing_rules',
  'continuity_rules',
  'must_preserve',
  'must_avoid',
  'evidence',
];
const PATCH_OPERATIONS = new Set(['append', 'insert_after', 'replace_sentence']);
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
const TARGET_PRIORITY = new Map([
  ['style_dna', 10],
  ['constitution', 20],
  ['ai_guidelines', 30],
  ['outline', 40],
  ['arc_outline', 50],
  ['qa_check', 60],
  ['continuity_check', 70],
  ['free_prompt', 80],
  ['continue', 90],
  ['scene_draft', 100],
  ['arc_chapter_draft', 110],
  ['anti_ai_blacklist', 120],
  ['check_conflict', 130],
]);

function normalizeTargetKey(value = '') {
  const raw = String(value || '').trim();
  return TARGET_ALIASES[raw.toUpperCase()] || raw.toLowerCase();
}

function cleanText(value = '', maxLength = 2200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeList(value, maxLength = 1200) {
  if (Array.isArray(value)) {
    return value.map((item) => (
      typeof item === 'object' && item !== null
        ? JSON.stringify(item)
        : cleanText(item, maxLength)
    )).filter(Boolean);
  }
  const text = cleanText(value, maxLength);
  return text ? [text] : [];
}

export function normalizeStyleAnalysisResult(raw = {}) {
  const source = raw && typeof raw === 'object'
    ? (raw.style_dna && typeof raw.style_dna === 'object' ? raw.style_dna : raw)
    : {};
  const normalized = {};

  STRING_FIELDS.forEach((field) => {
    normalized[field] = cleanText(source[field], 1600);
  });
  LIST_FIELDS.forEach((field) => {
    normalized[field] = normalizeList(source[field]);
  });

  return normalized;
}

export function normalizePromptPatchResult(raw = {}) {
  const patches = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.patches)
      ? raw.patches
      : Array.isArray(raw?.prompt_patches)
        ? raw.prompt_patches
        : Array.isArray(raw?.promptPatches)
          ? raw.promptPatches
          : Array.isArray(raw?.updates)
            ? raw.updates
            : Array.isArray(raw?.patch)
              ? raw.patch
              : [];

  return patches.map((patch) => ({
    target_prompt: cleanText(
      patch?.target_prompt
        || patch?.targetPrompt
        || patch?.target
        || patch?.prompt
        || patch?.key,
      120,
    ),
    operation: PATCH_OPERATIONS.has(patch?.operation) ? patch.operation : 'append',
    anchor: cleanText(patch?.anchor, 500),
    before: cleanText(patch?.before || patch?.old || patch?.from, 1600),
    after: String(patch?.after || patch?.content || patch?.new || patch?.to || patch?.text || '').trim(),
    reason: cleanText(patch?.reason, 900),
    risk: cleanText(patch?.risk, 900),
  }))
    .filter((patch) => patch.target_prompt && patch.after)
    .sort((left, right) => {
      const leftPriority = TARGET_PRIORITY.get(normalizeTargetKey(left.target_prompt)) || 999;
      const rightPriority = TARGET_PRIORITY.get(normalizeTargetKey(right.target_prompt)) || 999;
      return leftPriority - rightPriority;
    });
}

function sendJsonRequest(messages, { quality = QUALITY_MODES.BEST } = {}) {
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: quality,
      },
      onComplete: (text) => {
        try {
          resolve(parseAIJsonValue(text));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

async function runPool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  async function next() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;

    results[index] = await worker(items[index], index);
    completed += 1;
    onProgress?.({ completed, total: items.length, item: items[index], index });
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

export async function analyzeStyleChunks({
  chunks = [],
  userInstruction = '',
  fileMeta = {},
  onProgress,
} = {}) {
  const analyses = await runPool(
    chunks,
    2,
    async (chunk) => {
      const messages = buildStyleAnalysisMessages({ chunk, userInstruction, fileMeta });
      const raw = await sendJsonRequest(messages, { quality: QUALITY_MODES.BEST });
      return normalizeStyleAnalysisResult(raw);
    },
    onProgress,
  );
  return analyses.filter(Boolean);
}

export async function mergeStylePack({ analyses = [], userInstruction = '' } = {}) {
  if (!Array.isArray(analyses) || analyses.length === 0) {
    return normalizeStyleAnalysisResult({});
  }
  if (analyses.length === 1) {
    return normalizeStyleAnalysisResult(analyses[0]);
  }

  const messages = buildStyleMergeMessages({ analyses, userInstruction });
  const raw = await sendJsonRequest(messages, { quality: QUALITY_MODES.BEST });
  return normalizeStyleAnalysisResult(raw);
}

export async function generatePromptPatches({
  stylePack = {},
  currentPrompts = {},
  userInstruction = '',
  allowedTargets = [],
} = {}) {
  const messages = buildPromptPatchMessages({
    stylePack,
    currentPrompts,
    userInstruction,
    allowedTargets,
  });
  const raw = await sendJsonRequest(messages, { quality: QUALITY_MODES.BEST });
  return normalizePromptPatchResult(raw);
}

export function abortStyleImporterRequests() {
  aiService.abort();
}
