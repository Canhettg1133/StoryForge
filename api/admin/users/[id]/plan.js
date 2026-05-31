import { PLAN_STATUSES } from '../../../../src/services/access/accessControl.js';
import { logAdminAudit, requireAdmin, sendAccessDenied } from '../../../_lib/access-control.js';
import { getQueryValue, readJsonBody, sendJson } from '../../../_lib/http.js';

const PLAN_OPERATIONS = {
  SET: 'set',
  CANCEL_CURRENT: 'cancel_current',
  CANCEL_SCHEDULED: 'cancel_scheduled',
};

function normalizePlanOperation(body = {}) {
  const operation = String(body.operation || body.action || '').trim();
  if (Object.values(PLAN_OPERATIONS).includes(operation)) return operation;
  const status = String(body.status || '').trim();
  if (status === PLAN_STATUSES.CANCELLED) return PLAN_OPERATIONS.CANCEL_CURRENT;
  return PLAN_OPERATIONS.SET;
}

function normalizePlanStatus(value) {
  const status = String(value || PLAN_STATUSES.ACTIVE).trim();
  return status === PLAN_STATUSES.ACTIVE || status === PLAN_STATUSES.SCHEDULED ? status : '';
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

    const userId = getQueryValue(req, 'id');
    const body = await readJsonBody(req);
    const operation = normalizePlanOperation(body);
    const planKey = String(body.planKey || body.plan_key || '').trim();

    const before = await admin.supabase
      .from('user_plans')
      .select('*, plans(key, name)')
      .eq('user_id', userId);
    if (before.error) throw before.error;

    if (operation === PLAN_OPERATIONS.CANCEL_CURRENT || operation === PLAN_OPERATIONS.CANCEL_SCHEDULED) {
      const fromStatus = operation === PLAN_OPERATIONS.CANCEL_CURRENT
        ? PLAN_STATUSES.ACTIVE
        : PLAN_STATUSES.SCHEDULED;
      const updatePayload = {
        status: PLAN_STATUSES.CANCELLED,
        updated_at: new Date().toISOString(),
      };
      if (operation === PLAN_OPERATIONS.CANCEL_CURRENT) {
        updatePayload.expires_at = updatePayload.updated_at;
      }

      const { data: updatedPlans, error: updateError } = await admin.supabase
        .from('user_plans')
        .update(updatePayload)
        .eq('user_id', userId)
        .eq('status', fromStatus)
        .select('*, plans(key, name)');
      if (updateError) throw updateError;

      await logAdminAudit(admin.supabase, req, {
        actorUserId: admin.user.id,
        action: `user_plan.${operation}`,
        targetUserId: userId,
        before: { plans: before.data || [] },
        after: { plans: updatedPlans || [] },
      });

      sendJson(res, 200, { ok: true, operation, plans: updatedPlans || [] });
      return;
    }

    if (operation !== PLAN_OPERATIONS.SET) {
      sendJson(res, 400, { error: 'Thao tác gói không hợp lệ.', code: 'PLAN_OPERATION_INVALID' });
      return;
    }

    const status = normalizePlanStatus(body.status);
    if (!status) {
      sendJson(res, 400, { error: 'Trạng thái gói chỉ được là active hoặc scheduled khi cấp gói.', code: 'PLAN_STATUS_INVALID' });
      return;
    }

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

    if (status === PLAN_STATUSES.ACTIVE) {
      const { error: expireError } = await admin.supabase
        .from('user_plans')
        .update({ status: PLAN_STATUSES.EXPIRED })
        .eq('user_id', userId)
        .eq('plan_id', plan.id)
        .eq('status', PLAN_STATUSES.ACTIVE);
      if (expireError) throw expireError;
    }

    if (status === PLAN_STATUSES.SCHEDULED) {
      const { error: cancelScheduledError } = await admin.supabase
        .from('user_plans')
        .update({ status: PLAN_STATUSES.CANCELLED })
        .eq('user_id', userId)
        .eq('plan_id', plan.id)
        .eq('status', PLAN_STATUSES.SCHEDULED);
      if (cancelScheduledError) throw cancelScheduledError;
    }

    const startsAt = body.startsAt || body.starts_at || null;
    const expiresAt = body.expiresAt || body.expires_at || null;
    const { data: inserted, error: insertError } = await admin.supabase
      .from('user_plans')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        status,
        starts_at: startsAt || new Date().toISOString(),
        expires_at: expiresAt || null,
        source: String(body.source || 'manual').trim() || 'manual',
        granted_by: admin.user.id,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      })
      .select('*, plans(key, name)')
      .single();
    if (insertError) throw insertError;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'user_plan.set',
      targetUserId: userId,
      before: { plans: before.data || [] },
      after: inserted,
    });

    sendJson(res, 200, { ok: true, plan: inserted });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được gói người dùng.',
      code: error?.code || 'ADMIN_USER_PLAN_FAILED',
    });
  }
}
