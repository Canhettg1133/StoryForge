import { buildAccessData, requireAdmin, sendAccessDenied } from '../../../_lib/access-control.js';
import { getQueryValue, sendJson } from '../../../_lib/http.js';
import { resolveUserAccess } from '../../../../src/services/access/accessControl.js';

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

    const userId = getQueryValue(req, 'id');
    const { data: profile, error } = await admin.supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      sendJson(res, 404, { error: 'Không tìm thấy người dùng.', code: 'USER_NOT_FOUND' });
      return;
    }

    const accessData = await buildAccessData(admin.supabase, { id: userId, email: profile.email }, profile);
    sendJson(res, 200, {
      ok: true,
      access: resolveUserAccess(accessData),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không đọc được quyền người dùng.',
      code: error?.code || 'ADMIN_USER_ACCESS_FAILED',
    });
  }
}
