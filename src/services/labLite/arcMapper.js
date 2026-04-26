import aiService from '../ai/client.js';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';
import { buildArcMapperPrompt } from './prompts/arcMapperPrompt.js';

const ARC_IMPORTANCE = ['low', 'medium', 'high', 'critical'];
const WINDOW_SIZE = 200;

function compareImportance(a, b) {
  return ARC_IMPORTANCE.indexOf(a) - ARC_IMPORTANCE.indexOf(b);
}

function normalizeChapterNumber(value, fallback, chapterCount) {
  const parsed = Math.trunc(Number(value));
  const safeFallback = Math.trunc(Number(fallback)) || 1;
  const upper = Math.max(1, Number(chapterCount || safeFallback));
  if (!Number.isFinite(parsed)) return Math.min(upper, Math.max(1, safeFallback));
  return Math.min(upper, Math.max(1, parsed));
}

export function compactScoutResultsForArcMapper(results = []) {
  return results
    .filter((result) => result?.status === 'complete')
    .map((result) => ({
      chapterIndex: Number(result.chapterIndex || 0),
      priority: result.priority || 'low',
      recommendation: result.recommendation || 'skip',
      detectedSignals: Array.isArray(result.detectedSignals) ? result.detectedSignals : [],
      reason: String(result.reason || '').slice(0, 360),
      confidence: Number(result.confidence || 0),
    }))
    .filter((result) => result.chapterIndex > 0)
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}

export function normalizeArcResults(raw, { corpusId = '', chapterCount = 0 } = {}) {
  const arcs = Array.isArray(raw?.arcs) ? raw.arcs : [];
  return arcs
    .map((arc, index) => {
      const chapterStart = normalizeChapterNumber(arc.chapterStart, index + 1, chapterCount);
      const chapterEnd = normalizeChapterNumber(arc.chapterEnd, chapterStart, chapterCount);
      const start = Math.min(chapterStart, chapterEnd);
      const end = Math.max(chapterStart, chapterEnd);
      const importance = ARC_IMPORTANCE.includes(arc.importance) ? arc.importance : 'medium';
      const recommendedDeepChapters = Array.isArray(arc.recommendedDeepChapters)
        ? arc.recommendedDeepChapters
          .map((value) => normalizeChapterNumber(value, start, chapterCount))
          .filter((value) => value >= start && value <= end)
        : [];

      return {
        id: arc.id || `${corpusId}_arc_${String(index + 1).padStart(3, '0')}`,
        corpusId,
        title: String(arc.title || `Arc ${index + 1}`).trim(),
        chapterStart: start,
        chapterEnd: end,
        summary: String(arc.summary || '').trim(),
        importance,
        whyLoad: String(arc.whyLoad || '').trim(),
        recommendedDeepChapters: [...new Set(recommendedDeepChapters)].sort((a, b) => a - b),
      };
    })
    .filter((arc) => arc.title && arc.chapterStart <= arc.chapterEnd)
    .sort((a, b) => a.chapterStart - b.chapterStart || compareImportance(b.importance, a.importance));
}

function askArcMapper({ scoutResults, chapterCount, corpusId, windowLabel }) {
  const messages = buildArcMapperPrompt({ scoutResults, chapterCount, windowLabel });
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
          resolve(normalizeArcResults(parseAIJsonValue(text), { corpusId, chapterCount }));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export async function runArcMapper({ corpusId, scoutResults = [], chapterCount = 0 }) {
  const compact = compactScoutResultsForArcMapper(scoutResults);
  if (compact.length === 0) {
    return [];
  }

  if (chapterCount <= WINDOW_SIZE) {
    return askArcMapper({ scoutResults: compact, chapterCount, corpusId, windowLabel: 'full' });
  }

  const windowArcs = [];
  for (let start = 1; start <= chapterCount; start += WINDOW_SIZE) {
    const end = Math.min(chapterCount, start + WINDOW_SIZE - 1);
    const windowResults = compact.filter((result) => result.chapterIndex >= start && result.chapterIndex <= end);
    if (windowResults.length === 0) continue;
    const arcs = await askArcMapper({
      scoutResults: windowResults,
      chapterCount,
      corpusId,
      windowLabel: `${start}-${end}`,
    });
    windowArcs.push(...arcs);
  }

  if (windowArcs.length <= 1) {
    return windowArcs;
  }

  const mergeInput = windowArcs.map((arc) => ({
    chapterIndex: arc.chapterStart,
    priority: arc.importance,
    recommendation: arc.importance === 'low' ? 'light_load' : 'deep_load',
    detectedSignals: [],
    reason: `${arc.title}: ${arc.summary} ${arc.whyLoad}`.slice(0, 420),
    confidence: 0.8,
  }));

  return askArcMapper({
    scoutResults: mergeInput,
    chapterCount,
    corpusId,
    windowLabel: 'merge',
  });
}

export function abortArcMapper() {
  aiService.abort();
}
