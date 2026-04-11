export const DEFAULT_MODEL = 'gemini-3.1-pro-high';
export const DEFAULT_PRESET = 'optimal';
export const DEFAULT_PARALLEL_CHUNKS = 6;
export const DEFAULT_SECONDS_PER_OUTPUT = 10;
export const MIN_CHUNK_SIZE_WORDS = 1000;

export const CONTEXT_LIMITS = {
  'gemini-3.1-pro-high': {
    label: 'Gemini 3.1 Pro High',
    inputTokens: 1000000,
    inputWords: 666666,
    recommendedInput: 650000,
    outputTokens: 65536,
    partsNeeded: 3,
  },
  'gemini-3.1-pro-low': {
    label: 'Gemini 3.1 Pro Low',
    inputTokens: 1000000,
    inputWords: 666666,
    recommendedInput: 650000,
    outputTokens: 65536,
    partsNeeded: 3,
  },
  'gemini-2.5-flash': {
    label: 'Gemini 2.5 Flash',
    inputTokens: 1000000,
    inputWords: 666666,
    recommendedInput: 650000,
    outputTokens: 65536,
    partsNeeded: 3,
  },
};

export const CHUNK_PRESETS = {
  fast: {
    key: 'fast',
    label: 'Fast',
    words: 15000,
    description: '15k từ/chunk cho tốc độ nhanh',
    model: 'gemini-2.5-flash',
  },
  balanced: {
    key: 'balanced',
    label: 'Balanced',
    words: 40000,
    description: '40k từ/chunk cân bằng tốc độ và chất lượng',
    model: 'gemini-3.1-pro-low',
  },
  optimal: {
    key: 'optimal',
    label: 'Optimal',
    words: 500000,
    description: '500k từ/chunk tối ưu cho ngữ cảnh lớn',
    model: 'gemini-3.1-pro-high',
  },
  custom: {
    key: 'custom',
    label: 'Custom',
    words: null,
    description: 'Nhập kích thước chunk thủ công',
    model: null,
  },
};

export function normalizePreset(preset) {
  if (preset && Object.prototype.hasOwnProperty.call(CHUNK_PRESETS, preset)) {
    return preset;
  }
  return DEFAULT_PRESET;
}

export function normalizeChunkSizeWords(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded <= 0) {
    return fallback;
  }

  return rounded;
}

export function normalizeParallelChunks(value, fallback = DEFAULT_PARALLEL_CHUNKS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(20, Math.round(parsed)));
}

export function resolveModel(model, preset = DEFAULT_PRESET) {
  if (model && Object.prototype.hasOwnProperty.call(CONTEXT_LIMITS, model)) {
    return model;
  }

  const presetKey = normalizePreset(preset);
  const presetModel = CHUNK_PRESETS[presetKey]?.model;

  if (presetModel && Object.prototype.hasOwnProperty.call(CONTEXT_LIMITS, presetModel)) {
    return presetModel;
  }

  return DEFAULT_MODEL;
}

export function resolveChunkSizeWords({ preset = DEFAULT_PRESET, customWords } = {}) {
  const presetKey = normalizePreset(preset);
  if (presetKey !== 'custom') {
    return CHUNK_PRESETS[presetKey]?.words ?? CHUNK_PRESETS[DEFAULT_PRESET].words;
  }

  return normalizeChunkSizeWords(customWords, null);
}

export function getContextLimits(model, preset = DEFAULT_PRESET) {
  const safeModel = resolveModel(model, preset);
  return CONTEXT_LIMITS[safeModel] || CONTEXT_LIMITS[DEFAULT_MODEL];
}

export function getPartsPerChunk(model, preset = DEFAULT_PRESET) {
  return getContextLimits(model, preset).partsNeeded || 3;
}

export function calculateNewChunks(corpusWordCount, chunkSizeWords, originalChunkCount = 0) {
  const safeCorpusWords = Math.max(0, Number(corpusWordCount) || 0);
  const safeChunkSize = Math.max(1, Number(chunkSizeWords) || 1);
  const newChunkCount = safeCorpusWords === 0 ? 0 : Math.ceil(safeCorpusWords / safeChunkSize);
  const originalCount = Math.max(0, Number(originalChunkCount) || 0);
  const efficiency = safeCorpusWords === 0
    ? 0
    : Math.min(100, (safeChunkSize / safeCorpusWords) * 100);

  return {
    originalChunkCount: originalCount,
    newChunkCount,
    wordsPerChunk: safeChunkSize,
    corpusWordCount: safeCorpusWords,
    efficiency,
    compressionRatio: originalCount > 0 && newChunkCount > 0
      ? Number((originalCount / newChunkCount).toFixed(2))
      : null,
  };
}

export function estimateAnalysisTime(
  chunkCount,
  partsPerChunk = 3,
  parallelChunks = 1,
  secondsPerOutput = DEFAULT_SECONDS_PER_OUTPUT,
) {
  const safeChunkCount = Math.max(0, Number(chunkCount) || 0);
  const safeParts = Math.max(1, Number(partsPerChunk) || 1);
  const safeParallel = Math.max(1, Number(parallelChunks) || 1);
  const safeSeconds = Math.max(1, Number(secondsPerOutput) || DEFAULT_SECONDS_PER_OUTPUT);

  const totalOutputs = safeChunkCount * safeParts;
  const batches = totalOutputs === 0 ? 0 : Math.ceil(totalOutputs / safeParallel);
  const totalSeconds = batches * safeSeconds;

  return {
    totalOutputs,
    batches,
    estimatedSeconds: totalSeconds,
    estimatedMinutes: Math.ceil(totalSeconds / 60),
    estimatedHours: Number((totalSeconds / 3600).toFixed(1)),
  };
}

export function validateChunkSize(words, model, preset = DEFAULT_PRESET) {
  const normalizedWords = normalizeChunkSizeWords(words, null);
  if (!normalizedWords) {
    return {
      valid: false,
      severity: 'error',
      warning: 'Kích thước chunk không hợp lệ.',
      limits: getContextLimits(model, preset),
    };
  }

  const limits = getContextLimits(model, preset);

  if (normalizedWords < MIN_CHUNK_SIZE_WORDS) {
    return {
      valid: false,
      severity: 'error',
      warning: `Chunk quá nhỏ. Nên >= ${MIN_CHUNK_SIZE_WORDS.toLocaleString('vi-VN')} từ.`,
      limits,
    };
  }

  if (normalizedWords > limits.inputWords) {
    return {
      valid: false,
      severity: 'error',
      warning: `Chunk vượt giới hạn ngữ cảnh (${limits.inputWords.toLocaleString('vi-VN')} từ).`,
      limits,
    };
  }

  if (normalizedWords > limits.recommendedInput) {
    return {
      valid: true,
      severity: 'warning',
      warning: `Chunk gần chạm giới hạn. Khuyến nghị <= ${limits.recommendedInput.toLocaleString('vi-VN')} từ.`,
      limits,
    };
  }

  return {
    valid: true,
    severity: null,
    warning: null,
    limits,
  };
}
