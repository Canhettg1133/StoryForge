import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  createAccessDecision,
  getAccessDeniedMessage,
  hasResolvedFeature,
} from './accessControl.js';
import { getSession } from '../cloud/cloudAuthService.js';

const API_JSON_HEADERS = { 'Content-Type': 'application/json' };

let cachedAccessSnapshot = null;
let cachedAccessToken = '';

export function createUnauthenticatedAccessSnapshot() {
  const features = Object.values(ACCESS_FEATURES).reduce((acc, feature) => {
    acc[feature] = createAccessDecision({
      allowed: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      feature,
    });
    return acc;
  }, {});

  return {
    authenticated: false,
    user: null,
    plan: null,
    features,
    admin: createAccessDecision({
      allowed: false,
      status: 401,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
      feature: 'admin',
    }),
    accessVersion: 0,
  };
}

export function createAuthenticatedAccessFallbackSnapshot(session = {}) {
  const user = session?.user || {};
  const email = String(user.email || user.user_metadata?.email || '').trim();
  const displayName = String(
    user.user_metadata?.name
      || user.user_metadata?.full_name
      || email
      || '',
  ).trim();
  const snapshot = createUnauthenticatedAccessSnapshot();

  return {
    ...snapshot,
    authenticated: true,
    user: {
      id: user.id || null,
      email,
      displayName,
      systemRole: 'user',
      status: 'active',
    },
  };
}

export function setCachedAccessSnapshot(snapshot, token = cachedAccessToken) {
  cachedAccessSnapshot = snapshot || createUnauthenticatedAccessSnapshot();
  cachedAccessToken = String(token || '');
  if (typeof window !== 'undefined') {
    window.__STORYFORGE_ACCESS_SNAPSHOT__ = cachedAccessSnapshot;
    window.__STORYFORGE_ACCESS_TOKEN__ = cachedAccessToken;
  }
  return cachedAccessSnapshot;
}

export function getCachedAccessSnapshot() {
  return cachedAccessSnapshot || createUnauthenticatedAccessSnapshot();
}

export function getCachedAccessToken() {
  return cachedAccessToken;
}

export async function getStoryForgeAccessToken() {
  const session = await getSession().catch(() => null);
  const token = String(session?.access_token || '');
  cachedAccessToken = token;
  return token;
}

export async function fetchStoryForgeApi(path, {
  method = 'GET',
  body,
  token,
  headers = {},
  signal,
} = {}) {
  const accessToken = token || await getStoryForgeAccessToken();
  const response = await fetch(path, {
    method,
    headers: {
      ...(body == null ? {} : API_JSON_HEADERS),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.code || `Request failed with ${response.status}`);
    error.status = response.status;
    error.code = payload?.code || payload?.reason || 'REQUEST_FAILED';
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function fetchAccessSnapshot({ token, signal } = {}) {
  const accessToken = token || await getStoryForgeAccessToken();
  if (!accessToken) {
    return setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot(), '');
  }

  const payload = await fetchStoryForgeApi('/api/me/access', { token: accessToken, signal });
  return setCachedAccessSnapshot(payload?.access || createUnauthenticatedAccessSnapshot(), accessToken);
}

export async function acceptAdultTerms({ ageConfirmed = true } = {}) {
  const payload = await fetchStoryForgeApi('/api/me/adult-consent', {
    method: 'POST',
    body: { ageConfirmed },
  });
  return setCachedAccessSnapshot(payload?.access || cachedAccessSnapshot);
}

export function getCachedFeatureDecision(featureKey, snapshot = getCachedAccessSnapshot()) {
  return snapshot?.features?.[featureKey] || createAccessDecision({
    allowed: false,
    status: 401,
    reason: ACCESS_REASONS.AUTH_REQUIRED,
    feature: featureKey,
  });
}

export function hasCachedFeature(featureKey, snapshot = getCachedAccessSnapshot()) {
  return hasResolvedFeature(snapshot, featureKey);
}

export function getCachedFeatureMessage(featureKey, snapshot = getCachedAccessSnapshot()) {
  return getAccessDeniedMessage(getCachedFeatureDecision(featureKey, snapshot));
}

export async function listAdminUsers(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return fetchStoryForgeApi(`/api/admin/users${query}`);
}

export async function syncAdminAuthUsers() {
  return fetchStoryForgeApi('/api/admin/users/sync-auth', {
    method: 'POST',
    body: {},
  });
}

export async function getAdminCatalog() {
  return fetchStoryForgeApi('/api/admin/catalog');
}

export async function getAdminAudit() {
  return fetchStoryForgeApi('/api/admin/audit');
}

export async function getAdminUsage(filters = {}) {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.featureKey) params.set('featureKey', filters.featureKey);
  if (filters.provider) params.set('provider', filters.provider);
  const query = params.toString();
  return fetchStoryForgeApi(`/api/admin/usage${query ? `?${query}` : ''}`);
}

export async function getAdminUserAccess(userId) {
  return fetchStoryForgeApi(`/api/admin/users/${encodeURIComponent(userId)}/access`);
}

export async function setAdminUserPlan(userId, body) {
  return fetchStoryForgeApi(`/api/admin/users/${encodeURIComponent(userId)}/plan`, {
    method: 'POST',
    body,
  });
}

export async function setAdminUserFeatureOverride(userId, body) {
  return fetchStoryForgeApi(`/api/admin/users/${encodeURIComponent(userId)}/feature-override`, {
    method: 'POST',
    body,
  });
}

export async function setAdminUserStatus(userId, body) {
  return fetchStoryForgeApi(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'POST',
    body,
  });
}

export async function setAdminPlanFeature(featureKey, body) {
  return fetchStoryForgeApi(`/api/admin/features/${encodeURIComponent(featureKey)}/plan`, {
    method: 'POST',
    body,
  });
}

export async function createAdminFeature(body) {
  return fetchStoryForgeApi('/api/admin/features', {
    method: 'POST',
    body,
  });
}

export async function updateAdminFeature(featureKey, body) {
  return fetchStoryForgeApi(`/api/admin/features/${encodeURIComponent(featureKey)}`, {
    method: 'PATCH',
    body,
  });
}

export async function upsertAdminConsentVersion(body) {
  return fetchStoryForgeApi('/api/admin/consent', {
    method: 'POST',
    body,
  });
}

export { ACCESS_FEATURES, ACCESS_REASONS, getAccessDeniedMessage, hasResolvedFeature };
