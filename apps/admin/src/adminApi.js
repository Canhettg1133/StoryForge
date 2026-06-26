const DEFAULT_ADMIN_API_BASE_URL = String(import.meta.env.VITE_ADMIN_API_BASE_URL || '').trim();
const LOCAL_ADMIN_API_BASE_URL = 'http://localhost:8788';

function isLocalHost() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

function normalizeBaseUrl(value) {
  const fallback = isLocalHost() ? LOCAL_ADMIN_API_BASE_URL : '';
  return String(value || DEFAULT_ADMIN_API_BASE_URL || fallback)
    .trim()
    .replace(/\/+$/u, '');
}

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return { error: await response.text() };
}

export function createAdminApiClient({ baseUrl, getAccessToken }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  async function request(path, options = {}) {
    if (!normalizedBaseUrl) {
      const error = new Error('Thiếu VITE_ADMIN_API_BASE_URL cho admin app.');
      error.code = 'ADMIN_API_BASE_URL_MISSING';
      throw error;
    }

    const token = await getAccessToken?.();
    if (!token) {
      const error = new Error('Phiên đăng nhập admin không hợp lệ.');
      error.code = 'ADMIN_SESSION_MISSING';
      throw error;
    }

    const response = await fetch(`${normalizedBaseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await readPayload(response);

    if (!response.ok) {
      const error = new Error(payload?.error || `Admin API trả về mã ${response.status}.`);
      error.code = payload?.code || 'ADMIN_API_FAILED';
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  return {
    baseUrl: normalizedBaseUrl,
    me: () => request('/me'),
    users: () => request('/users'),
    catalog: () => request('/catalog'),
    audit: () => request('/audit'),
    usage: () => request('/usage'),
    features: () => request('/features'),
    consent: () => request('/consent'),
    announcement: () => request('/announcement'),
    syncAuth: () => request('/users/sync-auth', { method: 'POST', body: {} }),
    userAccess: (userId) => request(`/users/${encodeURIComponent(userId)}/access`),
    updateUserAccess: (userId, role) => request(`/users/${encodeURIComponent(userId)}/access`, {
      method: 'PATCH',
      body: { role },
    }),
    setUserPlan: (userId, body) => request(`/users/${encodeURIComponent(userId)}/plan`, {
      method: 'POST',
      body,
    }),
    updateUserPlan: (userId, planKey) => request(`/users/${encodeURIComponent(userId)}/plan`, {
      method: 'POST',
      body: { operation: 'set', planKey },
    }),
    updateUserStatus: (userId, status) => request(`/users/${encodeURIComponent(userId)}/status`, {
      method: 'POST',
      body: { status },
    }),
    setUserFeatureOverride: (userId, body) => request(`/users/${encodeURIComponent(userId)}/feature-override`, {
      method: 'POST',
      body,
    }),
    updateCatalogPlan: (id, patch) => request(`/catalog/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }),
    updateFeature: (featureKey, patch) => request(`/features/${encodeURIComponent(featureKey)}`, {
      method: 'PATCH',
      body: patch,
    }),
    createFeature: (body) => request('/features', {
      method: 'POST',
      body,
    }),
    setPlanFeature: (featureKey, body) => request(`/features/${encodeURIComponent(featureKey)}/plan`, {
      method: 'POST',
      body,
    }),
    upsertConsent: (body) => request('/consent', {
      method: 'POST',
      body,
    }),
    updateAnnouncement: (body) => request('/announcement', {
      method: 'PATCH',
      body,
    }),
  };
}
