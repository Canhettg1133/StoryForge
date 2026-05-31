import { authenticateRequest, buildAccessData, sendAccessDenied } from '../_lib/access-control.js';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { resolveUserAccess } from '../../src/services/access/accessControl.js';

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
    const auth = await authenticateRequest(req);
    if (!auth.ok) {
      sendAccessDenied(res, auth);
      return;
    }

    const body = await readJsonBody(req);
    if (body.ageConfirmed !== true && body.age_confirmed !== true) {
      sendJson(res, 400, { error: 'Bạn cần xác nhận đủ tuổi.', code: 'AGE_CONFIRMATION_REQUIRED' });
      return;
    }

    const { data: consent, error: consentError } = await auth.supabase
      .from('consent_versions')
      .select('*')
      .eq('key', 'adult_terms')
      .eq('active', true)
      .maybeSingle();
    if (consentError) throw consentError;
    if (!consent) {
      sendJson(res, 409, { error: 'Chưa có điều khoản 18+ đang active.', code: 'ADULT_TERMS_MISSING' });
      return;
    }

    const { data: profile, error } = await auth.supabase
      .from('profiles')
      .update({
        age_confirmed_at: new Date().toISOString(),
        adult_terms_accepted_at: new Date().toISOString(),
        adult_terms_version: consent.version,
      })
      .eq('user_id', auth.user.id)
      .select('*')
      .single();
    if (error) throw error;

    const accessData = await buildAccessData(auth.supabase, auth.user, profile);
    sendJson(res, 200, {
      ok: true,
      access: resolveUserAccess(accessData),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không lưu được xác nhận 18+.',
      code: error?.code || 'ADULT_CONSENT_FAILED',
    });
  }
}
