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

    const featureKey = decodeURIComponent(getQueryValue(req, 'key'));
    const body = await readJsonBody(req);
    const planKey = String(body.planKey || body.plan_key || 'vip').trim();

    const { data: plan, error: planError } = await admin.supabase
      .from('plans')
      .select('*')
      .eq('key', planKey)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) {
      sendJson(res, 404, { error: 'Không tìm thấy gói.', code: 'PLAN_NOT_FOUND' });
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

    const { data: before } = await admin.supabase
      .from('plan_features')
      .select('*')
      .eq('plan_id', plan.id)
      .eq('feature_key', featureKey)
      .maybeSingle();

    const { data: planFeature, error } = await admin.supabase
      .from('plan_features')
      .upsert({
        plan_id: plan.id,
        feature_key: featureKey,
        enabled: body.enabled !== false,
        limit_json: body.limits && typeof body.limits === 'object' ? body.limits : {},
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      }, { onConflict: 'plan_id,feature_key' })
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'plan_feature.upsert',
      targetFeatureKey: featureKey,
      before,
      after: planFeature,
    });

    sendJson(res, 200, { ok: true, planFeature });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được tính năng trong gói.',
      code: error?.code || 'ADMIN_PLAN_FEATURE_FAILED',
    });
  }
}
