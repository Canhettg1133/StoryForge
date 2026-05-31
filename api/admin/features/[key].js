import { logAdminAudit, requireAdmin, sendAccessDenied } from '../../_lib/access-control.js';
import { getQueryValue, readJsonBody, sendJson } from '../../_lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      sendAccessDenied(res, admin);
      return;
    }

    const featureKey = decodeURIComponent(getQueryValue(req, 'key')).trim();
    const body = await readJsonBody(req);
    if (body.key && String(body.key).trim() !== featureKey) {
      sendJson(res, 400, { error: 'Không được sửa feature.key sau khi tạo.', code: 'FEATURE_KEY_IMMUTABLE' });
      return;
    }

    const { data: before, error: beforeError } = await admin.supabase
      .from('features')
      .select('*')
      .eq('key', featureKey)
      .maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) {
      sendJson(res, 404, { error: 'Không tìm thấy tính năng.', code: 'FEATURE_NOT_FOUND' });
      return;
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = String(body.name || '').trim();
    if (Object.prototype.hasOwnProperty.call(body, 'description')) patch.description = String(body.description || '').trim();
    if (Object.prototype.hasOwnProperty.call(body, 'category')) patch.category = String(body.category || 'general').trim() || 'general';
    if (Object.prototype.hasOwnProperty.call(body, 'active')) patch.active = body.active !== false;
    if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
      patch.metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    }
    patch.updated_at = new Date().toISOString();

    if (patch.name === '') {
      sendJson(res, 400, { error: 'Tên tính năng không được để trống.', code: 'FEATURE_NAME_REQUIRED' });
      return;
    }

    const { data, error } = await admin.supabase
      .from('features')
      .update(patch)
      .eq('key', featureKey)
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'feature.update',
      targetFeatureKey: featureKey,
      before,
      after: data,
    });

    sendJson(res, 200, { ok: true, feature: data });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được tính năng.',
      code: error?.code || 'ADMIN_FEATURE_UPDATE_FAILED',
    });
  }
}
