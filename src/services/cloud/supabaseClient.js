import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

let supabaseClient = null;

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseConfigError() {
  if (isSupabaseConfigured()) return '';
  return 'Thieu VITE_SUPABASE_URL hoac VITE_SUPABASE_ANON_KEY.';
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
