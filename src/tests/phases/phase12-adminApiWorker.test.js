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

  it('keeps the deployed admin frontend origin in the checked-in worker config', () => {
    const wranglerConfig = readFileSync(resolve(process.cwd(), 'apps/admin-api-worker/wrangler.toml'), 'utf8');

    expect(wranglerConfig).toContain('https://storyforge-admin.canhettg113.workers.dev');
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

  it('enriches audit logs with readable actor, target, summary, and security details', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/admin_audit_logs')) {
        return jsonResponse([
          {
            id: 'audit-new',
            actor_user_id: 'admin-1',
            action: 'users.plan.set',
            target_user_id: 'user-2',
            actor_snapshot: {
              id: 'admin-1',
              email: 'snapshot-admin@example.com',
              displayName: 'Admin Snapshot',
              role: 'admin',
              status: 'active',
            },
            target_snapshot: {
              id: 'user-2',
              email: 'snapshot-user@example.com',
              displayName: 'User Snapshot',
              role: 'user',
              status: 'active',
            },
            action_summary: 'Cấp gói VIP',
            change_summary: 'Cấp gói VIP đến 01/07/2026',
            resource_label: 'snapshot-user@example.com',
            before_json: {},
            after_json: { planKey: 'vip' },
            ip_address: '203.0.113.10',
            user_agent: 'Admin Browser',
            created_at: '2026-06-30T12:00:00.000Z',
          },
          {
            id: 'audit-old',
            actor_user_id: 'support-2',
            action: 'users.role.update',
            target_user_id: 'user-3',
            before_json: { system_role: 'user' },
            after_json: { system_role: 'admin' },
            ip_address: '',
            user_agent: '',
            created_at: '2026-06-29T12:00:00.000Z',
          },
        ]);
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=in.')) {
        return jsonResponse([
          {
            user_id: 'support-2',
            email: 'support@example.com',
            display_name: 'Support One',
            system_role: 'support',
            status: 'active',
          },
          {
            user_id: 'user-3',
            email: 'target@example.com',
            display_name: 'Target User',
            system_role: 'user',
            status: 'active',
          },
        ]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/audit'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({
      actor_user_id: 'admin-1',
      actor_email: 'snapshot-admin@example.com',
      target_email: 'snapshot-user@example.com',
      summary: 'Cấp gói VIP',
      details: 'Cấp gói VIP đến 01/07/2026',
      resource_label: 'snapshot-user@example.com',
      actor: {
        email: 'snapshot-admin@example.com',
        displayName: 'Admin Snapshot',
        role: 'admin',
      },
      target: {
        email: 'snapshot-user@example.com',
        displayName: 'User Snapshot',
        role: 'user',
      },
      security: {
        ip: '203.0.113.10',
        userAgent: 'Admin Browser',
      },
    });
    expect(payload.items[1]).toMatchObject({
      actor_email: 'support@example.com',
      target_email: 'target@example.com',
      summary: 'Đổi vai trò',
      details: 'Vai trò: Người dùng → Quản trị',
    });
    expect(JSON.stringify(payload)).not.toContain('service-role-key');
  });

  it('enriches usage events with user, task, provider, and status labels', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/usage_events')) {
        return jsonResponse([
          {
            id: 'usage-1',
            request_id: 'request-1',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'gemini_direct',
            model: 'gemini-2.5-pro',
            event_type: 'request',
            count: 3,
            status: 'ok',
            metadata: {
              action: 'chat_stream_batch',
              workflowFeature: 'translator.access',
            },
            created_at: '2026-06-30T12:30:00.000Z',
          },
        ]);
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=in.')) {
        return jsonResponse([
          {
            user_id: 'user-2',
            email: 'reader@example.com',
            display_name: 'Reader',
            system_role: 'user',
            status: 'active',
          },
        ]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/usage'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({
      email: 'reader@example.com',
      taskLabel: 'Dịch truyện',
      providerLabel: 'Gemini Direct',
      statusLabel: 'Thành công',
      user: {
        id: 'user-2',
        email: 'reader@example.com',
        displayName: 'Reader',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('service-role-key');
  });

  it('preserves existing privileged roles when syncing Supabase Auth users', async () => {
    mockAuthAndActor({ role: 'admin', id: 'admin-1' }, async (target, init = {}) => {
      if (target.includes('/auth/v1/admin/users')) {
        return jsonResponse({
          users: [
            {
              id: 'admin-1',
              email: 'admin@example.com',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-23T01:00:00.000Z',
              last_sign_in_at: '2026-06-23T01:00:00.000Z',
            },
            {
              id: 'user-2',
              email: 'user@example.com',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-06-02T00:00:00.000Z',
              updated_at: '2026-06-23T01:05:00.000Z',
              last_sign_in_at: '2026-06-23T01:05:00.000Z',
            },
          ],
        });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=in.')) {
        return jsonResponse([{
          user_id: 'admin-1',
          system_role: 'admin',
          status: 'active',
          metadata: { keep: 'this' },
        }]);
      }
      if (target.includes('/rest/v1/profiles') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        const adminRow = body.find((row) => row.user_id === 'admin-1');
        const userRow = body.find((row) => row.user_id === 'user-2');

        expect(adminRow).toMatchObject({
          system_role: 'admin',
          status: 'active',
          metadata: { keep: 'this' },
        });
        expect(userRow).toMatchObject({
          system_role: 'user',
          status: 'active',
        });
        return jsonResponse(body);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 'audit-1', action: 'users.sync_auth' }], 201);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/users/sync-auth', { method: 'POST' }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(2);
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
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.user-2')) {
        return jsonResponse([{
          user_id: 'user-2',
          email: 'vip-user@example.com',
          display_name: 'VIP User',
          system_role: 'user',
          status: 'active',
        }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({
          action: 'users.plan.set',
          actor_user_id: 'admin-1',
          target_user_id: 'user-2',
          actor_snapshot: {
            id: 'admin-1',
            email: 'admin-1@example.com',
            role: 'admin',
            status: 'active',
          },
          target_snapshot: {
            id: 'user-2',
            email: 'vip-user@example.com',
            displayName: 'VIP User',
            role: 'user',
            status: 'active',
          },
          action_summary: 'Cấp gói VIP',
          resource_label: 'vip-user@example.com',
        });
        expect(body.change_summary).toContain('VIP');
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

  it('keeps a forward migration for audit snapshots and readable summaries', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'docs/supabase-access-control/006_admin_audit_snapshots.sql'),
      'utf8',
    );

    for (const column of [
      'actor_snapshot',
      'target_snapshot',
      'action_summary',
      'change_summary',
      'resource_label',
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain('jsonb');
  });
});
