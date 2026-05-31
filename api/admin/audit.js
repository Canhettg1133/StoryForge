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

    const { data, error } = await admin.supabase
      .from('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    sendJson(res, 200, { ok: true, audit: data || [] });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không tải được nhật ký admin.',
      code: error?.code || 'ADMIN_AUDIT_FAILED',
    });
  }
}
