import aiService from '../ai/client.js';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';
import { buildChapterScoutBatchPrompt, buildChapterScoutPrompt } from './prompts/chapterScoutPrompt.js';
import { extractScoutBatchItems, validateChapterCoverage } from './analysisValidation.js';

export const SCOUT_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const SCOUT_RECOMMENDATIONS = ['skip', 'light_load', 'deep_load'];
export const SCOUT_SIGNALS = [
  'new_character',
  'relationship_shift',
  'worldbuilding',
  'reveal',
  'state_change',
  'adult_sensitive',
  'sensitive_or_relationship_heavy',
  'ending_hook',
];

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function splitParagraphs(text = '') {
  return String(text || '')
    .split(/\n\s*\n/u)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function clipText(text = '', maxChars = 1800) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}...`;
}

export function buildChapterSample(chapter, totalChapters = 0) {
  const paragraphs = splitParagraphs(chapter?.content || '');
  const middleIndexes = paragraphs.length > 4
    ? [
      Math.floor(paragraphs.length * 0.4),
      Math.floor(paragraphs.length * 0.65),
    ]
    : [Math.floor(paragraphs.length / 2)];

  const middle = [...new Set(middleIndexes)]
    .map((index) => paragraphs[index])
    .filter(Boolean)
    .map((text) => clipText(text, 900));

  return {
    title: chapter?.title || `Chapter ${chapter?.index || '?'}`,
    chapterIndex: Number(chapter?.index || 0),
    totalChapters: Number(totalChapters || 0),
    wordCount: Number(chapter?.wordCount || 0),
    estimatedTokens: Number(chapter?.estimatedTokens || 0),
    opening: clipText(paragraphs.slice(0, 2).join('\n\n'), 1800),
    middle,
    ending: clipText(paragraphs.slice(-2).join('\n\n'), 1800),
  };
}

export function normalizeScoutResult(rawResult, { chapterIndex, corpusId, goal, allowAdultSignals = false } = {}) {
  const parsed = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const priority = SCOUT_PRIORITIES.includes(parsed.priority) ? parsed.priority : 'low';
  const recommendation = SCOUT_RECOMMENDATIONS.includes(parsed.recommendation) ? parsed.recommendation : 'skip';
  const detectedSignals = Array.isArray(parsed.detectedSignals)
    ? parsed.detectedSignals.filter((signal) => SCOUT_SIGNALS.includes(signal))
    : [];
  const safeSignals = detectedSignals.map((signal) => {
    if (signal === 'adult_sensitive' && !allowAdultSignals) {
      return 'sensitive_or_relationship_heavy';
    }
    return signal;
  });

  if (parsed.detectedSignals?.includes?.('adult_sensitive') && !allowAdultSignals && !safeSignals.includes('sensitive_or_relationship_heavy')) {
    safeSignals.push('sensitive_or_relationship_heavy');
  }

  return {
    corpusId,
    goal,
    chapterIndex: Number(parsed.chapterIndex || chapterIndex || 0),
    priority,
    recommendation,
    detectedSignals: [...new Set(safeSignals)],
    reason: String(parsed.reason || '').trim() || 'AI không trả lý do.',
    confidence: clamp01(parsed.confidence),
    status: 'complete',
    syntheticFallback: Boolean(parsed.syntheticFallback),
  };
}

export function createFailedScoutResult({ corpusId, goal, chapterIndex, error }) {
  return {
    corpusId,
    goal,
    chapterIndex,
    priority: 'low',
    recommendation: 'skip',
    detectedSignals: [],
    reason: error?.message || 'Scout lỗi.',
    confidence: 0,
    status: 'error',
  };
}

export function normalizeScoutBatchResults(rawResult, {
  chapters = [],
  corpusId,
  goal,
  allowAdultSignals = false,
} = {}) {
  const parsedBatch = extractScoutBatchItems(rawResult);
  const rawItems = parsedBatch.items;
  const expectedIndexes = (chapters || [])
    .map((chapter) => Number(chapter?.index || chapter?.chapterIndex || 0))
    .filter((value) => value > 0);
  const coverage = validateChapterCoverage(rawItems, expectedIndexes);
  const rawByChapter = new Map(rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => [Number(item.chapterIndex || 0), item]));

  return (chapters || []).map((chapter) => {
    const chapterIndex = Number(chapter?.index || chapter?.chapterIndex || 0);
    const raw = rawByChapter.get(chapterIndex) || {
      chapterIndex,
      priority: 'low',
      recommendation: 'skip',
      detectedSignals: [],
      reason: 'AI không trả kết quả cho chương này.',
      confidence: 0,
      syntheticFallback: true,
    };
    const normalized = normalizeScoutResult(raw, {
      chapterIndex,
      corpusId: chapter?.corpusId || corpusId,
      goal,
      allowAdultSignals,
    });
    return {
      ...normalized,
      missingFromBatch: coverage.missingChapterIndexes.includes(chapterIndex),
    };
  });
}

export function runChapterScout({ chapter, totalChapters, goal, allowAdultSignals = false }) {
  const chapterSample = buildChapterSample(chapter, totalChapters);
  const messages = buildChapterScoutPrompt({ chapterSample, goal, allowAdultSignals });
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: QUALITY_MODES.FAST,
        useProxyQualityRouting: true,
      },
      onComplete: (text) => {
        try {
          resolve(normalizeScoutResult(parseAIJsonValue(text), {
            chapterIndex: chapter.index,
            corpusId: chapter.corpusId,
            goal,
            allowAdultSignals,
          }));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export function runChapterScoutBatch({ chapters = [], corpusId = null, totalChapters, goal, allowAdultSignals = false }) {
  const safeChapters = (chapters || []).filter(Boolean);
  const batchCorpusId = corpusId || safeChapters.find((chapter) => chapter?.corpusId)?.corpusId || null;
  if (safeChapters.length === 1) {
    const chapter = safeChapters[0]?.corpusId || !batchCorpusId
      ? safeChapters[0]
      : { ...safeChapters[0], corpusId: batchCorpusId };
    return runChapterScout({ chapter, totalChapters, goal, allowAdultSignals })
      .then((result) => [result]);
  }

  const chapterSamples = safeChapters.map((chapter) => buildChapterSample(chapter, totalChapters));
  const messages = buildChapterScoutBatchPrompt({ chapterSamples, goal, allowAdultSignals });
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: QUALITY_MODES.FAST,
        useProxyQualityRouting: true,
      },
      onComplete: (text) => {
        try {
          resolve(normalizeScoutBatchResults(parseAIJsonValue(text), {
            chapters: safeChapters,
            corpusId: batchCorpusId,
            goal,
            allowAdultSignals,
          }));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export function abortChapterScoutQueue() {
  aiService.abort();
}
