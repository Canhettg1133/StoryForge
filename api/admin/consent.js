import { logAdminAudit, requireAdmin, sendAccessDenied } from '../_lib/access-control.js';
import { readJsonBody, sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      sendAccessDenied(res, admin);
      return;
    }

    if (req.method === 'GET') {
      const { data, error } = await admin.supabase
        .from('consent_versions')
        .select('*')
        .order('effective_at', { ascending: false });
      if (error) throw error;
      sendJson(res, 200, { ok: true, consentVersions: data || [] });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    const body = await readJsonBody(req);
    const key = String(body.key || 'adult_terms').trim();
    const version = String(body.version || '').trim();
    const title = String(body.title || '').trim();
    const consentBody = String(body.body || '').trim();
    if (!version || !title) {
      sendJson(res, 400, { error: 'Thiếu version hoặc tiêu đề điều khoản.', code: 'BAD_CONSENT_VERSION' });
      return;
    }

    if (body.active !== false) {
      await admin.supabase
        .from('consent_versions')
        .update({ active: false })
        .eq('key', key);
    }

    const { data, error } = await admin.supabase
      .from('consent_versions')
      .upsert({
        key,
        version,
        title,
        body: consentBody,
        active: body.active !== false,
        created_by: admin.user.id,
      }, { onConflict: 'key,version' })
      .select('*')
      .single();
    if (error) throw error;

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'consent_version.upsert',
      after: data,
    });

    sendJson(res, 200, { ok: true, consentVersion: data });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không cập nhật được điều khoản.',
      code: error?.code || 'ADMIN_CONSENT_FAILED',
    });
  }
}
