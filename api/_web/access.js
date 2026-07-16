import {
  authenticateRequest,
  buildAccessData,
  resolveAccessForRequest,
} from '../_lib/access-control.js';
import { resolveUserAccess } from '../../src/services/access/accessControl.js';
import {
  isPreviewRuntime,
  jsonResponse,
  noStoreResponse,
  normalizeRuntime,
  readJsonRequest,
} from '../_lib/web.js';

function accessDeniedResponse(result) {
  const code = result?.reason || 'FEATURE_NOT_ALLOWED';
  return jsonResponse({ error: code, code }, result?.status || 403);
}

export function createMeAccessWebHandler() {
  return async function meAccessWebHandler(request, runtimeInput = {}) {
    if (request.method === 'OPTIONS') return noStoreResponse();
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
    const runtime = normalizeRuntime(runtimeInput);
    try {
      const result = await resolveAccessForRequest(request, runtime);
      if (!result.ok) return accessDeniedResponse(result);
      return jsonResponse({ ok: true, access: result.access });
    } catch (error) {
      return jsonResponse({ error: 'Could not load access.', code: error?.code || 'ACCESS_RESOLVE_FAILED' }, 500);
    }
  };
}

export function createAdultConsentWebHandler() {
  return async function adultConsentWebHandler(request, runtimeInput = {}) {
    if (request.method === 'OPTIONS') return noStoreResponse();
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
    const runtime = normalizeRuntime(runtimeInput);
    if (isPreviewRuntime(runtime)) {
      return jsonResponse({ error: 'Preview is read-only.', code: 'PREVIEW_READ_ONLY' }, 403);
    }

    try {
      const auth = await authenticateRequest(request, { runtime });
      if (!auth.ok) return accessDeniedResponse(auth);
      const body = await readJsonRequest(request);
      if (body.ageConfirmed !== true && body.age_confirmed !== true) {
        return jsonResponse({ error: 'Age confirmation is required.', code: 'AGE_CONFIRMATION_REQUIRED' }, 400);
      }

      const { data: consent, error: consentError } = await auth.supabase
        .from('consent_versions')
        .select('*')
        .eq('key', 'adult_terms')
        .eq('active', true)
        .maybeSingle();
      if (consentError) throw consentError;
      if (!consent) return jsonResponse({ error: 'No active adult terms.', code: 'ADULT_TERMS_MISSING' }, 409);

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

      const accessData = await buildAccessData(auth.supabase, auth.user, profile, runtime);
      return jsonResponse({ ok: true, access: resolveUserAccess(accessData) });
    } catch (error) {
      return jsonResponse({ error: 'Could not save adult consent.', code: error?.code || 'ADULT_CONSENT_FAILED' }, 500);
    }
  };
}
