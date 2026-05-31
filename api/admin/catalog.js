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

    const [plans, features, planFeatures, consentVersions] = await Promise.all([
      admin.supabase.from('plans').select('*').order('sort_order', { ascending: true }),
      admin.supabase.from('features').select('*').order('category', { ascending: true }).order('key', { ascending: true }),
      admin.supabase.from('plan_features').select('*, plans(key, name), features(name, category)'),
      admin.supabase.from('consent_versions').select('*').order('effective_at', { ascending: false }),
    ]);

    for (const result of [plans, features, planFeatures, consentVersions]) {
      if (result.error) throw result.error;
    }

    sendJson(res, 200, {
      ok: true,
      plans: plans.data || [],
      features: features.data || [],
      planFeatures: planFeatures.data || [],
      consentVersions: consentVersions.data || [],
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không tải được catalog quyền.',
      code: error?.code || 'ADMIN_CATALOG_FAILED',
    });
  }
}
