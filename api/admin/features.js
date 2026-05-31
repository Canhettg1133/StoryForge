import { logAdminAudit, requireAdmin, sendAccessDenied } from '../_lib/access-control.js';
import { readJsonBody, sendJson } from '../_lib/http.js';

function normalizeFeatureKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      sendAccessDenied(res, admin);
      return;
    }

    const body = await readJsonBody(req);
    const featureKey = normalizeFeatureKey(body.key || body.featureKey || body.feature_key);
    const name = String(body.name || '').trim();
    if (!featureKey || !name) {
      sendJson(res, 400, { error: 'Thiếu key hoặc tên tính năng.', code: 'FEATURE_BAD_REQUEST' });
      return;
    }

    const payload = {
      key: featureKey,
      name,
      description: String(body.description || '').trim(),
      category: String(body.category || 'general').trim() || 'general',
      active: body.active !== false,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    const { data, error } = await admin.supabase
      .from('features')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'feature.create',
      targetFeatureKey: featureKey,
      after: data,
    });

    sendJson(res, 200, { ok: true, feature: data });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không tạo được tính năng.',
      code: error?.code || 'ADMIN_FEATURE_CREATE_FAILED',
    });
  }
}
