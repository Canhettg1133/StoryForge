import modelRouter, {
  AI_STUDIO_RELAY_MODELS,
  PROXY_MODELS,
  PROXY_MODEL_PRESETS,
  PROVIDERS,
} from './router.js';
import {
  AG_PROXY_PROFILE_ID,
  getActiveOpenAIProxyProfile,
  getOpenAIProxyModel,
  groupProxyModelsForDisplay,
  normalizeOpenAIProxyProvider,
} from './openAIProxyConfig.js';

const OLLAMA_MODEL_CATALOG_KEY = 'sf-ollama-model-catalog';

function normalizeModelList(models = []) {
  return [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => String(model || '').trim())
      .filter(Boolean),
  )];
}

function getProxyModelOption(model, profile, classification = null) {
  const preset = profile.id === AG_PROXY_PROFILE_ID
    ? PROXY_MODEL_PRESETS.find((item) => item.id === model)
      || PROXY_MODELS.find((item) => item.id === model)
    : null;
  const family = classification?.family || '';
  const channel = classification?.channel || '';
  const confidence = classification?.confidence || 'high';
  return {
    id: model,
    label: preset?.label || model,
    meta: preset
      ? (preset.tier === 'pro' ? 'Proxy - Pro' : 'Proxy - Flash')
      : [channel, family].filter(Boolean).join(' - ') || (profile?.label || 'Proxy - fetched'),
    providerProfileId: profile.id,
    channel,
    family,
    confidence,
  };
}

function getGroupedProxyModelOptions(modelIds, profile) {
  return groupProxyModelsForDisplay(modelIds, {
    profileId: profile.id,
    profileLabel: profile.label,
  }).flatMap((group) => group.models.map((model) => getProxyModelOption(model.id, profile, model)));
}

function getAgProxyModelOptions(profile) {
  const fetchedModels = normalizeModelList(Array.isArray(profile.models) ? profile.models : []);
  const presetModels = PROXY_MODEL_PRESETS.map((model) => model.id);
  const currentModel = getOpenAIProxyModel(profile, '');
  const modelIds = fetchedModels.length > 0
    ? normalizeModelList([currentModel, ...fetchedModels])
    : normalizeModelList([
      ...(currentModel && !presetModels.includes(currentModel) ? [currentModel] : []),
      ...presetModels,
    ]);

  return getGroupedProxyModelOptions(modelIds, profile);
}

export function getOllamaModelCatalog() {
  try {
    return normalizeModelList(JSON.parse(localStorage.getItem(OLLAMA_MODEL_CATALOG_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function setOllamaModelCatalog(models = []) {
  const normalized = normalizeModelList(models);
  localStorage.setItem(OLLAMA_MODEL_CATALOG_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getAvailableModelOptions(provider, {
  proxyProfileId = '',
  ollamaModels = getOllamaModelCatalog(),
} = {}) {
  const normalizedProvider = normalizeOpenAIProxyProvider(provider);

  if (normalizedProvider === PROVIDERS.OPENAI_PROXY) {
    const profile = getActiveOpenAIProxyProfile(proxyProfileId || null);
    if (profile.id === AG_PROXY_PROFILE_ID) {
      return getAgProxyModelOptions(profile);
    }

    const models = normalizeModelList([
      getOpenAIProxyModel(profile, ''),
      ...(Array.isArray(profile.models) ? profile.models : []),
    ]);

    return getGroupedProxyModelOptions(models, profile);
  }

  if (normalizedProvider === PROVIDERS.AI_STUDIO_RELAY) {
    return AI_STUDIO_RELAY_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      meta: 'AI Studio Relay',
    }));
  }

  if (normalizedProvider === PROVIDERS.GEMINI_DIRECT) {
    const currentModel = modelRouter.getDirectModel();
    const catalog = modelRouter.getDirectModelCatalog();
    const catalogIds = new Set(catalog.map((model) => model.id));
    const models = [
      ...(!catalogIds.has(currentModel) ? [{
        id: currentModel,
        label: currentModel,
        source: 'manual',
      }] : []),
      ...catalog,
    ];
    return models
      .map((model) => ({
        id: model.id,
        label: model.label,
        meta: model.source === 'fetched'
          ? 'Đã lấy từ AI Studio'
          : model.source === 'preset'
            ? 'Preset StoryForge'
            : 'Nhập thủ công · chưa xác minh',
      }));
  }

  if (normalizedProvider === PROVIDERS.OLLAMA) {
    const currentModel = localStorage.getItem('sf-ollama-model') || 'llama3';
    return normalizeModelList([currentModel, ...ollamaModels]).map((model) => ({
      id: model,
      label: model,
      meta: model === currentModel ? 'Model local hiện tại' : 'Model local đã cài',
    }));
  }

  return [];
}
