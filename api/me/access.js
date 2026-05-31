import { resolveAccessForRequest, sendAccessDenied } from '../_lib/access-control.js';
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
    const result = await resolveAccessForRequest(req);
    if (!result.ok) {
      sendAccessDenied(res, result);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      access: result.access,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không đọc được quyền truy cập.',
      code: error?.code || 'ACCESS_RESOLVE_FAILED',
    });
  }
}
