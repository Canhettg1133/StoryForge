import { QUALITY_MODES } from '../ai/router.js';

export const ANALYSIS_STRATEGIES = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
  HUGE: 'huge',
};

export function hashLabLiteContent(value = '') {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32_${(hash >>> 0).toString(16).padStart(8, '0')}_${text.length}`;
}

export function resolveLongContextStrategy({
  totalEstimatedTokens = 0,
  chapterCount = 0,
  modelInputLimit = 1_000_000,
} = {}) {
  const tokens = Math.max(0, Number(totalEstimatedTokens) || 0);
  const chapters = Math.max(0, Number(chapterCount) || 0);
  const limit = Math.max(1, Number(modelInputLimit) || 1_000_000);

  if (tokens <= Math.floor(limit * 0.12) && chapters <= 40) {
    return {
      strategy: ANALYSIS_STRATEGIES.SMALL,
      label: 'Nạp nhanh bằng long context',
      recommendation: 'full_long_context',
      estimatedBatches: 1,
    };
  }

  if (tokens <= Math.floor(limit * 0.75) && chapters <= 180) {
    return {
      strategy: ANALYSIS_STRATEGIES.MEDIUM,
      label: 'Nạp theo batch arc',
      recommendation: 'arc_batches',
      estimatedBatches: Math.max(2, Math.ceil(tokens / Math.floor(limit * 0.45))),
    };
  }

  if (tokens <= Math.floor(limit * 2.5) && chapters <= 700) {
    return {
      strategy: ANALYSIS_STRATEGIES.LARGE,
      label: 'Quét batch lớn rồi nạp sâu arc chọn lọc',
      recommendation: 'scout_then_deep_selected',
      estimatedBatches: Math.max(3, Math.ceil(tokens / Math.floor(limit * 0.35))),
    };
  }

  return {
    strategy: ANALYSIS_STRATEGIES.HUGE,
    label: 'Người dùng chọn chương/arc trọng tâm',
    recommendation: 'user_guided_selection',
    estimatedBatches: Math.max(5, Math.ceil(tokens / Math.floor(limit * 0.25))),
  };
}

function getScoutBatchSize(strategy) {
  switch (strategy) {
    case ANALYSIS_STRATEGIES.SMALL:
      return 40;
    case ANALYSIS_STRATEGIES.MEDIUM:
      return 50;
    case ANALYSIS_STRATEGIES.LARGE:
      return 60;
    case ANALYSIS_STRATEGIES.HUGE:
      return 80;
    default:
      return 40;
  }
}

export function planLabLiteScoutBatches({
  chapters = [],
  totalEstimatedTokens = 0,
  chapterCount = 0,
  modelInputLimit = 1_000_000,
  maxChaptersPerBatch = null,
  batchTokenBudget = null,
  expectedOutputTokensPerChapter = 180,
} = {}) {
  const sortedChapters = [...(chapters || [])]
    .filter(Boolean)
    .sort((a, b) => Number(a.index || a.chapterIndex || 0) - Number(b.index || b.chapterIndex || 0));
  const strategy = resolveLongContextStrategy({
    totalEstimatedTokens,
    chapterCount: chapterCount || sortedChapters.length,
    modelInputLimit,
  });
  const batchSize = Math.max(1, Math.trunc(Number(maxChaptersPerBatch)) || getScoutBatchSize(strategy.strategy));
  const tokenBudget = Math.max(
    1,
    Math.trunc(Number(batchTokenBudget))
      || Math.floor(Math.max(1, Number(modelInputLimit) || 1_000_000) * 0.65),
  );
  const outputPerChapter = Math.max(0, Math.trunc(Number(expectedOutputTokensPerChapter)) || 0);
  const batches = [];
  let current = [];
  let currentBudget = 0;
  const flush = () => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBudget = 0;
  };

  for (const chapter of sortedChapters) {
    const chapterBudget = Math.max(
      1,
      Number(chapter.sampleEstimatedTokens || chapter.scoutEstimatedTokens || chapter.estimatedTokens || 1),
    ) + outputPerChapter;
    if (current.length > 0 && (current.length >= batchSize || currentBudget + chapterBudget > tokenBudget)) {
      flush();
    }
    current.push(chapter);
    currentBudget += chapterBudget;
  }
  flush();
  return {
    strategy,
    batchSize,
    tokenBudget,
    batches,
    estimatedRequests: batches.length,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueSortedNumbers(values = []) {
  return [...new Set(values
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
}

function chapterByIndex(chapters = []) {
  return new Map(asArray(chapters).map((chapter) => [Number(chapter.index || chapter.chapterIndex), chapter]));
}

function getArcImportanceWeight(importance) {
  if (importance === 'critical') return 4;
  if (importance === 'high') return 3;
  if (importance === 'medium') return 2;
  return 1;
}

export function buildDeepSelectionPlan({
  preset = 'ai_recommended',
  chapters = [],
  scoutResults = [],
  arcs = [],
  allowAdultCanon = false,
  rangeStart = null,
  rangeEnd = null,
  characterName = '',
  chapterCoverage = [],
  modelInputLimit = 1_000_000,
} = {}) {
  const chapterMap = chapterByIndex(chapters);
  const selected = [];
  const normalizedPreset = String(preset || 'ai_recommended');

  if (normalizedPreset === 'important_arcs') {
    asArray(arcs)
      .filter((arc) => ['critical', 'high'].includes(arc.importance))
      .sort((a, b) => getArcImportanceWeight(b.importance) - getArcImportanceWeight(a.importance))
      .forEach((arc) => {
        selected.push(...asArray(arc.recommendedDeepChapters));
        if (arc.chapterStart) selected.push(arc.chapterStart);
        if (arc.chapterEnd) selected.push(arc.chapterEnd);
      });
  } else if (normalizedPreset === 'signals') {
    asArray(scoutResults)
      .filter((result) => asArray(result.detectedSignals).some((signal) => ['reveal', 'worldbuilding', 'relationship_shift'].includes(signal)))
      .forEach((result) => selected.push(result.chapterIndex));
  } else if (normalizedPreset === 'adult_sensitive') {
    if (allowAdultCanon) {
      asArray(scoutResults)
        .filter((result) => asArray(result.detectedSignals).some((signal) => ['adult_sensitive', 'sensitive_or_relationship_heavy'].includes(signal)))
        .forEach((result) => selected.push(result.chapterIndex));
    }
  } else if (normalizedPreset === 'range') {
    const start = Math.max(1, Math.trunc(Number(rangeStart)) || 1);
    const end = Math.max(start, Math.trunc(Number(rangeEnd)) || start);
    for (let chapterIndex = start; chapterIndex <= end; chapterIndex += 1) {
      selected.push(chapterIndex);
    }
  } else if (normalizedPreset === 'character') {
    const needle = String(characterName || '').trim().toLowerCase();
    asArray(chapters)
      .filter((chapter) => {
        if (!needle) return false;
        return String(chapter.title || '').toLowerCase().includes(needle)
          || String(chapter.content || '').toLowerCase().includes(needle);
      })
      .forEach((chapter) => selected.push(chapter.index || chapter.chapterIndex));
  } else if (normalizedPreset === 'missing_digest') {
    asArray(chapterCoverage)
      .filter((entry) => !entry.digestDone)
      .forEach((entry) => selected.push(entry.chapterIndex));
  } else {
    asArray(scoutResults)
      .filter((result) => result.recommendation === 'deep_load' || ['critical', 'high'].includes(result.priority))
      .forEach((result) => selected.push(result.chapterIndex));
    asArray(arcs).forEach((arc) => selected.push(...asArray(arc.recommendedDeepChapters)));
  }

  const selectedChapterIndexes = uniqueSortedNumbers(selected)
    .filter((chapterIndex) => chapterMap.has(chapterIndex));
  const selectedChapters = selectedChapterIndexes.map((chapterIndex) => chapterMap.get(chapterIndex));
  const estimatedTokens = selectedChapters.reduce((sum, chapter) => sum + Number(chapter?.estimatedTokens || 0), 0);
  const strategy = resolveLongContextStrategy({
    totalEstimatedTokens: estimatedTokens,
    chapterCount: selectedChapterIndexes.length,
    modelInputLimit,
  });
  const usableInput = Math.max(1, Math.floor(Number(modelInputLimit || 1_000_000) * 0.55));
  const estimatedRequests = Math.max(1, Math.ceil(estimatedTokens / usableInput));
  const totalChapters = Math.max(1, asArray(chapters).length);

  return {
    preset: normalizedPreset,
    selectedChapterIndexes,
    selectedCount: selectedChapterIndexes.length,
    estimatedTokens,
    estimatedRequests,
    strategy,
    coverageAfterRun: Math.min(1, selectedChapterIndexes.length / totalChapters),
  };
}

export function getLabLiteModelRoute({ task = '', mode = 'standard' } = {}) {
  const normalizedTask = String(task || '').toLowerCase();
  const normalizedMode = String(mode || 'standard').toLowerCase();

  if (normalizedTask === 'scout') {
    return { task: normalizedTask, quality: QUALITY_MODES.FAST, useProxyQualityRouting: true };
  }
  if (normalizedTask === 'arc_mapper') {
    return { task: normalizedTask, quality: QUALITY_MODES.BALANCED, useProxyQualityRouting: true };
  }
  if (normalizedTask === 'deep_analysis') {
    return { task: normalizedTask, quality: QUALITY_MODES.BEST, useProxyQualityRouting: true };
  }
  if (normalizedTask === 'canon_review') {
    const quality = normalizedMode === 'quick'
      ? QUALITY_MODES.FAST
      : normalizedMode === 'deep'
        ? QUALITY_MODES.BEST
        : QUALITY_MODES.BALANCED;
    return { task: normalizedTask, mode: normalizedMode, quality, useProxyQualityRouting: true };
  }
  return { task: normalizedTask, quality: QUALITY_MODES.BALANCED, useProxyQualityRouting: true };
}

export function buildChapterAnalysisCacheEntry({
  chapter,
  analysisType,
  goal = '',
  status = 'complete',
  resultId = '',
} = {}) {
  const corpusId = chapter?.corpusId || '';
  const chapterIndex = Number(chapter?.index || chapter?.chapterIndex || 0);
  const contentHash = chapter?.contentHash || hashLabLiteContent(chapter?.content || '');
  const type = String(analysisType || '').trim();
  const normalizedGoal = String(goal || '').trim();
  return {
    id: `${corpusId}_${type}_${normalizedGoal || 'default'}_${chapterIndex}`,
    corpusId,
    chapterId: chapter?.id || '',
    chapterIndex,
    analysisType: type,
    goal: normalizedGoal,
    contentHash,
    status,
    resultId,
    updatedAt: Date.now(),
  };
}

export function shouldReuseAnalysisCache({
  chapter,
  cacheEntry,
  analysisType,
  goal = '',
} = {}) {
  if (!chapter || !cacheEntry || cacheEntry.status !== 'complete') return false;
  if (String(cacheEntry.analysisType || '') !== String(analysisType || '')) return false;
  if (String(cacheEntry.goal || '') !== String(goal || '')) return false;
  if (Number(cacheEntry.chapterIndex || 0) !== Number(chapter.index || chapter.chapterIndex || 0)) return false;
  const contentHash = chapter.contentHash || hashLabLiteContent(chapter.content || '');
  return cacheEntry.contentHash === contentHash;
}
