import { logAdminAudit, requireAdmin, sendAccessDenied } from '../../../_lib/access-control.js';
import { getQueryValue, readJsonBody, sendJson } from '../../../_lib/http.js';

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

    const userId = getQueryValue(req, 'id');
    const body = await readJsonBody(req);
    const featureKey = String(body.featureKey || body.feature_key || '').trim();
    if (!featureKey) {
      sendJson(res, 400, { error: 'Thiếu feature key.', code: 'FEATURE_KEY_REQUIRED' });
      return;
    }

    const { data: feature, error: featureError } = await admin.supabase
      .from('features')
      .select('*')
      .eq('key', featureKey)
      .maybeSingle();
    if (featureError) throw featureError;
    if (!feature) {
      sendJson(res, 404, { error: 'Không tìm thấy tính năng.', code: 'FEATURE_NOT_FOUND' });
      return;
    }

    const { data: inserted, error } = await admin.supabase
      .from('user_entitlement_overrides')
      .insert({
        user_id: userId,
        feature_key: featureKey,
        enabled: Boolean(body.enabled),
        reason: String(body.reason || '').trim(),
        expires_at: body.expiresAt || body.expires_at || null,
        limit_json: body.limits && typeof body.limits === 'object' ? body.limits : {},
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        granted_by: admin.user.id,
      })
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'feature_override.create',
      targetUserId: userId,
      targetFeatureKey: featureKey,
      after: inserted,
    });

    sendJson(res, 200, { ok: true, override: inserted });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được override tính năng.',
      code: error?.code || 'ADMIN_FEATURE_OVERRIDE_FAILED',
    });
  }
}
