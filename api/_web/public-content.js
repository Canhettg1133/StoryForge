import {
  DEFAULT_SITE_ANNOUNCEMENT,
  DEFAULT_PUBLIC_SETUP_GUIDES,
  DEFAULT_VIP_PAGE_CONTENT,
  PROMPT_SETTINGS_DOMAINS,
  SITE_ANNOUNCEMENT_KEY,
  SETUP_GUIDES_CACHE_TTL_MS,
  SETUP_GUIDES_KEY,
  TRANSLATOR_PROMPT_KEYS,
  getVipPageContentFromPlan,
  toPublicSiteAnnouncement,
  toPublicSetupGuideConfig,
  toPublicTranslatorPromptSettings,
} from '../../packages/access/src/index.js';
import { getSupabaseAdminClient, getSupabaseAdminConfig } from '../_lib/supabaseAdmin.js';
import { jsonResponse, noStoreResponse, normalizeRuntime } from '../_lib/web.js';

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

async function fetchSetupGuidesFromSupabase(runtime) {
  if (!getSupabaseAdminConfig(runtime.env).configured) throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  const supabase = getSupabaseAdminClient(runtime.env);
  const { data, error } = await supabase
    .from('site_settings')
    .select('key,value_json,revision')
    .eq('key', SETUP_GUIDES_KEY)
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
  if (request.method === 'OPTIONS') return noStoreResponse();
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

export function createSetupGuidesWebHandler({
  fetchSetupGuides = fetchSetupGuidesFromSupabase,
  now = Date.now,
} = {}) {
  let cache = null;
  let inFlight = null;
  const cacheHeaders = {
    'Cache-Control': 'public, max-age=300, s-maxage=300',
  };

  return async function setupGuidesWebHandler(request, runtimeInput = {}) {
    const rejected = rejectNonGet(request);
    if (rejected) return rejected;
    const runtime = normalizeRuntime(runtimeInput);
    const nowMs = Number(typeof now === 'function' ? now() : now);
    const cacheAgeMs = cache ? nowMs - cache.cachedAt : Number.POSITIVE_INFINITY;

    if (cache && cacheAgeMs >= 0 && cacheAgeMs < SETUP_GUIDES_CACHE_TTL_MS) {
      return jsonResponse(cache.payload, 200, cacheHeaders);
    }

    if (!inFlight) {
      inFlight = (async () => {
        try {
          const row = await fetchSetupGuides(runtime);
          return {
            ok: true,
            source: row ? 'database' : 'fallback',
            setupGuides: row ? toPublicSetupGuideConfig(row) : DEFAULT_PUBLIC_SETUP_GUIDES,
          };
        } catch {
          return { ok: true, source: 'fallback', setupGuides: DEFAULT_PUBLIC_SETUP_GUIDES };
        }
      })();
    }

    try {
      const payload = await inFlight;
      cache = { cachedAt: nowMs, payload };
      return jsonResponse(payload, 200, cacheHeaders);
    } finally {
      inFlight = null;
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
