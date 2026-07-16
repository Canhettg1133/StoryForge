import { getRequestId, jsonResponse } from '../_lib/web.js';

const RETIRED_MESSAGE = 'Cloud Sync legacy đã ngừng hoạt động. Hãy dùng Cloud Sync trong tài khoản StoryForge.';

export function createLegacyCloudWebHandler() {
  return async function legacyCloudWebHandler(request) {
    const requestId = getRequestId(request);
    return jsonResponse({
      ok: false,
      error: RETIRED_MESSAGE,
      code: 'CLOUD_SYNC_LEGACY_RETIRED',
      requestId,
    }, 410, {
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    });
  };
}
