/**
 * StoryForge — Model Router v2
 * 
 * User chọn 1 PROVIDER dùng tại 1 thời điểm:
 *   - gemini_proxy: 星星公益站 (keys riêng, models proxy 真流)
 *   - gemini_direct: Google AI Studio (keys riêng, free tier)
 *   - ollama: Local (không cần key)
 */

// --- Providers ---
export const PROVIDERS = {
  GEMINI_PROXY: 'gemini_proxy',
  GEMINI_DIRECT: 'gemini_direct',
  OLLAMA: 'ollama',
};

// --- Gemini Direct: Free-tier models (ID thực từ ListModels) ---
export const DIRECT_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', rpm: 5, rpd: 20, default: true },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', rpm: 5, rpd: 20, default: true },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview', rpm: 15, rpd: 500, default: true },
];

// --- Gemini Proxy: 星星 真流 models ---
export const PROXY_MODELS = [
  { id: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]', label: '2.5 Flash', tier: 'flash' },
  { id: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]', label: '3 Flash High', tier: 'flash' },
  { id: 'gemini-3-flash-medium-真流-[星星公益站-CLI渠道]', label: '3 Flash Medium', tier: 'flash' },
  { id: 'gemini-3-flash-preview-真流-[星星公益站-CLI渠道]', label: '3 Flash Preview', tier: 'flash' },
  { id: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]', label: '2.5 Pro', tier: 'pro' },
  { id: 'gemini-3-pro-high-真流-[星星公益站-CLI渠道]', label: '3 Pro High', tier: 'pro' },
  { id: 'gemini-3-pro-low-真流-[星星公益站-CLI渠道]', label: '3 Pro Low', tier: 'pro' },
  // Gemini 3.1 Pro Models
  { id: 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]', label: '3.1 Pro High', tier: 'pro' },
  { id: 'gemini-3.1-pro-low-真流-[星星公益站-CLI渠道]', label: '3.1 Pro Low', tier: 'pro' },
  { id: 'gemini-3.1-pro-high-假流-[星星公益站-CLI渠道]', label: '3.1 Pro High (Fake Stream)', tier: 'pro' },
  { id: 'gemini-3.1-pro-low-假流-[星星公益站-CLI渠道]', label: '3.1 Pro Low (Fake Stream)', tier: 'pro' },
  { id: 'gemini-3.1-pro-high-search-真流-[星星公益站-CLI渠道]', label: '3.1 Pro High Search', tier: 'pro' },
  { id: 'gemini-3.1-pro-low-search-真流-[星星公益站-CLI渠道]', label: '3.1 Pro Low Search', tier: 'pro' },
  { id: 'gemini-3.1-pro-high-search-假流-[星星公益站-CLI渠道]', label: '3.1 Pro High Search (Fake Stream)', tier: 'pro' },
  { id: 'gemini-3.1-pro-low-search-假流-[星星公益站-CLI渠道]', label: '3.1 Pro Low Search (Fake Stream)', tier: 'pro' },
];

// --- Task Types ---
export const TASK_TYPES = {
  BRAINSTORM: 'brainstorm',
  OUTLINE: 'outline',
  SCENE_DRAFT: 'scene_draft',
  CONTINUE: 'continue',
  EXPAND: 'expand',
  REWRITE: 'rewrite',
  SUMMARIZE: 'summarize',
  CONTINUITY_CHECK: 'continuity_check',
  EXTRACT_TERMS: 'extract_terms',
  PLOT_SUGGEST: 'plot_suggest',
  STYLE_ANALYZE: 'style_analyze',
  STYLE_WRITE: 'style_write',
  QA_CHECK: 'qa_check',
  CHECK_CONFLICT: 'check_conflict',
  FREE_PROMPT: 'free_prompt',
  // Phase 3 — Memory
  CHAPTER_SUMMARY: 'chapter_summary',
  FEEDBACK_EXTRACT: 'feedback_extract',
  // AI Enhancement
  AI_GENERATE_ENTITY: 'ai_generate_entity',
  PROJECT_WIZARD: 'project_wizard',
  // Phase A — Suggestion Inbox
  SUGGEST_UPDATES: 'suggest_updates',
  CANON_EXTRACT_OPS: 'canon_extract_ops',
  CANON_REPAIR: 'canon_repair',
  // Phase 5 — AI Auto Generation
  ARC_OUTLINE: 'arc_outline',
  ARC_CHAPTER_DRAFT: 'arc_chapter_draft',
  // Phase 9 — Grand Strategy
  // GENERATE_MACRO_MILESTONES: AI gợi ý 5-8 cột mốc từ ý tưởng của tác giả
  // AUDIT_ARC_ALIGNMENT: Kiểm tra độ lệch của arc hiện tại so với đại cục
  GENERATE_MACRO_MILESTONES: 'generate_macro_milestones',
  AUDIT_ARC_ALIGNMENT: 'audit_arc_alignment',
};

// --- Quality Modes ---
export const QUALITY_MODES = {
  FAST: 'fast',
  BALANCED: 'balanced',
  BEST: 'best',
};

// ─── Direct: quality → model ───
// fast     = gemini-3.1-flash-lite-preview  (15 RPM, 500 RPD — lightest, highest quota)
// balanced = gemini-2.5-flash               (5 RPM, 20 RPD — proven, reliable)
// best     = gemini-3-flash-preview         (5 RPM, 20 RPD — newest gen, highest quality)
const DIRECT_QUALITY_MAP = {
  fast: 'gemini-3.1-flash-lite-preview',
  balanced: 'gemini-2.5-flash',
  best: 'gemini-3-flash-preview',
};

// ─── Proxy: task-specific model mapping ───
const PROXY_DEFAULT = {
  fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
  balanced: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
};

const PROXY_TASK_MAP = {
  scene_draft: {
    fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  continue: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  rewrite: {
    fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  expand: {
    fast: 'gemini-3-flash-medium-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  summarize: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  extract_terms: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  chapter_summary: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  feedback_extract: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  ai_generate_entity: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  project_wizard: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  suggest_updates: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    best: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  },
  canon_extract_ops: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  canon_repair: {
    fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  arc_outline: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  arc_chapter_draft: {
    fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  check_conflict: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  free_prompt: {
    fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  // Phase 9 — Grand Strategy
  // generate_macro_milestones: Planning task — dùng pro để output có chiều sâu
  generate_macro_milestones: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
  // audit_arc_alignment: Analysis task — cần pro để phân tích độ lệch chính xác
  audit_arc_alignment: {
    fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
    balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
    best: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  },
};

// ─── Active Direct models (user can manage) ───
const ACTIVE_MODELS_KEY = 'sf-active-direct-models';

function getActiveDirectModels() {
  try {
    const saved = localStorage.getItem(ACTIVE_MODELS_KEY);
    if (saved) return JSON.parse(saved);
  } catch { }
  return DIRECT_MODELS.filter(m => m.default).map(m => ({ id: m.id, rpm: m.rpm }));
}

function setActiveDirectModels(models) {
  localStorage.setItem(ACTIVE_MODELS_KEY, JSON.stringify(models));
}

// ─── Router ───
class ModelRouter {
  constructor() {
    this.qualityMode = localStorage.getItem('sf-quality-mode') || QUALITY_MODES.BALANCED;
    this.preferredProvider = localStorage.getItem('sf-preferred-provider') || PROVIDERS.GEMINI_PROXY;
    this.ollamaModel = localStorage.getItem('sf-ollama-model') || '';
  }

  setQualityMode(mode) {
    this.qualityMode = mode;
    localStorage.setItem('sf-quality-mode', mode);
  }

  setPreferredProvider(provider) {
    this.preferredProvider = provider;
    localStorage.setItem('sf-preferred-provider', provider);
  }

  setOllamaModel(model) {
    this.ollamaModel = model;
    localStorage.setItem('sf-ollama-model', model);
  }

  getActiveDirectModels() { return getActiveDirectModels(); }
  setActiveDirectModels(models) { setActiveDirectModels(models); }

  route(taskType, options = {}) {
    const { qualityOverride, providerOverride, modelOverride } = options;

    if (modelOverride) {
      let provider = providerOverride || PROVIDERS.GEMINI_PROXY;
      if (!providerOverride) {
        if (!modelOverride.includes('[')) provider = PROVIDERS.GEMINI_DIRECT;
        if (!modelOverride.startsWith('gemini')) provider = PROVIDERS.OLLAMA;
      }
      return { provider, model: modelOverride, tier: 'custom' };
    }

    const provider = providerOverride || this.preferredProvider;
    const quality = qualityOverride || this.qualityMode;

    if (provider === PROVIDERS.OLLAMA) {
      return { provider, model: this.ollamaModel || 'llama3', tier: 'local' };
    }

    if (provider === PROVIDERS.GEMINI_DIRECT) {
      const model = DIRECT_QUALITY_MAP[quality] || DIRECT_QUALITY_MAP.balanced;
      return { provider, model, tier: 'free' };
    }

    // Gemini Proxy
    const taskMap = PROXY_TASK_MAP[taskType] || PROXY_DEFAULT;
    const model = taskMap[quality] || PROXY_DEFAULT[quality];
    const tier = model.includes('pro') ? 'pro' : 'flash';
    return { provider, model, tier };
  }

  getFallbacks(primaryRoute) {
    const fallbacks = [];
    const p = primaryRoute.provider;

    if (p === PROVIDERS.GEMINI_DIRECT) {
      fallbacks.push({ provider: PROVIDERS.GEMINI_DIRECT, model: 'gemini-3.1-flash-lite-preview', tier: 'free' });
    }
    if (this.ollamaModel) {
      fallbacks.push({ provider: PROVIDERS.OLLAMA, model: this.ollamaModel, tier: 'local' });
    }
    return fallbacks;
  }

  getQualityMode() { return this.qualityMode; }
  getPreferredProvider() { return this.preferredProvider; }
}

const modelRouter = new ModelRouter();
export default modelRouter;
