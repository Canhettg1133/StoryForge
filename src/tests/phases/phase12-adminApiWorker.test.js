import { afterEach, describe, expect, it, vi } from 'vitest';
import adminWorker from '../../../apps/admin-api-worker/src/index.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://storyforge.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ADMIN_ALLOWED_ORIGINS: 'https://admin.storyforge.test,http://localhost:5176',
    ...overrides,
  };
}

function authedRequest(path, init = {}) {
  return new Request(`https://admin-api.storyforge.test${path}`, {
    ...init,
    headers: {
      Origin: 'https://admin.storyforge.test',
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

describe('phase12 admin API worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed when required worker secrets are missing', async () => {
    const response = await adminWorker.fetch(
      authedRequest('/health'),
      createEnv({ SUPABASE_SERVICE_ROLE_KEY: '' }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.code).toBe('ADMIN_ENV_MISSING');
  });

  it('rejects wildcard CORS configuration', async () => {
    const response = await adminWorker.fetch(
      authedRequest('/health'),
      createEnv({ ADMIN_ALLOWED_ORIGINS: '*' }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.code).toBe('ADMIN_CORS_WILDCARD_BLOCKED');
  });

  it('rejects non-admin users before listing admin data', async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'user-1',
          email: 'user@example.com',
          app_metadata: { role: 'user' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access')) {
        return jsonResponse([{ user_id: 'user-1', role: 'user', status: 'active' }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/users'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe('ADMIN_PERMISSION_DENIED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the access table role over stale auth metadata', async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'support-1',
          email: 'support@example.com',
          app_metadata: { role: 'user' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access') && target.includes('user_id=eq.support-1')) {
        return jsonResponse([{ user_id: 'support-1', role: 'support', status: 'active' }]);
      }
      if (target.includes('/rest/v1/storyforge_audit_logs')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/audit'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
  });

  it('rejects inactive access table users even when auth metadata is admin', async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'admin-locked',
          email: 'admin@example.com',
          app_metadata: { role: 'admin' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access')) {
        return jsonResponse([{ user_id: 'admin-locked', role: 'admin', status: 'suspended' }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/users'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe('ADMIN_ACCOUNT_INACTIVE');
  });

  it('blocks self-demotion on user access updates', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'owner-1',
          email: 'owner@example.com',
          app_metadata: { role: 'owner' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access') && init.method === 'GET') {
        return jsonResponse([{ user_id: 'owner-1', role: 'owner' }]);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/users/owner-1/access', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin' }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('SELF_ROLE_DOWNGRADE_BLOCKED');
  });

  it('updates user plan and writes an audit log for admin mutations', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body || '' });
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'admin-1',
          email: 'admin@example.com',
          app_metadata: { role: 'admin' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access') && init.method === 'GET') {
        return jsonResponse([{ user_id: 'admin-1', role: 'admin', status: 'active' }]);
      }
      if (target.includes('/rest/v1/storyforge_user_access') && init.method === 'PATCH') {
        return jsonResponse([{ user_id: 'user-2', plan: 'vip' }]);
      }
      if (target.includes('/rest/v1/storyforge_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 10, action: 'users.plan.update' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/users/user-2/plan', {
      method: 'PATCH',
      body: JSON.stringify({ plan: 'vip' }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.item).toMatchObject({ user_id: 'user-2', plan: 'vip' });
    expect(calls.some((call) => call.url.includes('storyforge_audit_logs'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('service-role-key');
  });

  it('updates catalog plans with catalog write permission and audits the change', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body || '' });
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({
          id: 'owner-1',
          email: 'owner@example.com',
          app_metadata: { role: 'owner' },
        });
      }
      if (target.includes('/rest/v1/storyforge_user_access') && init.method === 'GET') {
        return jsonResponse([{ user_id: 'owner-1', role: 'owner', status: 'active' }]);
      }
      if (target.includes('/rest/v1/storyforge_plan_catalog') && init.method === 'PATCH') {
        return jsonResponse([{ id: 2, key: 'vip', enabled: false }]);
      }
      if (target.includes('/rest/v1/storyforge_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 11, action: 'catalog.write' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await adminWorker.fetch(authedRequest('/catalog/2', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.item).toMatchObject({ id: 2, key: 'vip', enabled: false });
    expect(calls.some((call) => call.url.includes('storyforge_audit_logs'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('service-role-key');
  });
});
