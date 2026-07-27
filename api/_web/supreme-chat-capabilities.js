import {
  jsonResponse,
  normalizeRuntime,
  publicErrorResponse,
} from '../_lib/web.js';

export function runtimeSupportsSupremeImages(runtimeInput = {}) {
  const runtime = normalizeRuntime(runtimeInput);
  return runtime.platform !== 'vercel';
}

export function createSupremeChatCapabilitiesWebHandler() {
  return async function supremeChatCapabilitiesWebHandler(request, runtimeInput = {}) {
    if (request.method !== 'GET') {
      return publicErrorResponse(request, 405, {
        code: 'CAPABILITIES_REQUEST_INVALID',
        error: 'Capability request is invalid.',
      });
    }

    const images = runtimeSupportsSupremeImages(runtimeInput);
    return jsonResponse({
      ok: true,
      images,
      reason: images ? '' : 'INLINE_BODY_LIMIT',
    });
  };
}
