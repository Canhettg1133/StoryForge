import {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
  DEFAULT_AG_PROXY_BASE_URL,
  DEFAULT_AG_PROXY_MODEL,
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  filterGeminiModelIds,
  parseOpenAIModelIds,
  resolveProxyTransportMode,
} from './openAIProxyCore.js';

const SETTINGS_KEY = 'sf-ai-settings';
const PROXY_MODEL_KEY = 'sf-proxy-model';
const AG_PROXY_MODELS_KEY = 'sf-ag-proxy-models';
const AG_PROXY_MODEL_META_KEY = 'sf-ag-proxy-model-meta';
const ACCIDENTAL_AG_PROXY_PRO_DEFAULT = 'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]';

function readSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

function trimText(value) {
  return String(value || '').trim();
}

function normalizeStoredModelList(models = []) {
  return [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => trimText(model))
      .filter(Boolean),
  )];
}

function readJsonStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function isLegacyAgProxyUrl(value) {
  const normalized = trimText(value).replace(/\/+$/u, '');
  return !normalized
    || normalized === DEFAULT_AG_PROXY_BASE_URL
    || normalized === 'https://ag.beijixingxing.com'
    || normalized === 'https://ag.beijixingxing.com/v1'
    || normalized.startsWith('https://ag.beijixingxing.com/v1/');
}

export function normalizeOpenAIProxyProvider(provider) {
  return provider === 'gemini_proxy' ? 'openai_proxy' : provider;
}

export function getAgProxyModel() {
  try {
    const saved = trimText(localStorage.getItem(PROXY_MODEL_KEY));
    if (saved === ACCIDENTAL_AG_PROXY_PRO_DEFAULT) {
      const meta = readJsonStorage(AG_PROXY_MODEL_META_KEY, {});
      if (trimText(meta?.manualModel) === saved) return saved;

      localStorage.setItem(PROXY_MODEL_KEY, DEFAULT_AG_PROXY_MODEL);
      return DEFAULT_AG_PROXY_MODEL;
    }
    return saved || DEFAULT_AG_PROXY_MODEL;
  } catch {
    return DEFAULT_AG_PROXY_MODEL;
  }
}

export function setAgProxyModel(model) {
  const normalized = trimText(model) || DEFAULT_AG_PROXY_MODEL;
  localStorage.setItem(PROXY_MODEL_KEY, normalized);
  localStorage.setItem(AG_PROXY_MODEL_META_KEY, JSON.stringify({ manualModel: normalized }));
  return normalized;
}

export function getAgProxyModels() {
  return normalizeStoredModelList(readJsonStorage(AG_PROXY_MODELS_KEY, []));
}

export function setAgProxyModels(models = []) {
  const normalized = normalizeStoredModelList(models);
  localStorage.setItem(AG_PROXY_MODELS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getDefaultCustomOpenAIProxyProfile() {
  return {
    id: CUSTOM_PROXY_PROFILE_ID,
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    defaultModel: '',
    models: [],
    chatCompletionsPath: DEFAULT_PROXY_CHAT_PATH,
    modelsPath: DEFAULT_PROXY_MODELS_PATH,
    authType: 'bearer',
    requiresApiKey: true,
    supportsGeminiSafetySettings: false,
    transport: 'auto',
  };
}

export function getAgOpenAIProxyProfile() {
  return {
    id: AG_PROXY_PROFILE_ID,
    label: 'Gemini Proxy mac dinh',
    baseUrl: DEFAULT_AG_PROXY_BASE_URL,
    defaultModel: getAgProxyModel(),
    models: getAgProxyModels(),
    chatCompletionsPath: DEFAULT_PROXY_CHAT_PATH,
    modelsPath: DEFAULT_PROXY_MODELS_PATH,
    authType: 'bearer',
    requiresApiKey: true,
    supportsGeminiSafetySettings: true,
    transport: 'vercelRewrite',
  };
}

export function getOpenAIProxySettings() {
  const settings = readSettings();
  const saved = settings.openAIProxy || {};
  const legacyProxyUrl = trimText(settings.proxyUrl);
  const shouldMigrateLegacyCustomUrl = !saved.customProfile
    && legacyProxyUrl
    && !isLegacyAgProxyUrl(legacyProxyUrl);
  const customProfile = {
    ...getDefaultCustomOpenAIProxyProfile(),
    ...(shouldMigrateLegacyCustomUrl ? { baseUrl: legacyProxyUrl } : {}),
    ...(saved.customProfile || {}),
  };
  const activeProfileId = saved.activeProfileId === CUSTOM_PROXY_PROFILE_ID || shouldMigrateLegacyCustomUrl
    ? CUSTOM_PROXY_PROFILE_ID
    : AG_PROXY_PROFILE_ID;

  return {
    activeProfileId,
    customProfile,
  };
}

export function saveOpenAIProxySettings(patch = {}) {
  const settings = readSettings();
  const current = getOpenAIProxySettings();
  const next = {
    ...current,
    ...patch,
    customProfile: {
      ...current.customProfile,
      ...(patch.customProfile || {}),
    },
  };

  writeSettings({
    ...settings,
    openAIProxy: next,
    proxyUrl: next.activeProfileId === AG_PROXY_PROFILE_ID
      ? DEFAULT_AG_PROXY_BASE_URL
      : next.customProfile.baseUrl,
  });
  return next;
}

export function setOpenAIProxyActiveProfile(profileId) {
  return saveOpenAIProxySettings({
    activeProfileId: profileId === CUSTOM_PROXY_PROFILE_ID
      ? CUSTOM_PROXY_PROFILE_ID
      : AG_PROXY_PROFILE_ID,
  });
}

export function updateCustomOpenAIProxyProfile(patch = {}) {
  return saveOpenAIProxySettings({
    activeProfileId: CUSTOM_PROXY_PROFILE_ID,
    customProfile: patch,
  }).customProfile;
}

export function getActiveOpenAIProxyProfile(profileId = null) {
  const settings = getOpenAIProxySettings();
  const activeProfileId = profileId || settings.activeProfileId;
  if (activeProfileId === CUSTOM_PROXY_PROFILE_ID) {
    return {
      ...settings.customProfile,
      id: CUSTOM_PROXY_PROFILE_ID,
      label: settings.customProfile.label || 'Custom OpenAI-compatible',
    };
  }
  return getAgOpenAIProxyProfile();
}

export function getOpenAIProxyModel(profile = getActiveOpenAIProxyProfile(), fallback = DEFAULT_AG_PROXY_MODEL) {
  return trimText(profile?.defaultModel) || fallback;
}

export function getOpenAIProxyKeyProvider(profileOrId = getActiveOpenAIProxyProfile()) {
  const profileId = typeof profileOrId === 'string'
    ? profileOrId
    : profileOrId?.id;
  return profileId === AG_PROXY_PROFILE_ID ? 'gemini_proxy' : 'openai_proxy';
}

export function resolveOpenAIProxyRequest(profile, action) {
  const mode = resolveProxyTransportMode(profile);
  const path = action === 'models'
    ? (profile.modelsPath || DEFAULT_PROXY_MODELS_PATH)
    : (profile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH);

  if (mode === 'relay') {
    return {
      mode,
      url: '/api/openai-proxy',
      path,
    };
  }

  return {
    mode,
    url: buildOpenAIProxyEndpoint(profile.baseUrl, path),
    path,
  };
}

export function resolveOpenAIProxyDirectRequest(profile, action) {
  const path = action === 'models'
    ? (profile.modelsPath || DEFAULT_PROXY_MODELS_PATH)
    : (profile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH);
  return {
    mode: 'direct',
    url: buildOpenAIProxyEndpoint(profile.baseUrl, path),
    path,
  };
}

export function shouldFallbackOpenAIProxyRelay(response) {
  if (!response) return false;
  if (response.status === 404 || response.status === 405) return true;
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  return response.ok && contentType.includes('text/html');
}

export async function fetchOpenAIProxyModels({ profile = getActiveOpenAIProxyProfile(), apiKey = '', signal } = {}) {
  const target = resolveOpenAIProxyRequest(profile, 'models');
  const authHeader = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  let response = target.mode === 'relay'
    ? await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify({
        action: 'models',
        baseUrl: profile.baseUrl,
        modelsPath: profile.modelsPath || DEFAULT_PROXY_MODELS_PATH,
      }),
      signal,
    })
    : await fetch(target.url, {
      method: 'GET',
      headers: authHeader,
      signal,
    });

  if (target.mode === 'relay' && shouldFallbackOpenAIProxyRelay(response)) {
    const directTarget = resolveOpenAIProxyDirectRequest(profile, 'models');
    response = await fetch(directTarget.url, {
      method: 'GET',
      headers: authHeader,
      signal,
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Model list failed with status ${response.status}`);
  }

  return parseOpenAIModelIds(await response.json());
}

export {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
  DEFAULT_AG_PROXY_BASE_URL,
  DEFAULT_AG_PROXY_MODEL,
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  filterGeminiModelIds,
  parseOpenAIModelIds,
  resolveProxyTransportMode,
};
