import {
  getSupabaseClient,
  getSupabaseConfigError,
  isSupabaseConfigured,
} from './supabaseClient.js';

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }
}

function getSafeCloudRedirectPath() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return undefined;
  }

  const pathname = String(window.location.pathname || '').trim();
  const cloudPath = pathname.endsWith('/cloud-sync') ? pathname : '/cloud-sync';
  return `${window.location.origin}${cloudPath}`;
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
  const redirectTo = String(options.redirectTo || getSafeCloudRedirectPath() || '').trim() || undefined;
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
