import { requireAdmin, sendAccessDenied } from '../_lib/access-control.js';
import { sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
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
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      sendAccessDenied(res, admin);
      return;
    }

    const userId = String(req.query?.userId || req.query?.user_id || '').trim();
    const featureKey = String(req.query?.featureKey || req.query?.feature_key || '').trim();
    const provider = String(req.query?.provider || '').trim();

    let query = admin.supabase
      .from('usage_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (userId) query = query.eq('user_id', userId);
    if (featureKey) query = query.eq('feature_key', featureKey);
    if (provider) query = query.eq('provider', provider);

    const { data, error } = await query;
    if (error) throw error;

    sendJson(res, 200, { ok: true, usage: data || [] });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không tải được usage.',
      code: error?.code || 'ADMIN_USAGE_FAILED',
    });
  }
}
