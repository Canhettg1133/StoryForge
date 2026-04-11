import { getRunMode } from './pipeline/modes.js';

export const ANALYSIS_PROVIDERS = {
  GEMINI_PROXY: 'gemini_proxy',
  GEMINI_DIRECT: 'gemini_direct',
};

export const ANALYSIS_MODELS = {
  context_pro: 'gemini-3.1-pro-high',
  context_flash: 'gemini-3.1-pro-low',
  quick: 'gemini-2.5-flash',
};

const PROVIDER_MODEL_MAP = {
  [ANALYSIS_PROVIDERS.GEMINI_PROXY]: [
    ANALYSIS_MODELS.context_pro,
    ANALYSIS_MODELS.context_flash,
    ANALYSIS_MODELS.quick,
  ],
  [ANALYSIS_PROVIDERS.GEMINI_DIRECT]: [
    ANALYSIS_MODELS.context_pro,
    ANALYSIS_MODELS.context_flash,
    ANALYSIS_MODELS.quick,
  ],
};

export const ANALYSIS_LAYERS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

export const ANALYSIS_CONFIG = {
  provider: ANALYSIS_PROVIDERS.GEMINI_PROXY,
  models: ANALYSIS_MODELS,
  session: {
    maxInputWords: 666666,
    maxOutputPerPart: 65536,
    maxParts: 6,
    continuePrompt:
      'Tiếp tục đúng ngay vị trí đang dở. Chỉ trả về phần JSON hợp lệ tiếp theo. Nội dung hiển thị bằng tiếng Việt (giữ nguyên key schema tiếng Anh) và cập nhật meta.hasMore chính xác.',
  },
  defaults: {
    chunkSize: 666666,
    chunkOverlap: 0,
    temperature: 0.2,
    layers: [...ANALYSIS_LAYERS],
    runMode: 'balanced',
  },
  sse: {
    retryMs: 5000,
    heartbeatMs: 15000,
  },
};

function toArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

export function resolveLayers(layers) {
  const incoming = toArray(layers).map((layer) => String(layer || '').toLowerCase());
  const unique = [];

  for (const layer of incoming) {
    if (!ANALYSIS_LAYERS.includes(layer) || unique.includes(layer)) {
      continue;
    }
    unique.push(layer);
  }

  return unique.length > 0 ? unique : [...ANALYSIS_CONFIG.defaults.layers];
}

export function getProviderModels(provider) {
  const safeProvider = Object.values(ANALYSIS_PROVIDERS).includes(provider)
    ? provider
    : ANALYSIS_CONFIG.provider;

  return PROVIDER_MODEL_MAP[safeProvider] || PROVIDER_MODEL_MAP[ANALYSIS_CONFIG.provider];
}

export function resolveProviderModel(provider, requestedModel) {
  const modelPool = getProviderModels(provider);
  const normalizedRequested = String(requestedModel || '').trim();

  // Accept explicit model IDs from project router settings (proxy/direct custom lists).
  if (normalizedRequested) {
    return normalizedRequested;
  }

  return modelPool[0] || ANALYSIS_MODELS.context_pro;
}

export function resolveAnalysisConfig(input = {}) {
  const runMode = getRunMode(input.runMode || input.mode || ANALYSIS_CONFIG.defaults.runMode);
  const provider = Object.values(ANALYSIS_PROVIDERS).includes(input.provider)
    ? input.provider
    : ANALYSIS_CONFIG.provider;

  const model = resolveProviderModel(provider, input.model);

  const chunkSize = Math.max(
    1000,
    Math.min(
      ANALYSIS_CONFIG.session.maxInputWords,
      Number(input.chunkSize) || ANALYSIS_CONFIG.defaults.chunkSize,
    ),
  );

  const chunkOverlap = Math.max(
    0,
    Math.min(
      Math.floor(chunkSize / 2),
      Number(input.chunkOverlap) || ANALYSIS_CONFIG.defaults.chunkOverlap,
    ),
  );

  const temperature = Math.max(
    0,
    Math.min(1, Number(input.temperature) || ANALYSIS_CONFIG.defaults.temperature),
  );

  const maxParts = Math.max(
    1,
    Math.min(12, Number(input.maxParts) || ANALYSIS_CONFIG.session.maxParts),
  );

  return {
    runMode: runMode.id,
    provider,
    model,
    chunkSize,
    chunkOverlap,
    temperature,
    layers: resolveLayers(input.layers),
    maxParts,
  };
}

export function estimateAnalysisTime({ wordCount = 0, maxParts = 3, chunkSize } = {}) {
  const safeWords = Math.max(0, Number(wordCount) || 0);
  const safeChunkSize = Math.max(
    1000,
    Math.min(
      ANALYSIS_CONFIG.session.maxInputWords,
      Number(chunkSize) || ANALYSIS_CONFIG.defaults.chunkSize,
    ),
  );
  const chunks = Math.max(1, Math.ceil(safeWords / safeChunkSize));
  const expectedParts = Math.max(1, Math.min(6, Number(maxParts) || 3));
  const avgSecondsPerPart = 12;
  const totalSeconds = chunks * expectedParts * avgSecondsPerPart;
  const minutes = Math.max(1, Math.ceil(totalSeconds / 60));

  return {
    estimatedSeconds: totalSeconds,
    estimatedMinutes: minutes,
    estimatedLabel: `${minutes} phút`,
  };
}
