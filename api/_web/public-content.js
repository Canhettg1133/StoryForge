import {
  DEFAULT_SITE_ANNOUNCEMENT,
  DEFAULT_VIP_PAGE_CONTENT,
  PROMPT_SETTINGS_DOMAINS,
  SITE_ANNOUNCEMENT_KEY,
  TRANSLATOR_PROMPT_KEYS,
  getVipPageContentFromPlan,
  toPublicSiteAnnouncement,
  toPublicTranslatorPromptSettings,
} from '../../packages/access/src/index.js';
import { getSupabaseAdminClient, getSupabaseAdminConfig } from '../_lib/supabaseAdmin.js';
import { jsonResponse, normalizeRuntime } from '../_lib/web.js';

async function fetchSiteAnnouncementFromSupabase(runtime) {
  if (!getSupabaseAdminConfig(runtime.env).configured) throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  const supabase = getSupabaseAdminClient(runtime.env);
  const { data, error } = await supabase
    .from('site_settings')
    .select('key,value_json,revision')
    .eq('key', SITE_ANNOUNCEMENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function fetchPromptSettingsFromSupabase(runtime) {
  if (!getSupabaseAdminConfig(runtime.env).configured) throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  const supabase = getSupabaseAdminClient(runtime.env);
  const { data, error } = await supabase
    .from('prompt_settings')
    .select('domain,key,content,enabled,revision')
    .eq('domain', PROMPT_SETTINGS_DOMAINS.TRANSLATOR)
    .eq('enabled', true)
    .in('key', TRANSLATOR_PROMPT_KEYS);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchVipPlanFromSupabase(runtime) {
  if (!getSupabaseAdminConfig(runtime.env).configured) throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  const supabase = getSupabaseAdminClient(runtime.env);
  const { data, error } = await supabase
    .from('plans')
    .select('key,name,description,metadata')
    .eq('key', 'vip')
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function rejectNonGet(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
  return null;
}

export function createSiteAnnouncementWebHandler({
  fetchSiteAnnouncement = fetchSiteAnnouncementFromSupabase,
} = {}) {
  return async function siteAnnouncementWebHandler(request, runtimeInput = {}) {
    const rejected = rejectNonGet(request);
    if (rejected) return rejected;
    const runtime = normalizeRuntime(runtimeInput);
    try {
      const row = await fetchSiteAnnouncement(runtime);
      return jsonResponse({
        ok: true,
        source: row ? 'database' : 'fallback',
        announcement: row ? toPublicSiteAnnouncement(row) : DEFAULT_SITE_ANNOUNCEMENT,
      });
    } catch {
      return jsonResponse({ ok: true, source: 'fallback', announcement: DEFAULT_SITE_ANNOUNCEMENT });
    }
  };
}

export function createTranslatorPromptSettingsWebHandler({
  fetchPromptSettings = fetchPromptSettingsFromSupabase,
} = {}) {
  return async function translatorPromptSettingsWebHandler(request, runtimeInput = {}) {
    const rejected = rejectNonGet(request);
    if (rejected) return rejected;
    const runtime = normalizeRuntime(runtimeInput);
    try {
      const rows = await fetchPromptSettings(runtime);
      return jsonResponse({
        ok: true,
        source: rows.length > 0 ? 'database' : 'fallback',
        ...toPublicTranslatorPromptSettings(rows),
      });
    } catch {
      return jsonResponse({ ok: true, source: 'fallback', prompts: {}, revision: 0 });
    }
  };
}

export function createVipPageContentWebHandler({ fetchVipPlan = fetchVipPlanFromSupabase } = {}) {
  return async function vipPageContentWebHandler(request, runtimeInput = {}) {
    const rejected = rejectNonGet(request);
    if (rejected) return rejected;
    const runtime = normalizeRuntime(runtimeInput);
    try {
      const plan = await fetchVipPlan(runtime);
      return jsonResponse({
        ok: true,
        source: plan ? 'catalog' : 'fallback',
        vipPage: getVipPageContentFromPlan(plan),
      });
    } catch {
      return jsonResponse({ ok: true, source: 'fallback', vipPage: DEFAULT_VIP_PAGE_CONTENT });
    }
  };
}
