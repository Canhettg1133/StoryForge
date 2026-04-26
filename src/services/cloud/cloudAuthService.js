import {
  getSupabaseClient,
  getSupabaseConfigError,
  isSupabaseConfigured,
} from './supabaseClient.js';

const CLOUD_AUTH_REDIRECT_URL = String(
  import.meta.env.VITE_CLOUD_AUTH_REDIRECT_URL
    || import.meta.env.VITE_SUPABASE_REDIRECT_URL
    || '',
).trim();
const CLOUD_AUTH_RETURN_PATH_KEY = 'sf-cloud-auth-return-path';

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }
}

export function normalizeCloudRedirectUrl(value, origin) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const normalizedOrigin = String(origin || '').trim().replace(/\/+$/, '');
  if (!normalizedOrigin) return normalized;
  const normalizedPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `${normalizedOrigin}${normalizedPath}`;
}

function isLocalhostRedirect(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isLocalOrigin(origin) {
  return isLocalhostRedirect(origin);
}

export function resolveCloudRedirectUrl(configuredRedirectUrl, currentOrigin) {
  const origin = String(currentOrigin || '').trim();
  const configured = String(configuredRedirectUrl || '').trim();
  const normalized = configured
    ? normalizeCloudRedirectUrl(configured, origin)
    : origin;

  if (origin && !isLocalOrigin(origin) && isLocalhostRedirect(normalized)) {
    return origin;
  }

  return normalized;
}

export function getSafeCloudRedirectUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return normalizeCloudRedirectUrl(CLOUD_AUTH_REDIRECT_URL, '');
  }

  return resolveCloudRedirectUrl(CLOUD_AUTH_REDIRECT_URL, window.location.origin);
}

function getCurrentReturnPath() {
  if (typeof window === 'undefined') return '/cloud-sync';
  const pathname = String(window.location.pathname || '').trim() || '/';
  if (!pathname.endsWith('/cloud-sync')) return '/cloud-sync';
  return pathname;
}

export function rememberCloudAuthReturnPath(path = getCurrentReturnPath()) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem(CLOUD_AUTH_RETURN_PATH_KEY, String(path || '/cloud-sync'));
  } catch {
    // Session storage may be blocked; the root callback still completes auth.
  }
}

export function consumeCloudAuthReturnPath() {
  if (typeof window === 'undefined') return '/cloud-sync';
  try {
    const value = String(window.sessionStorage?.getItem(CLOUD_AUTH_RETURN_PATH_KEY) || '').trim();
    window.sessionStorage?.removeItem(CLOUD_AUTH_RETURN_PATH_KEY);
    return value || '/cloud-sync';
  } catch {
    return '/cloud-sync';
  }
}

export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export async function signInWithGoogle(options = {}) {
  ensureConfigured();
  const client = getSupabaseClient();
  rememberCloudAuthReturnPath();
  const redirectTo = normalizeCloudRedirectUrl(
    options.redirectTo || getSafeCloudRedirectUrl(),
    typeof window !== 'undefined' ? window.location?.origin : '',
  ) || undefined;
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  ensureConfigured();
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function subscribe(listener) {
  if (!isSupabaseConfigured()) {
    return () => {};
  }

  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    listener?.(session || null);
  });

  return () => data?.subscription?.unsubscribe?.();
}

export function isCloudAuthConfigured() {
  return isSupabaseConfigured();
}

export default {
  getSession,
  signInWithGoogle,
  signOut,
  subscribe,
  isCloudAuthConfigured,
};
