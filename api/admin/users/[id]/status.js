import { USER_STATUSES } from '../../../../src/services/access/accessControl.js';
import { logAdminAudit, requireAdmin, sendAccessDenied } from '../../../_lib/access-control.js';
import { getQueryValue, readJsonBody, sendJson } from '../../../_lib/http.js';

function normalizeStatus(value) {
  const status = String(value || '').trim();
  return Object.values(USER_STATUSES).includes(status) ? status : '';
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
    const status = normalizeStatus(body.status);
    if (!status) {
      sendJson(res, 400, { error: 'Trạng thái không hợp lệ.', code: 'BAD_USER_STATUS' });
      return;
    }

    const { data: before } = await admin.supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: profile, error } = await admin.supabase
      .from('profiles')
      .update({ status })
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'profile.status.update',
      targetUserId: userId,
      before,
      after: profile,
    });

    sendJson(res, 200, { ok: true, profile });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được trạng thái tài khoản.',
      code: error?.code || 'ADMIN_USER_STATUS_FAILED',
    });
  }
}
