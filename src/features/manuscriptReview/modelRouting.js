import { getChapterCompletionModelState } from '../../services/ai/chapterCompletionModelRouting.js';
import { getActiveOpenAIProxyProfile } from '../../services/ai/openAIProxyConfig.js';
import { getOllamaModelCatalog } from '../../services/ai/modelOptions.js';

export const REVIEW_MODEL_PREFERENCE_KEY = 'sf-manuscript-review-model-preferences';
export const REVIEW_MODEL_CHANGE_EVENT = 'sf-manuscript-review-model-change';

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY) || '{}');
    if (value?.version === 1 && value.scopes && typeof value.scopes === 'object' && !Array.isArray(value.scopes)) return value;
  } catch { /* A damaged preference must ask again, not change another feature's setting. */ }
  return { version: 1, scopes: {} };
}

export function getManuscriptReviewModelState(options = {}) {
  const base = getChapterCompletionModelState(options);
  const stored = readPreferences().scopes[base.scopeKey];
  const storedModel = typeof stored?.model === 'string' ? stored.model : '';
  // The shared picker includes the global model even after uninstall. A known catalog is authoritative here.
  const catalog = base.provider === 'ollama'
    ? options.ollamaModels ?? (localStorage.getItem('sf-ollama-model-catalog') !== null ? getOllamaModelCatalog() : null)
    : null;
  const availableOptions = catalog === null ? base.options : base.options.filter((option) => catalog.includes(option.id));
  const effectiveModel = storedModel || base.currentModel;
  const connected = base.provider !== 'openai_proxy' || Boolean(getActiveOpenAIProxyProfile(base.proxyProfileId).baseUrl);
  const valid = connected && Boolean(effectiveModel) && availableOptions.some((option) => option.id === effectiveModel);
  const suggested = base.routeOptions.modelOverride || '';
  const selectedModel = stored
    ? (valid ? storedModel : '')
    : (availableOptions.some((option) => option.id === suggested) ? suggested : '');
  const prompted = Boolean(stored?.prompted) && valid && typeof stored?.model === 'string';
  return {
    ...base,
    options: availableOptions,
    selectedModel,
    prompted,
    shouldPrompt: !prompted,
    suggestedFromCompletion: !stored && Boolean(selectedModel),
    routeOptions: { ...base.routeOptions, modelOverride: selectedModel || base.currentModel },
  };
}

export function saveManuscriptReviewModelPreference({ provider, proxyProfileId = '', model = '' }) {
  const preferences = readPreferences();
  const scopeKey = provider === 'openai_proxy' ? `${provider}:${proxyProfileId}` : provider;
  preferences.scopes[scopeKey] = { model: String(model || '').trim(), prompted: true };
  try {
    localStorage.setItem(REVIEW_MODEL_PREFERENCE_KEY, JSON.stringify(preferences));
  } catch {
    throw new Error('Không lưu được model phân tích. Kiểm tra dung lượng lưu trữ của trình duyệt.');
  }
  window.dispatchEvent(new Event(REVIEW_MODEL_CHANGE_EVENT));
}
