import keyManager from './keyManager.js';
import {
  CUSTOM_PROXY_PROFILE_ID,
  getDefaultCustomOpenAIProxyProfile,
  getOpenAIProxySettings,
  updateCustomOpenAIProxyProfile,
} from './openAIProxyConfig.js';

export const CUSTOM_OPENAI_PROXY_PRESETS_STORAGE_KEY = 'sf-custom-openai-proxy-presets-v1';
export const CUSTOM_OPENAI_PROXY_PRESETS_CHANGED_EVENT = 'storyforge:custom-openai-proxy-presets-changed';

const EMPTY_STATE = Object.freeze({
  activePresetId: '',
  presets: [],
});

function getStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function trimText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeModels(models = []) {
  return [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => trimText(model, 300))
      .filter(Boolean),
  )];
}

function normalizeProfile(profile = {}) {
  const defaults = getDefaultCustomOpenAIProxyProfile();
  return {
    ...defaults,
    ...profile,
    id: CUSTOM_PROXY_PROFILE_ID,
    label: trimText(profile.label || defaults.label, 80) || defaults.label,
    baseUrl: trimText(profile.baseUrl, 2000),
    defaultModel: trimText(profile.defaultModel, 300),
    models: normalizeModels(profile.models),
    chatCompletionsPath: trimText(profile.chatCompletionsPath || defaults.chatCompletionsPath, 500)
      || defaults.chatCompletionsPath,
    imageGenerationsPath: trimText(profile.imageGenerationsPath || defaults.imageGenerationsPath, 500)
      || defaults.imageGenerationsPath,
    modelsPath: trimText(profile.modelsPath || defaults.modelsPath, 500) || defaults.modelsPath,
    modelCatalogSource: trimText(profile.modelCatalogSource || defaults.modelCatalogSource, 100)
      || defaults.modelCatalogSource,
    authType: trimText(profile.authType || defaults.authType, 100) || defaults.authType,
    requiresApiKey: profile.requiresApiKey !== false,
    supportsGeminiSafetySettings: Boolean(profile.supportsGeminiSafetySettings),
    transport: trimText(profile.transport || defaults.transport, 50) || defaults.transport,
  };
}

function normalizeKeys(keys = []) {
  const seen = new Set();
  const normalized = [];
  for (const rawEntry of Array.isArray(keys) ? keys : []) {
    const key = trimText(typeof rawEntry === 'string' ? rawEntry : rawEntry?.key, 8000);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      key,
      label: trimText(typeof rawEntry === 'string' ? '' : rawEntry?.label, 80)
        || `Key ${normalized.length + 1}`,
    });
  }
  return normalized;
}

function normalizePreset(rawPreset = {}) {
  const id = trimText(rawPreset.id, 120);
  if (!id) return null;
  const profile = normalizeProfile(rawPreset.profile);
  const createdAt = Number(rawPreset.createdAt) || Date.now();
  return {
    id,
    label: trimText(rawPreset.label || profile.label, 80) || 'Custom Proxy',
    profile,
    keys: normalizeKeys(rawPreset.keys),
    createdAt,
    updatedAt: Number(rawPreset.updatedAt) || createdAt,
  };
}

function cloneState(state) {
  return {
    activePresetId: state.activePresetId,
    presets: state.presets.map((preset) => ({
      ...preset,
      profile: { ...preset.profile, models: [...preset.profile.models] },
      keys: preset.keys.map((entry) => ({ ...entry })),
    })),
  };
}

function createPresetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `custom-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dispatchChanged(state) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(CUSTOM_OPENAI_PROXY_PRESETS_CHANGED_EVENT, {
      detail: { activePresetId: state.activePresetId, count: state.presets.length },
    }));
  } catch {
    // Local persistence must still work when CustomEvent is unavailable.
  }
}

function writeState(state) {
  const storage = getStorage();
  const normalized = {
    activePresetId: trimText(state.activePresetId, 120),
    presets: (Array.isArray(state.presets) ? state.presets : [])
      .map(normalizePreset)
      .filter(Boolean),
  };
  storage?.setItem(CUSTOM_OPENAI_PROXY_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
  dispatchChanged(normalized);
  return cloneState(normalized);
}

export function getCustomOpenAIProxyPresetState() {
  const storage = getStorage();
  if (!storage) return cloneState(EMPTY_STATE);
  try {
    const raw = JSON.parse(storage.getItem(CUSTOM_OPENAI_PROXY_PRESETS_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return cloneState(EMPTY_STATE);
    const presets = (Array.isArray(raw.presets) ? raw.presets : [])
      .map(normalizePreset)
      .filter(Boolean);
    const ids = new Set(presets.map((preset) => preset.id));
    return cloneState({
      activePresetId: ids.has(trimText(raw.activePresetId, 120))
        ? trimText(raw.activePresetId, 120)
        : '',
      presets,
    });
  } catch {
    return cloneState(EMPTY_STATE);
  }
}

export function getSuggestedCustomOpenAIProxyPresetName(profile = getOpenAIProxySettings().customProfile) {
  const label = trimText(profile?.label, 80);
  if (label && label !== getDefaultCustomOpenAIProxyProfile().label) return label;
  try {
    return new URL(trimText(profile?.baseUrl, 2000)).host || 'Custom Proxy';
  } catch {
    return label || 'Custom Proxy';
  }
}

export function saveCurrentCustomOpenAIProxyPreset({ id = '', label = '' } = {}) {
  const state = getCustomOpenAIProxyPresetState();
  const presetId = trimText(id, 120) || createPresetId();
  const existing = state.presets.find((preset) => preset.id === presetId);
  const profile = normalizeProfile(getOpenAIProxySettings().customProfile);
  const now = Date.now();
  const preset = normalizePreset({
    id: presetId,
    label: trimText(label, 80) || existing?.label || getSuggestedCustomOpenAIProxyPresetName(profile),
    profile,
    keys: keyManager.getKeys('openai_proxy'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  const nextState = writeState({
    activePresetId: preset.id,
    presets: [preset, ...state.presets.filter((item) => item.id !== preset.id)],
  });
  return nextState.presets.find((item) => item.id === preset.id);
}

export function activateCustomOpenAIProxyPreset(presetId) {
  const state = getCustomOpenAIProxyPresetState();
  const normalizedId = trimText(presetId, 120);
  const preset = state.presets.find((item) => item.id === normalizedId);
  if (!preset) throw new Error('Không tìm thấy bộ Custom Proxy đã lưu.');

  const previousProfile = getOpenAIProxySettings().customProfile;
  const previousKeys = keyManager.getKeys('openai_proxy').map((entry) => ({ ...entry }));
  try {
    keyManager.replaceKeys('openai_proxy', preset.keys);
    const profile = updateCustomOpenAIProxyProfile(preset.profile);
    writeState({ ...state, activePresetId: preset.id });
    return {
      preset: normalizePreset(preset),
      profile,
      keys: keyManager.getKeys('openai_proxy').map((entry) => ({ ...entry })),
    };
  } catch (error) {
    keyManager.replaceKeys('openai_proxy', previousKeys);
    updateCustomOpenAIProxyProfile(previousProfile);
    throw error;
  }
}

export function removeCustomOpenAIProxyPreset(presetId) {
  const state = getCustomOpenAIProxyPresetState();
  const normalizedId = trimText(presetId, 120);
  if (!state.presets.some((preset) => preset.id === normalizedId)) return false;
  writeState({
    activePresetId: state.activePresetId === normalizedId ? '' : state.activePresetId,
    presets: state.presets.filter((preset) => preset.id !== normalizedId),
  });
  return true;
}

function getComparableSnapshot(profile, keys) {
  return JSON.stringify({
    profile: normalizeProfile(profile),
    keys: normalizeKeys(keys),
  });
}

export function isCurrentCustomOpenAIProxyPresetDirty() {
  const state = getCustomOpenAIProxyPresetState();
  const currentProfile = getOpenAIProxySettings().customProfile;
  const currentKeys = keyManager.getKeys('openai_proxy');
  const activePreset = state.presets.find((preset) => preset.id === state.activePresetId);
  if (!activePreset) {
    return Boolean(trimText(currentProfile?.baseUrl) || currentKeys.length > 0);
  }
  return getComparableSnapshot(currentProfile, currentKeys)
    !== getComparableSnapshot(activePreset.profile, activePreset.keys);
}
