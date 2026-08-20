import { countWords } from '../../utils/constants.js';

export const WORD_COUNT_CACHE_VERSION = 1;

export function hasCurrentWordCountVersion(record = {}) {
  return Number(record.word_count_version) === WORD_COUNT_CACHE_VERSION;
}

export function getEffectiveSceneText(scene = {}) {
  return scene.draft_text || scene.final_text || '';
}

export function countSceneWords(scene = {}) {
  return countWords(getEffectiveSceneText(scene));
}

function hasValidStoredSceneWordCount(scene = {}) {
  return hasCurrentWordCountVersion(scene)
    && typeof scene.word_count === 'number'
    && Number.isFinite(scene.word_count)
    && scene.word_count >= 0;
}

export function getStoredSceneWordCount(scene = {}) {
  return hasValidStoredSceneWordCount(scene)
    ? scene.word_count
    : countSceneWords(scene);
}

export function buildSceneWordCountChange(scene, changes = {}) {
  const nextScene = { ...scene, ...changes };
  const previousWordCount = getStoredSceneWordCount(scene);
  const nextWordCount = countSceneWords(nextScene);

  return {
    nextScene,
    previousWordCount,
    nextWordCount,
    wordCountVersion: WORD_COUNT_CACHE_VERSION,
    delta: nextWordCount - previousWordCount,
  };
}

function createWordCountNormalization(chapters, scenes) {
  const sourceChapters = Array.isArray(chapters) ? chapters : [];
  const sourceScenes = Array.isArray(scenes) ? scenes : [];
  return {
    sourceChapters,
    sourceScenes,
    totalsByChapterId: new Map(sourceChapters.map((chapter) => [chapter.id, 0])),
    nextScenes: sourceScenes,
  };
}

function normalizeSceneWordCountAt(state, index) {
  const scene = state.sourceScenes[index];
  const wordCount = getStoredSceneWordCount(scene);
  state.totalsByChapterId.set(
    scene.chapter_id,
    (state.totalsByChapterId.get(scene.chapter_id) || 0) + wordCount,
  );

  if (
    !hasValidStoredSceneWordCount(scene)
    || scene.word_count !== wordCount
  ) {
    if (state.nextScenes === state.sourceScenes) state.nextScenes = state.sourceScenes.slice();
    state.nextScenes[index] = {
      ...scene,
      word_count: wordCount,
      word_count_version: WORD_COUNT_CACHE_VERSION,
    };
  }
}

function finishWordCountNormalization(state) {
  let nextChapters = state.sourceChapters;
  for (let index = 0; index < state.sourceChapters.length; index += 1) {
    const chapter = state.sourceChapters[index];
    const actualWordCount = state.totalsByChapterId.get(chapter.id) || 0;
    if (
      !hasCurrentWordCountVersion(chapter)
      || Number(chapter.actual_word_count) !== actualWordCount
    ) {
      if (nextChapters === state.sourceChapters) nextChapters = state.sourceChapters.slice();
      nextChapters[index] = {
        ...chapter,
        actual_word_count: actualWordCount,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      };
    }
  }

  return {
    chapters: nextChapters,
    scenes: state.nextScenes,
    needsPersistence: nextChapters !== state.sourceChapters
      || state.nextScenes !== state.sourceScenes,
  };
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultYieldToMain() {
  if (typeof globalThis.scheduler?.yield === 'function') {
    return globalThis.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function normalizeProjectWordCounts(chapters = [], scenes = []) {
  const state = createWordCountNormalization(chapters, scenes);
  for (let index = 0; index < state.sourceScenes.length; index += 1) {
    normalizeSceneWordCountAt(state, index);
  }
  return finishWordCountNormalization(state);
}

export async function normalizeProjectWordCountsInSlices(chapters = [], scenes = [], options = {}) {
  const sourceScenes = Array.isArray(scenes) ? scenes : [];
  const requiresProseMigration = sourceScenes.some(
    (scene) => !hasValidStoredSceneWordCount(scene),
  );
  if (!requiresProseMigration) return normalizeProjectWordCounts(chapters, sourceScenes);

  const now = typeof options.now === 'function' ? options.now : defaultNow;
  const yieldToMain = typeof options.yieldToMain === 'function'
    ? options.yieldToMain
    : defaultYieldToMain;
  const requestedBudget = Number(options.timeBudgetMs);
  const timeBudgetMs = Number.isFinite(requestedBudget) && requestedBudget > 0
    ? requestedBudget
    : 5;
  const state = createWordCountNormalization(chapters, sourceScenes);
  let sliceStartedAt = now();

  for (let index = 0; index < state.sourceScenes.length; index += 1) {
    normalizeSceneWordCountAt(state, index);
    if (
      index < state.sourceScenes.length - 1
      && now() - sliceStartedAt >= timeBudgetMs
    ) {
      await yieldToMain();
      sliceStartedAt = now();
    }
  }

  return finishWordCountNormalization(state);
}

export function applyWordCountDelta(total, delta) {
  const normalizedTotal = Number(total);
  const normalizedDelta = Number(delta);
  return Math.max(
    0,
    (Number.isFinite(normalizedTotal) ? normalizedTotal : 0)
      + (Number.isFinite(normalizedDelta) ? normalizedDelta : 0),
  );
}
