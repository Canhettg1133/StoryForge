const DEFAULT_ADMIN_API_BASE_URL = String(import.meta.env.VITE_ADMIN_API_BASE_URL || '').trim();
const LOCAL_ADMIN_API_BASE_URL = 'http://localhost:8788';
const ADMIN_REQUEST_TIMEOUT_MS = 60_000;

function isLocalHost() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

function normalizeBaseUrl(value) {
  if (value) {
    return String(value).trim().replace(/\/+$/u, '');
  }
  if (isLocalHost()) {
    return LOCAL_ADMIN_API_BASE_URL;
  }
  return String(DEFAULT_ADMIN_API_BASE_URL || '')
    .trim()
    .replace(/\/+$/u, '');
}

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return { error: await response.text() };
}

function toVietnameseAdminApiErrorMessage(message, fallback = 'Admin API trả về lỗi.') {
  const rawMessage = String(message || fallback || '').trim();
  if (!rawMessage) return fallback;
  if (/column\s+.+\s+does not exist/iu.test(rawMessage)) {
    return 'Cấu trúc dữ liệu Admin chưa khớp với API hiện tại. Hãy kiểm tra migration Supabase rồi tải lại.';
  }
  if (/failed to fetch|networkerror|load failed/iu.test(rawMessage)) {
    return 'Không kết nối được Admin API. Hãy kiểm tra mạng hoặc thử tải lại.';
  }
  return rawMessage;
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

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      options.timeoutMs || ADMIN_REQUEST_TIMEOUT_MS,
    );
    let response;
    try {
      response = await fetch(`${normalizedBaseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('Yêu cầu Admin API quá lâu. Hãy thử lại hoặc kiểm tra nhật ký Worker.');
        timeoutError.code = 'ADMIN_API_TIMEOUT';
        throw timeoutError;
      }
      throw new Error(toVietnameseAdminApiErrorMessage(error?.message, 'Không kết nối được Admin API.'));
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
    const payload = await readPayload(response);

    if (!response.ok) {
      const error = new Error(toVietnameseAdminApiErrorMessage(
        payload?.error,
        `Admin API trả về mã ${response.status}.`,
      ));
      error.code = payload?.code || 'ADMIN_API_FAILED';
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  return {
    baseUrl: normalizedBaseUrl,
    me: () => request('/me'),
    overview: () => request('/overview'),
    users: () => request('/users'),
    catalog: () => request('/catalog'),
    audit: () => request('/audit'),
    usage: ({
      page = 1,
      pageSize = 100,
      q = '',
      provider = '',
      status = '',
      cursor = '',
      knownTotal = '',
    } = {}) => {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q) query.set('q', q);
      if (provider && provider !== 'all') query.set('provider', provider);
      if (status && status !== 'all') query.set('status', status);
      if (cursor) query.set('cursor', cursor);
      if (knownTotal !== '' && knownTotal !== null && knownTotal !== undefined) query.set('knownTotal', String(knownTotal));
      return request(`/usage?${query.toString()}`);
    },
    usageRanking: ({
      range = '30d',
      from = '',
      to = '',
      task = 'all',
      plan = 'vip_lifetime',
      provider = '',
      status = '',
      q = '',
      limit = 20,
      force = false,
    } = {}) => {
      const query = new URLSearchParams({
        range: String(range || '30d'),
        task: String(task || 'all'),
        plan: String(plan || 'vip_lifetime'),
        limit: String(limit || 20),
      });
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      if (provider && provider !== 'all') query.set('provider', provider);
      if (status && status !== 'all') query.set('status', status);
      if (q) query.set('q', q);
      if (force) query.set('force', '1');
      return request(`/usage/ranking?${query.toString()}`);
    },
    features: () => request('/features'),
    consent: () => request('/consent'),
    announcement: () => request('/announcement'),
    promptSettings: ({ domain = 'translator' } = {}) => {
      const query = new URLSearchParams({ domain });
      return request(`/prompt-settings?${query.toString()}`);
    },
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
    updatePromptSetting: (domain, key, body) => request(`/prompt-settings/${encodeURIComponent(domain)}/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body,
    }),
    storyMirrorHealth: () => request('/story-mirror/health'),
    storyMirrorSmokeTest: () => request('/story-mirror/health/r2-smoke', {
      method: 'POST',
      body: {},
    }),
    storyMirrorSettings: () => request('/story-mirror/settings'),
    updateStoryMirrorSettings: (body) => request('/story-mirror/settings', {
      method: 'PATCH',
      body,
    }),
    storyMirrorUsers: () => request('/story-mirror/users'),
    storyMirrorProjects: ({ userId = '' } = {}) => {
      const query = new URLSearchParams();
      if (userId) query.set('userId', userId);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/story-mirror/projects${suffix}`);
    },
    storyMirrorProjectScenes: (projectId) => request(`/story-mirror/projects/${encodeURIComponent(projectId)}/scenes`),
    storyMirrorScene: (sceneId, reason) => request(`/story-mirror/scenes/${encodeURIComponent(sceneId)}/view`, {
      method: 'POST',
      body: { reason },
    }),
    exportStoryMirrorProject: (projectId, reason) => request(`/story-mirror/projects/${encodeURIComponent(projectId)}/export`, {
      method: 'POST',
      body: { reason },
    }),
    deleteStoryMirrorProject: (projectId) => request(`/story-mirror/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }),
    storyMirrorAudit: () => request('/story-mirror/audit'),
  };
}
