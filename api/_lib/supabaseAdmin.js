import { createClient } from '@supabase/supabase-js';

const cachedClients = new Map();

function getDefaultEnv() {
  return typeof process !== 'undefined' && process?.env ? process.env : {};
}

export function getSupabaseAdminConfig(env = getDefaultEnv()) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(
    env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_SECRET_KEY
      || env.SUPABASE_SERVICE_KEY
      || '',
  ).trim();

  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}

export function getSupabaseAdminClient(env = getDefaultEnv()) {
  const config = getSupabaseAdminConfig(env);
  if (!config.configured) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const cacheKey = `${config.url}:${config.serviceRoleKey}`;
  if (!cachedClients.has(cacheKey)) {
    cachedClients.set(cacheKey, createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }));
  }

  return cachedClients.get(cacheKey);
}
