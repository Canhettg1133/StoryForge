import { getRequestId, sendJson } from './_lib/http.js';

const RETIRED_MESSAGE = 'Cloud Sync legacy đã ngừng hoạt động. Hãy dùng Cloud Sync trong tài khoản StoryForge.';

export default function handler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  sendJson(res, 410, {
    ok: false,
    error: RETIRED_MESSAGE,
    code: 'CLOUD_SYNC_LEGACY_RETIRED',
    requestId,
  });
}
