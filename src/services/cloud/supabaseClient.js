import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const SUPABASE_REQUEST_TIMEOUT_MS = 20_000;

let supabaseClient = null;

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Supabase request timed out.', 'AbortError');
  }
  const error = new Error('Supabase request timed out.');
  error.name = 'AbortError';
  return error;
}

export function createSupabaseFetchWithTimeout({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS,
} = {}) {
  return async function supabaseFetchWithTimeout(input, init = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch API is not available.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return fetchImpl(input, init);
    }

    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true });
    }

    const timeoutId = globalThis.setTimeout(() => {
      controller.abort(createAbortError());
    }, timeoutMs);

    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
    }
  };
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseConfigError() {
  if (isSupabaseConfigured()) return '';
  return 'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY.';
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: createSupabaseFetchWithTimeout(),
      },
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }

  return supabaseClient;
}

export default getSupabaseClient;
