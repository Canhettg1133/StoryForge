import aiService from '../ai/client.js';
import modelRouter, { TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';
import { selectCanonPackContext } from './canonPackContext.js';
import { buildCanonReviewPrompt } from './prompts/canonReviewPrompt.js';
import { getLabLiteModelRoute } from './longContextPlanner.js';

export const CANON_REVIEW_MODES = ['quick', 'standard', 'deep'];
export const CANON_REVIEW_VERDICTS = [
  'no_obvious_issue',
  'possible_drift',
  'strong_conflict',
  'needs_user_confirmation',
];
export const CANON_REVIEW_ISSUE_TYPES = [
  'timeline',
  'character_voice',
  'relationship',
  'world_rule',
  'state',
  'restriction',
  'style',
];
export const CANON_REVIEW_SEVERITIES = ['low', 'medium', 'high'];

function clean(value, maxLength = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeMode(mode) {
  return CANON_REVIEW_MODES.includes(mode) ? mode : 'standard';
}

function capObject(value, charCap) {
  let next = value;
  let serialized = JSON.stringify(next);
  if (serialized.length <= charCap) return next;

  next = {
    ...next,
    chapterCanon: (next.chapterCanon || []).slice(0, 4),
    characterCanon: (next.characterCanon || []).slice(0, 6),
    relationshipCanon: (next.relationshipCanon || []).slice(0, 4),
    canonRestrictions: (next.canonRestrictions || []).slice(0, 8),
    creativeGaps: (next.creativeGaps || []).slice(0, 4),
    sourceExcerpts: (next.sourceExcerpts || []).slice(0, 2).map((item) => ({
      ...item,
      content: clean(item.content, 700),
    })),
  };
  serialized = JSON.stringify(next);
  if (serialized.length <= charCap) return next;

  return {
    packId: next.packId,
    packTitle: next.packTitle,
    mode: next.mode,
    projectMode: next.projectMode,
    adherenceLevel: next.adherenceLevel,
    globalCanon: clean(next.globalCanon, 500),
    characterCanon: (next.characterCanon || []).slice(0, 3),
    relationshipCanon: (next.relationshipCanon || []).slice(0, 2),
    styleCanon: clean(next.styleCanon, 300),
    canonRestrictions: (next.canonRestrictions || []).slice(0, 4).map((item) => clean(item, 220)),
    sourceExcerpts: (next.sourceExcerpts || []).slice(0, 1).map((item) => ({
      chapterIndex: item.chapterIndex,
      title: item.title,
      content: clean(item.content, 350),
    })),
  };
}

function chooseSourceExcerpts(sourceChapters = [], newText = '', maxCount = 4) {
  const needles = String(newText || '')
    .split(/\s+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4)
    .slice(0, 40);
  const scored = (sourceChapters || []).map((chapter) => {
    const content = String(chapter?.content || '');
    const lower = content.toLowerCase();
    const score = needles.reduce((sum, needle) => sum + (lower.includes(needle) ? 1 : 0), 0);
    return { chapter, score };
  });

  return scored
    .filter((entry) => entry.chapter?.content)
    .sort((left, right) => right.score - left.score || Number(left.chapter.index || 0) - Number(right.chapter.index || 0))
    .slice(0, maxCount)
    .map(({ chapter }) => ({
      chapterIndex: Number(chapter.index || chapter.chapterIndex || 0),
      title: chapter.title || '',
      content: clean(chapter.content, 1600),
    }));
}

export function buildCanonReviewContext({
  mode = 'standard',
  canonPack,
  project = {},
  newText = '',
  currentChapterText = '',
  currentChapterOutline = null,
  characters = [],
  sourceChapters = [],
  charCap = 9000,
} = {}) {
  if (!canonPack) return null;
  const normalizedMode = normalizeMode(mode);
  const baseCap = normalizedMode === 'quick'
    ? Math.min(charCap, 4500)
    : normalizedMode === 'deep'
      ? charCap
      : Math.min(charCap, 7000);
  const selected = selectCanonPackContext({
    canonPack,
    project,
    sceneText: [newText, currentChapterText].filter(Boolean).join('\n\n'),
    currentChapterOutline,
    characters,
    charCap: baseCap,
  }) || {};

  const context = {
    ...selected,
    mode: normalizedMode,
    reviewPolicy: 'AI goi y phat hien lech canon; tac gia quyet dinh chap nhan hay bo qua.',
  };

  if (normalizedMode === 'quick') {
    delete context.chapterCanon;
  }

  if (normalizedMode === 'deep') {
    context.sourceExcerpts = chooseSourceExcerpts(sourceChapters, newText);
  }

  return capObject(context, baseCap);
}

export function normalizeCanonReviewResult(rawResult, {
  mode = 'standard',
  canonPackId = '',
  projectId = null,
  chapterId = null,
  sceneId = null,
} = {}) {
  const parsed = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues = rawIssues
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      type: CANON_REVIEW_ISSUE_TYPES.includes(item.type) ? item.type : 'state',
      severity: CANON_REVIEW_SEVERITIES.includes(item.severity) ? item.severity : 'medium',
      quote: clean(item.quote, 360),
      canonReference: clean(item.canonReference || item.canon_reference, 700),
      explanation: clean(item.explanation, 900),
      suggestedFix: clean(item.suggestedFix || item.suggested_fix, 1200),
    }))
    .filter((item) => item.quote || item.canonReference || item.explanation || item.suggestedFix);

  let verdict = CANON_REVIEW_VERDICTS.includes(parsed.verdict)
    ? parsed.verdict
    : issues.length > 0
      ? 'needs_user_confirmation'
      : 'no_obvious_issue';

  if (issues.length === 0) {
    verdict = 'no_obvious_issue';
  }

  return {
    canonPackId,
    projectId,
    chapterId,
    sceneId,
    mode: normalizeMode(mode),
    verdict,
    issues,
    confidence: clamp01(parsed.confidence),
    status: 'complete',
  };
}

export function runCanonReview({
  mode = 'standard',
  canonPack,
  project = {},
  newText = '',
  currentChapterText = '',
  currentChapterOutline = null,
  characters = [],
  sourceChapters = [],
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const reviewContext = buildCanonReviewContext({
    mode: normalizedMode,
    canonPack,
    project,
    newText,
    currentChapterText,
    currentChapterOutline,
    characters,
    sourceChapters,
  });
  const messages = buildCanonReviewPrompt({
    mode: normalizedMode,
    reviewContext,
    newText,
    currentChapterText: normalizedMode === 'quick' ? '' : currentChapterText,
  });
  const route = getLabLiteModelRoute({ task: 'canon_review', mode: normalizedMode });
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.CANON_REVIEW,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: route.quality,
        useProxyQualityRouting: route.useProxyQualityRouting,
      },
      nsfwMode: !!project?.nsfw_mode,
      superNsfwMode: !!project?.super_nsfw_mode,
      onComplete: (text) => {
        try {
          resolve(normalizeCanonReviewResult(parseAIJsonValue(text), {
            mode: normalizedMode,
            canonPackId: canonPack?.id || '',
            projectId: project?.id || null,
          }));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export function abortCanonReview() {
  aiService.abort();
}
