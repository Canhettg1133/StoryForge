import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import adminWorker from '../../../apps/admin-api-worker/src/index.js';
import {
  DEFAULT_SITE_ANNOUNCEMENT_URL,
  SITE_ANNOUNCEMENT_KEY,
} from '../../../packages/access/src/index.js';

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

function mockAuthAndActor({ role = 'admin', status = 'active', id = 'admin-1' } = {}, extraHandler = async () => {
  throw new Error('Unexpected fetch');
}) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
    if (target.includes('/auth/v1/user')) {
      return jsonResponse({
        id,
        email: `${id}@example.com`,
        app_metadata: { role: 'user' },
      });
    }
    if (target.includes('/rest/v1/profiles') && target.includes(`user_id=eq.${id}`)) {
      return jsonResponse([{
        user_id: id,
        email: `${id}@example.com`,
        system_role: role,
        status,
      }]);
    }
    return extraHandler(target, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
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
    const { fetchMock } = mockAuthAndActor({ role: 'user' });

    const response = await adminWorker.fetch(authedRequest('/users'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe('ADMIN_PERMISSION_DENIED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses profiles.system_role over stale auth metadata', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/admin_audit_logs')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/audit'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
  });

  it('updates VIP page metadata without replacing other plan metadata', async () => {
    mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/plans') && target.includes('id=eq.plan-vip') && init.method === 'GET') {
        return jsonResponse([{
          id: 'plan-vip',
          key: 'vip',
          metadata: {
            existingKey: 'keep',
            vipPage: {
              priceLabel: '50.000đ',
            },
          },
        }]);
      }
      if (target.includes('/rest/v1/plans') && target.includes('id=eq.plan-vip') && init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        expect(body.metadata).toMatchObject({
          existingKey: 'keep',
          vipPage: {
            priceLabel: '80.000đ',
            paymentNotice: 'VIP 80.000đ. Admin kích hoạt theo email Google.',
          },
        });
        expect(body.metadata.vipPage.internalNote).toBeUndefined();
        return jsonResponse([{ id: 'plan-vip', key: 'vip', metadata: body.metadata }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.action).toBe('plans.update');
        expect(body.before_json.metadata.existingKey).toBe('keep');
        expect(body.after_json.metadata.vipPage.priceLabel).toBe('80.000đ');
        return jsonResponse([{ id: 'audit-1', action: body.action }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/catalog/plan-vip', {
      method: 'PATCH',
      body: JSON.stringify({
        vipPage: {
          priceLabel: '80.000đ',
          paymentNotice: 'VIP 80.000đ. Admin kích hoạt theo email Google.',
          internalNote: 'không được lưu',
        },
      }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.item.metadata.existingKey).toBe('keep');
    expect(payload.item.metadata.vipPage.priceLabel).toBe('80.000đ');
  });

  it('returns the public site announcement without leaking site_settings metadata', async () => {
    mockAuthAndActor({}, async (target) => {
      if (target.includes('/rest/v1/site_settings') && target.includes(`key=eq.${SITE_ANNOUNCEMENT_KEY}`)) {
        return jsonResponse([{
          key: SITE_ANNOUNCEMENT_KEY,
          revision: 7,
          updated_by: 'admin-1',
          value_json: {
            enabled: true,
            title: 'Thông báo hệ thống',
            body: 'Nếu web lỗi, hãy dùng bản dự phòng.',
            primaryActionLabel: 'Mở bản dự phòng',
            primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
            privateNote: 'không được lộ',
          },
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/announcement'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.announcement).toMatchObject({
      key: SITE_ANNOUNCEMENT_KEY,
      enabled: true,
      revision: 7,
      primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
    });
    expect(JSON.stringify(payload)).not.toContain('privateNote');
    expect(JSON.stringify(payload)).not.toContain('updated_by');
  });

  it('validates announcement URLs at write time and does not bump revision for enabled-only changes', async () => {
    mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/site_settings') && target.includes(`key=eq.${SITE_ANNOUNCEMENT_KEY}`)) {
        return jsonResponse([{
          key: SITE_ANNOUNCEMENT_KEY,
          revision: 3,
          value_json: {
            enabled: true,
            title: 'Thông báo hệ thống',
            body: 'Nếu web lỗi, hãy dùng bản dự phòng.',
            primaryActionLabel: 'Mở bản dự phòng',
            primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
          },
        }]);
      }
      if (target.includes('/rest/v1/rpc/upsert_site_announcement') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.p_content_changed).toBe(false);
        expect(body.p_updated_by).toBe('admin-1');
        expect(body.p_value_json).toMatchObject({
          enabled: false,
          primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
        });
        return jsonResponse([{
          key: SITE_ANNOUNCEMENT_KEY,
          revision: 3,
          value_json: body.p_value_json,
        }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.action).toBe('site_announcement.update');
        expect(body.before_json.revision).toBe(3);
        expect(body.after_json.revision).toBe(3);
        return jsonResponse([{ id: 'audit-1', action: body.action }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/announcement', {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: false,
        title: 'Thông báo hệ thống',
        body: 'Nếu web lỗi, hãy dùng bản dự phòng.',
        primaryActionLabel: 'Mở bản dự phòng',
        primaryActionUrl: 'javascript:alert(1)',
      }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.announcement.revision).toBe(3);
    expect(payload.announcement.primaryActionUrl).toBe(DEFAULT_SITE_ANNOUNCEMENT_URL);
  });

  it('marks content changes so the site announcement revision can be bumped atomically', async () => {
    mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/site_settings') && target.includes(`key=eq.${SITE_ANNOUNCEMENT_KEY}`)) {
        return jsonResponse([{
          key: SITE_ANNOUNCEMENT_KEY,
          revision: 3,
          value_json: {
            enabled: true,
            title: 'Thông báo hệ thống',
            body: 'Nếu web lỗi, hãy dùng bản dự phòng.',
            primaryActionLabel: 'Mở bản dự phòng',
            primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
          },
        }]);
      }
      if (target.includes('/rest/v1/rpc/upsert_site_announcement') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.p_content_changed).toBe(true);
        return jsonResponse([{
          key: SITE_ANNOUNCEMENT_KEY,
          revision: 4,
          value_json: body.p_value_json,
        }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 'audit-1', action: 'site_announcement.update' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/announcement', {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Thông báo mới',
      }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.announcement.revision).toBe(4);
    expect(payload.announcement.title).toBe('Thông báo mới');
  });

  it('creates user_plans rows for quick VIP grants and writes an audit log', async () => {
    const { calls } = mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/plans') && target.includes('key=eq.vip')) {
        return jsonResponse([{ id: 'plan-vip', key: 'vip', name: 'VIP' }]);
      }
      if (target.includes('/rest/v1/user_plans') && init.method === 'POST') {
        return jsonResponse([{ id: 'grant-1', user_id: 'user-2', plan_id: 'plan-vip', status: 'active' }], 201);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 'audit-1', action: 'users.plan.set' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/users/user-2/plan', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'set',
        planKey: 'vip',
        expiresAt: '2026-07-01T00:00:00.000Z',
      }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.item).toMatchObject({ user_id: 'user-2', plan_id: 'plan-vip', status: 'active' });
    expect(calls.some((call) => call.url.includes('/rest/v1/user_plans'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('storyforge_');
    expect(JSON.stringify(calls)).not.toContain('service-role-key');
  });

  it('cancels current VIP plans by updating user_plans status', async () => {
    const { calls } = mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/user_plans') && init.method === 'PATCH') {
        expect(JSON.parse(init.body)).toMatchObject({ status: 'cancelled' });
        return jsonResponse([{ id: 'grant-1', user_id: 'user-2', status: 'cancelled' }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 'audit-1', action: 'users.plan.cancel_current' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/users/user-2/plan', {
      method: 'POST',
      body: JSON.stringify({ operation: 'cancel_current' }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([{ id: 'grant-1', user_id: 'user-2', status: 'cancelled' }]);
    expect(JSON.stringify(calls)).not.toContain('storyforge_');
  });

  it('does not grant product features just because the selected user is admin', async () => {
    mockAuthAndActor({}, async (target) => {
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.user-2')) {
        return jsonResponse([{ user_id: 'user-2', email: 'user-2@example.com', system_role: 'admin', status: 'active' }]);
      }
      if (target.includes('/rest/v1/user_plans')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/features')) {
        return jsonResponse([{ key: 'translator.access', name: 'Dịch truyện', active: true }]);
      }
      if (target.includes('/rest/v1/plan_features')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/user_entitlement_overrides')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/consent_versions')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/access_versions')) {
        return jsonResponse([{ user_id: 'user-2', version: 1 }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/users/user-2/access'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.access.admin.allowed).toBe(true);
    expect(payload.access.features['translator.access']).toMatchObject({
      allowed: false,
      reason: 'FEATURE_NOT_ALLOWED',
    });
  });

  it('does not read or write the retired storyforge access tables', () => {
    const workerSource = readFileSync(resolve(process.cwd(), 'apps/admin-api-worker/src/index.js'), 'utf8');

    expect(workerSource).not.toContain('storyforge_user_access');
    expect(workerSource).not.toContain('storyforge_plan_catalog');
    expect(workerSource).not.toContain('storyforge_plan_features');
    expect(workerSource).not.toContain('storyforge_features');
  });
});
