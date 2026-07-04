export const AG_PROXY_PROFILE_ID = 'ag-gemini-proxy';
export const CUSTOM_PROXY_PROFILE_ID = 'custom-openai-proxy';
export const DEFAULT_PROXY_CHAT_PATH = '/v1/chat/completions';
export const DEFAULT_PROXY_MODELS_PATH = '/v1/models';
export const DEFAULT_AG_PROXY_BASE_URL = 'https://ag.beijixingxing.com';
export const OPENAI_PROXY_MIXED_CONTENT_BLOCKED = 'OPENAI_PROXY_MIXED_CONTENT_BLOCKED';
export const DEFAULT_AG_PROXY_MODEL = 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]';

const KNOWN_ENDPOINT_SUFFIXES = [
  '/v1/chat/completions',
  '/chat/completions',
  '/v1/models',
  '/models',
  '/v1',
];

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function normalizePath(path, fallback) {
  const raw = String(path || fallback || '').trim();
  if (!raw) return fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function isRelativeProxyUrl(value) {
  return String(value || '').trim().startsWith('/');
}

function getCurrentPageProtocol() {
  if (typeof window !== 'undefined' && window?.location?.protocol) {
    return window.location.protocol;
  }
  if (typeof globalThis !== 'undefined' && globalThis.location?.protocol) {
    return globalThis.location.protocol;
  }
  return '';
}

function assertUsableProxyUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Cần nhập Proxy URL.');
  }
  if (/\s/u.test(trimmed)) {
    throw new Error('Proxy URL không được chứa khoảng trắng.');
  }
  if (isRelativeProxyUrl(trimmed)) return;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Proxy URL phải là URL http(s) đầy đủ hoặc đường dẫn cùng origin.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Proxy URL phải dùng http hoặc https.');
  }
}

export function getOpenAIProxyRoot(rawBaseUrl) {
  assertUsableProxyUrl(rawBaseUrl);
  let root = trimSlash(rawBaseUrl);
  const lower = root.toLowerCase();

  const suffix = KNOWN_ENDPOINT_SUFFIXES.find((item) => lower.endsWith(item));
  if (suffix) {
    root = root.slice(0, root.length - suffix.length);
  }

  return trimSlash(root) || (isRelativeProxyUrl(rawBaseUrl) ? '' : root);
}

export function buildOpenAIProxyEndpoint(rawBaseUrl, path = DEFAULT_PROXY_CHAT_PATH) {
  const safePath = normalizePath(path, DEFAULT_PROXY_CHAT_PATH);
  const root = getOpenAIProxyRoot(rawBaseUrl);
  if (!root && isRelativeProxyUrl(rawBaseUrl)) {
    return safePath;
  }
  return `${root}${safePath}`;
}

export function parseOpenAIModelIds(payload) {
  const rawModels = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload?.models) ? payload.models : []);

  return rawModels
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      return String(item?.id || item?.name || '').trim();
    })
    .filter(Boolean);
}

export function filterGeminiModelIds(models = []) {
  return [...new Set(
    models
      .map((model) => String(model || '').trim())
      .filter((model) => /\bgemini\b|gemini-/iu.test(model)),
  )];
}

const PROXY_MODEL_CHANNEL_ORDER = ['Google CLI', 'Antigravity', 'AG Proxy', 'Custom Proxy', 'Không rõ kênh'];
const PROXY_MODEL_FAMILY_ORDER = [
  'Gemini',
  'Claude',
  'OpenAI',
  'DeepSeek',
  'Kimi',
  'MiniMax',
  'Qwen',
  'Llama',
  'Mistral',
  'Grok',
  'Yi',
  'GLM',
  'Doubao/Seed',
  'Cohere',
  'AI21',
  'Databricks',
  'Code/Embedding',
  'JJ',
  'Khác',
];

function orderIndex(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function hasToken(value, token) {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'iu').test(value);
}

function normalizeModelIdForMatch(modelId) {
  return String(modelId || '').trim().toLowerCase();
}

function classifyProxyModelChannel(normalizedModelId, context = {}) {
  if (
    normalizedModelId.includes('antigravity')
    || normalizedModelId.includes('antygravity')
    || normalizedModelId.includes('反重力渠道')
    || hasToken(normalizedModelId, 'agy')
  ) {
    return 'Antigravity';
  }
  if (
    normalizedModelId.includes('cli渠道')
    || normalizedModelId.includes('cli channel')
    || normalizedModelId.includes('gcli')
  ) {
    return 'Google CLI';
  }
  if (context.profileId === AG_PROXY_PROFILE_ID) return 'AG Proxy';
  if (context.profileId === CUSTOM_PROXY_PROFILE_ID) return 'Custom Proxy';
  return 'Không rõ kênh';
}

function isKnownGoogleLikeChannel(channel) {
  return channel === 'Google CLI' || channel === 'Antigravity' || channel === 'AG Proxy';
}

function classifyProxyModelFamily(normalizedModelId, channel) {
  if (normalizedModelId.includes('anthropic/') || normalizedModelId.startsWith('claude') || normalizedModelId.includes('/claude')) {
    return { family: 'Claude', confidence: 'high' };
  }
  if (/(^|[/:._-])(sonnet|opus|haiku)([-/:._]|$)/iu.test(normalizedModelId)) {
    return { family: 'Claude', confidence: 'low' };
  }
  if (
    normalizedModelId.includes('openai/')
    || normalizedModelId.startsWith('gpt-')
    || normalizedModelId.includes('/gpt-')
    || hasToken(normalizedModelId, 'o3')
    || hasToken(normalizedModelId, 'o4')
  ) {
    return { family: 'OpenAI', confidence: 'high' };
  }
  if (normalizedModelId.includes('google/gemini') || hasToken(normalizedModelId, 'gemini')) {
    return { family: 'Gemini', confidence: 'high' };
  }
  if (normalizedModelId.includes('deepseek')) return { family: 'DeepSeek', confidence: 'high' };
  if (normalizedModelId.includes('kimi') || normalizedModelId.includes('moonshot')) return { family: 'Kimi', confidence: 'high' };
  if (normalizedModelId.includes('minimax') || normalizedModelId.includes('abab')) {
    return { family: 'MiniMax', confidence: 'high' };
  }
  if (normalizedModelId.includes('qwen')) return { family: 'Qwen', confidence: 'high' };
  if (normalizedModelId.includes('meta-llama') || normalizedModelId.includes('llama')) return { family: 'Llama', confidence: 'high' };
  if (normalizedModelId.includes('mistral') || normalizedModelId.includes('mixtral')) return { family: 'Mistral', confidence: 'high' };
  if (normalizedModelId.includes('grok') || normalizedModelId.includes('x-ai/') || normalizedModelId.includes('xai/')) return { family: 'Grok', confidence: 'high' };
  if (normalizedModelId.includes('01-ai/') || hasToken(normalizedModelId, 'yi')) return { family: 'Yi', confidence: 'high' };
  if (normalizedModelId.includes('zhipu') || hasToken(normalizedModelId, 'glm')) return { family: 'GLM', confidence: 'high' };
  if (normalizedModelId.includes('doubao') || normalizedModelId.includes('bytedance') || hasToken(normalizedModelId, 'seed')) return { family: 'Doubao/Seed', confidence: 'high' };
  if (normalizedModelId.includes('cohere') || hasToken(normalizedModelId, 'command')) return { family: 'Cohere', confidence: 'medium' };
  if (normalizedModelId.includes('ai21') || hasToken(normalizedModelId, 'jamba')) return { family: 'AI21', confidence: 'high' };
  if (normalizedModelId.includes('databricks') || hasToken(normalizedModelId, 'dbrx')) return { family: 'Databricks', confidence: 'high' };
  if (normalizedModelId.includes('starcoder') || normalizedModelId.includes('codestral') || normalizedModelId.includes('/bge-')) return { family: 'Code/Embedding', confidence: 'medium' };
  if (/(^|[/:._-])jj([/:._-]|$)/iu.test(normalizedModelId)) return { family: 'JJ', confidence: 'high' };
  if (isKnownGoogleLikeChannel(channel) && (hasToken(normalizedModelId, 'flash') || hasToken(normalizedModelId, 'pro'))) {
    return { family: 'Gemini', confidence: 'low' };
  }
  return { family: 'Khác', confidence: 'unknown' };
}

export function classifyProxyModel(modelId, context = {}) {
  const id = String(modelId || '').trim();
  const normalizedModelId = normalizeModelIdForMatch(id);
  const channel = classifyProxyModelChannel(normalizedModelId, context);
  const familyResult = classifyProxyModelFamily(normalizedModelId, channel);
  return {
    id,
    channel,
    family: familyResult.family,
    confidence: familyResult.confidence,
  };
}

export function groupProxyModelsForDisplay(models = [], context = {}) {
  const items = [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => String(model || '').trim())
      .filter(Boolean),
  )]
    .map((model) => classifyProxyModel(model, context))
    .sort((a, b) => (
      orderIndex(PROXY_MODEL_CHANNEL_ORDER, a.channel) - orderIndex(PROXY_MODEL_CHANNEL_ORDER, b.channel)
      || orderIndex(PROXY_MODEL_FAMILY_ORDER, a.family) - orderIndex(PROXY_MODEL_FAMILY_ORDER, b.family)
      || a.id.localeCompare(b.id)
    ));

  const groupsByChannel = new Map();
  items.forEach((item) => {
    if (!groupsByChannel.has(item.channel)) {
      groupsByChannel.set(item.channel, { channel: item.channel, models: [] });
    }
    groupsByChannel.get(item.channel).models.push(item);
  });

  return Array.from(groupsByChannel.values()).map((group) => {
    const familyMap = new Map();
    group.models.forEach((item) => {
      if (!familyMap.has(item.family)) {
        familyMap.set(item.family, { family: item.family, models: [] });
      }
      familyMap.get(item.family).models.push(item);
    });
    return {
      ...group,
      families: Array.from(familyMap.values()),
    };
  });
}

export function isLocalProxyHost(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.+$/u, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === '0.0.0.0') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;

  const parts = host.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    if (parts[0] >= 224) return true;
  }

  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

export function isLocalProxyUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed || isRelativeProxyUrl(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return isLocalProxyHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isPublicHttpProxyUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed || isRelativeProxyUrl(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' && !isLocalProxyHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function isMixedContentBlockedProxyUrl(rawBaseUrl, pageProtocol = getCurrentPageProtocol()) {
  return String(pageProtocol || '').toLowerCase() === 'https:'
    && isPublicHttpProxyUrl(rawBaseUrl);
}

export function upgradeMixedContentProxyUrl(rawBaseUrl, pageProtocol = getCurrentPageProtocol()) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!isMixedContentBlockedProxyUrl(trimmed, pageProtocol)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.protocol = 'https:';
    const upgraded = parsed.toString();
    return trimmed.endsWith('/') ? upgraded : upgraded.replace(/\/$/u, '');
  } catch {
    return trimmed;
  }
}

export function assertNoMixedContentProxyUrl(rawBaseUrl, pageProtocol) {
  if (!isMixedContentBlockedProxyUrl(rawBaseUrl, pageProtocol)) return;
  throw new Error(
    `${OPENAI_PROXY_MIXED_CONTENT_BLOCKED}: Proxy URL uses public HTTP on an HTTPS page. Use an HTTPS Base URL or a local HTTP URL.`,
  );
}

export function isRelayAllowedTarget(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || '').trim();
  if (!trimmed || isRelativeProxyUrl(trimmed)) return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return !isLocalProxyHost(parsed.hostname);
}

export function resolveProxyTransportMode(profile = {}) {
  const transport = String(profile.transport || 'auto').trim();
  const baseUrl = String(profile.baseUrl || '').trim();

  if (transport === 'vercelRewrite' || transport === 'direct') return 'direct';
  if (transport === 'relay') return isRelayAllowedTarget(baseUrl) ? 'relay' : 'direct';
  if (isRelativeProxyUrl(baseUrl) || isLocalProxyUrl(baseUrl)) return 'direct';
  return isRelayAllowedTarget(baseUrl) ? 'relay' : 'direct';
}
