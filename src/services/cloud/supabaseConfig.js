export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseConfigError() {
  if (isSupabaseConfigured()) return '';
  return 'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY.';
}
