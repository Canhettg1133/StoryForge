export const AG_PROXY_PROFILE_ID = 'ag-gemini-proxy';
export const CUSTOM_PROXY_PROFILE_ID = 'custom-openai-proxy';
export const DEFAULT_PROXY_CHAT_PATH = '/v1/chat/completions';
export const DEFAULT_PROXY_MODELS_PATH = '/v1/models';
export const DEFAULT_AG_PROXY_BASE_URL = '/api/proxy';
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

function assertUsableProxyUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Proxy URL is required.');
  }
  if (/\s/u.test(trimmed)) {
    throw new Error('Proxy URL must not contain spaces.');
  }
  if (isRelativeProxyUrl(trimmed)) return;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Proxy URL must be an absolute http(s) URL or a same-origin path.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Proxy URL must use http or https.');
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
  return !isLocalProxyHost(parsed.hostname);
}

export function resolveProxyTransportMode(profile = {}) {
  const transport = String(profile.transport || 'auto').trim();
  const baseUrl = String(profile.baseUrl || '').trim();

  if (transport === 'vercelRewrite') return 'direct';
  if (transport === 'direct') return 'direct';
  if (transport === 'relay') return isRelayAllowedTarget(baseUrl) ? 'relay' : 'direct';
  if (isRelativeProxyUrl(baseUrl) || isLocalProxyUrl(baseUrl)) return 'direct';
  return isRelayAllowedTarget(baseUrl) ? 'relay' : 'direct';
}
