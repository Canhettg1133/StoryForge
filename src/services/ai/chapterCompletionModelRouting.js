import modelRouter, { PROVIDERS, TASK_TYPES } from './router.js';
import {
  AG_PROXY_PROFILE_ID,
  getActiveOpenAIProxyProfile,
} from './openAIProxyConfig.js';
import { getAvailableModelOptions } from './modelOptions.js';

export const CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY = 'sf-chapter-completion-model-preferences';

const PREFERENCE_VERSION = 1;

function readPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY) || '{}');
    if (parsed?.version !== PREFERENCE_VERSION || !parsed.scopes || typeof parsed.scopes !== 'object') {
      return { version: PREFERENCE_VERSION, scopes: {} };
    }
    return parsed;
  } catch {
    return { version: PREFERENCE_VERSION, scopes: {} };
  }
}

function getScopeKey(provider, proxyProfileId = '') {
  return provider === PROVIDERS.OPENAI_PROXY
    ? `${provider}:${proxyProfileId || AG_PROXY_PROFILE_ID}`
    : provider;
}

function getProviderLabel(provider, proxyProfileId = '') {
  if (provider === PROVIDERS.OPENAI_PROXY) {
    return getActiveOpenAIProxyProfile(proxyProfileId || null).label;
  }
  if (provider === PROVIDERS.GEMINI_DIRECT) return 'Gemini Direct';
  if (provider === PROVIDERS.AI_STUDIO_RELAY) return 'AI Studio Relay';
  if (provider === PROVIDERS.OLLAMA) return 'Ollama';
  return provider;
}

export function saveChapterCompletionModelPreference({
  provider,
  proxyProfileId = '',
  model = '',
}) {
  const preferences = readPreferences();
  const scopeKey = getScopeKey(provider, proxyProfileId);
  preferences.scopes[scopeKey] = {
    model: String(model || '').trim(),
    prompted: true,
  };
  localStorage.setItem(CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY, JSON.stringify(preferences));
  return preferences.scopes[scopeKey];
}

export function getChapterCompletionModelState({ ollamaModels } = {}) {
  const currentRoute = modelRouter.route(TASK_TYPES.CHAPTER_SUMMARY);
  const provider = currentRoute.provider;
  const proxyProfileId = provider === PROVIDERS.OPENAI_PROXY
    ? (currentRoute.proxyProfileId || getActiveOpenAIProxyProfile().id)
    : '';
  const scopeKey = getScopeKey(provider, proxyProfileId);
  const stored = readPreferences().scopes[scopeKey] || null;
  const options = getAvailableModelOptions(provider, {
    proxyProfileId,
    ...(ollamaModels === undefined ? {} : { ollamaModels }),
  });
  const storedModel = String(stored?.model || '').trim();
  const storedModelIsValid = !storedModel || options.some((option) => option.id === storedModel);
  const selectedModel = storedModelIsValid ? storedModel : '';
  const prompted = Boolean(stored?.prompted) && storedModelIsValid;
  const currentModel = String(currentRoute.model || '').trim();
  const routeModel = selectedModel || currentModel;
  const routeOptions = {
    providerOverride: provider,
    ...(routeModel ? { modelOverride: routeModel } : {}),
    ...(provider === PROVIDERS.OPENAI_PROXY ? { proxyProfileId } : {}),
  };

  return {
    scopeKey,
    provider,
    providerLabel: getProviderLabel(provider, proxyProfileId),
    proxyProfileId,
    currentModel,
    selectedModel,
    options,
    prompted,
    shouldPrompt: !prompted,
    routeOptions,
  };
}

export function getChapterCompletionRouteOptions() {
  return { ...getChapterCompletionModelState().routeOptions };
}
