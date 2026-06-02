import { createClient } from '@supabase/supabase-js';

let cachedClient = null;

export function getSupabaseAdminConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SECRET_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || '',
  ).trim();

  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}

export function getSupabaseAdminClient() {
  const config = getSupabaseAdminConfig();
  if (!config.configured) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  if (!cachedClient) {
    cachedClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedClient;
}
