import { getSupabaseAdminClient, getSupabaseAdminConfig } from './_lib/supabaseAdmin.js';
import { sendJson } from './_lib/http.js';
import {
  DEFAULT_SITE_ANNOUNCEMENT,
  SITE_ANNOUNCEMENT_KEY,
  toPublicSiteAnnouncement,
} from '../packages/access/src/index.js';

async function fetchSiteAnnouncementFromSupabase() {
  if (!getSupabaseAdminConfig().configured) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('site_settings')
    .select('key,value_json,revision')
    .eq('key', SITE_ANNOUNCEMENT_KEY)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export function createSiteAnnouncementHandler({
  fetchSiteAnnouncement = fetchSiteAnnouncementFromSupabase,
} = {}) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const row = await fetchSiteAnnouncement();
      sendJson(res, 200, {
        ok: true,
        source: row ? 'database' : 'fallback',
        announcement: row ? toPublicSiteAnnouncement(row) : DEFAULT_SITE_ANNOUNCEMENT,
      });
    } catch {
      sendJson(res, 200, {
        ok: true,
        source: 'fallback',
        announcement: DEFAULT_SITE_ANNOUNCEMENT,
      });
    }
  };
}

export default createSiteAnnouncementHandler();
