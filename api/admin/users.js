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

    const search = String(req.query?.search || '').trim();
    const page = Math.max(1, Number(req.query?.page || 1) || 1);
    const limit = Math.min(500, Math.max(25, Number(req.query?.limit || 250) || 250));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = admin.supabase
      .from('profiles')
      .select(`
        user_id,
        email,
        display_name,
        system_role,
        status,
        age_confirmed_at,
        adult_terms_accepted_at,
        adult_terms_version,
        created_at,
        updated_at,
        user_plans(
          id,
          status,
          starts_at,
          expires_at,
          source,
          plans(key, name)
        )
      `)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    sendJson(res, 200, {
      ok: true,
      page,
      limit,
      users: (data || []).map((user) => ({
        ...user,
        plans: user.user_plans || [],
        user_plans: undefined,
      })),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không tải được danh sách người dùng.',
      code: error?.code || 'ADMIN_USERS_FAILED',
    });
  }
}
