import { getSupabaseAdminClient, getSupabaseAdminConfig } from './_lib/supabaseAdmin.js';
import { sendJson } from './_lib/http.js';
import {
  DEFAULT_VIP_PAGE_CONTENT,
  getVipPageContentFromPlan,
} from '../packages/access/src/index.js';

async function fetchVipPlanFromSupabase() {
  if (!getSupabaseAdminConfig().configured) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('plans')
    .select('key,name,description,metadata')
    .eq('key', 'vip')
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export function createVipPageContentHandler({
  fetchVipPlan = fetchVipPlanFromSupabase,
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
      const plan = await fetchVipPlan();
      sendJson(res, 200, {
        ok: true,
        source: plan ? 'catalog' : 'fallback',
        vipPage: getVipPageContentFromPlan(plan),
      });
    } catch {
      sendJson(res, 200, {
        ok: true,
        source: 'fallback',
        vipPage: DEFAULT_VIP_PAGE_CONTENT,
      });
    }
  };
}

export default createVipPageContentHandler();
