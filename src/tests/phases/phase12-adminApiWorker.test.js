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

function encodeUsageCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
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

  it('allows admin delete requests through CORS preflight', async () => {
    const response = await adminWorker.fetch(
      new Request('https://admin-api.storyforge.test/story-mirror/projects/project-1', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://admin.storyforge.test',
          'Access-Control-Request-Method': 'DELETE',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
      }),
      createEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.storyforge.test');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('keeps the deployed admin frontend origin in the checked-in worker config', () => {
    const wranglerConfig = readFileSync(resolve(process.cwd(), 'apps/admin-api-worker/wrangler.toml'), 'utf8');

    expect(wranglerConfig).toContain('https://storyforge-admin.pages.dev');
    expect(wranglerConfig).not.toContain('https://storyforge-admin.canhettg113.workers.dev');
  });

  it('rejects non-admin users before listing admin data', async () => {
    const { fetchMock } = mockAuthAndActor({ role: 'user' });

    const response = await adminWorker.fetch(authedRequest('/users'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe('ADMIN_PERMISSION_DENIED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores dangerous select and limit URL overrides on admin user lists', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/profiles') && target.includes('order=updated_at.desc')) {
        const query = new URL(target).searchParams;
        expect(query.get('select')).not.toBe('*');
        expect(query.get('select')).not.toContain('service_role');
        expect(query.get('limit')).toBe('200');
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/users?select=*&limit=9999'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
  });

  it('serves a lightweight overview without loading usage history or ranking', async () => {
    const { calls } = mockAuthAndActor({ role: 'admin', id: 'admin-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/profiles')) {
        const query = new URL(target).searchParams;
        if (target.includes('limit=25')) {
          expect(query.get('select')).toContain('user_id,email,display_name,system_role,status,updated_at,created_at');
          return jsonResponse([{
            user_id: 'admin-1',
            email: 'admin-1@example.com',
            display_name: 'Admin',
            system_role: 'admin',
            status: 'active',
            updated_at: '2026-07-03T12:00:00.000Z',
            created_at: '2026-07-01T12:00:00.000Z',
          }]);
        }
        if (init?.method === 'HEAD') {
          const total = target.includes('status=eq.active') ? 23 : 25;
          return new Response(null, {
            status: 200,
            headers: {
              'Content-Range': `0-0/${total}`,
            },
          });
        }
      }
      if (target.includes('/rest/v1/user_plans')) {
        const query = new URL(target).searchParams;
        expect(query.get('select')).toContain('plans!inner');
        expect(query.get('status')).toBe('eq.active');
        return jsonResponse([
          { user_id: 'user-vip', plans: { key: 'vip' } },
          { user_id: 'user-lifetime', plans: { key: 'lifetime' } },
          { user_id: 'user-vip', plans: { key: 'vip' } },
        ]);
      }
      if (target.includes('/rest/v1/admin_audit_logs')) {
        const query = new URL(target).searchParams;
        expect(query.get('limit')).toBe('5');
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/overview'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Server-Timing')).toContain('overview-db');
    expect(payload.actor.email).toBe('admin-1@example.com');
    expect(payload.users.summary.total).toBe(25);
    expect(payload.users.summary.active).toBe(23);
    expect(payload.users.summary.vip).toBe(2);
    expect(payload.users.summary.sampleSize).toBe(1);
    expect(payload.audit.items).toEqual([]);
    expect(calls.some((call) => call.url.includes('/rest/v1/usage_events'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/rest/v1/rpc/admin_usage_user_rankings'))).toBe(false);
  });

  it('caches admin actors for read routes and revalidates before mutations', async () => {
    const { calls } = mockAuthAndActor({ role: 'admin', id: 'admin-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/admin_audit_logs') && (init.method || 'GET') === 'GET') {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/features') && init.method === 'POST') {
        return jsonResponse([{ key: 'feature.test' }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs') && init.method === 'POST') {
        return jsonResponse([{ id: 'audit-1' }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const first = await adminWorker.fetch(authedRequest('/audit'), createEnv());
    const second = await adminWorker.fetch(authedRequest('/audit'), createEnv());
    const mutation = await adminWorker.fetch(authedRequest('/features', {
      method: 'POST',
      body: JSON.stringify({
        key: 'feature.test',
        name: 'Feature Test',
        description: '',
        category: 'test',
        active: true,
      }),
    }), createEnv());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mutation.status).toBe(200);
    expect(calls.filter((call) => call.url.includes('/auth/v1/user'))).toHaveLength(2);
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
          {
            id: 'usage-2',
            request_id: 'request-2',
            user_id: 'user-3',
            feature_key: 'ai_chat.access',
            provider: 'custom_proxy',
            model: 'gemini-3-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: {
              action: 'chat',
              workflowFeature: 'ai_chat.access',
              taskType: 'continue',
              taskGroup: 'story_writing',
              taskLabel: 'Viết truyện',
              surface: 'writer',
            },
            created_at: '2026-06-30T12:29:00.000Z',
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
          {
            user_id: 'user-3',
            email: 'writer@example.com',
            display_name: 'Writer',
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
    expect(payload.items[1]).toMatchObject({
      email: 'writer@example.com',
      taskLabel: 'Viết truyện',
    });
    expect(JSON.stringify(payload)).not.toContain('service-role-key');
  });

  it('paginates usage events without exact counts by default', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/usage_events')) {
        expect(target).toContain('limit=51');
        expect(target).toContain('offset=100');
        expect(target).toContain('order=created_at.desc%2Cid.desc');
        expect(init.headers?.Prefer).toBeUndefined();
        return new Response(JSON.stringify([
          {
            id: 'usage-page-3',
            request_id: 'request-page-3',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'custom_proxy',
            model: 'gemini-2.5-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: { action: 'chat' },
            created_at: '2026-07-03T12:30:00.000Z',
          },
        ]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Range': '100-149/33463',
          },
        });
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

    const response = await adminWorker.fetch(authedRequest('/usage?page=3&pageSize=50'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.pagination).toMatchObject({
      page: 3,
      pageSize: 50,
      total: 101,
      totalPages: 3,
      hasPreviousPage: true,
      mode: 'offset',
    });
    expect(payload.pagination.hasNextPage).toBe(false);
  });

  it('uses cursor pagination for deeper usage pages without offset', async () => {
    const cursor = encodeUsageCursor({
      createdAt: '2026-07-03T12:30:00.000Z',
      id: 'usage-cursor',
    });
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/usage_events')) {
        const query = new URL(target).searchParams;
        expect(query.get('limit')).toBe('3');
        expect(query.get('offset')).toBeNull();
        expect(query.get('order')).toBe('created_at.desc,id.desc');
        expect(query.get('or')).toContain('created_at.lt.2026-07-03T12:30:00.000Z');
        expect(init.headers?.Prefer).toBeUndefined();
        return new Response(JSON.stringify([
          {
            id: 'usage-older-1',
            request_id: 'request-older-1',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'custom_proxy',
            model: 'gemini-2.5-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: { action: 'chat' },
            created_at: '2026-07-03T12:20:00.000Z',
          },
          {
            id: 'usage-older-2',
            request_id: 'request-older-2',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'custom_proxy',
            model: 'gemini-2.5-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: { action: 'chat' },
            created_at: '2026-07-03T12:19:00.000Z',
          },
          {
            id: 'usage-extra',
            request_id: 'request-extra',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'custom_proxy',
            model: 'gemini-2.5-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: { action: 'chat' },
            created_at: '2026-07-03T12:18:00.000Z',
          },
        ]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Range': '0-2/33000',
          },
        });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=in.')) {
        return jsonResponse([{
          user_id: 'user-2',
          email: 'reader@example.com',
          display_name: 'Reader',
          system_role: 'user',
          status: 'active',
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest(`/usage?page=6&pageSize=2&knownTotal=33463&cursor=${cursor}`), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items.map((item) => item.id)).toEqual(['usage-older-1', 'usage-older-2']);
    expect(payload.pagination).toMatchObject({
      page: 6,
      pageSize: 2,
      total: 33463,
      mode: 'cursor',
      hasNextPage: true,
      hasPreviousPage: true,
    });
    expect(payload.pagination.nextCursor).toEqual(expect.any(String));
  });

  it('rejects generic deep usage page jumps that do not use a cursor', async () => {
    const { fetchMock } = mockAuthAndActor({ role: 'support', id: 'support-1' });

    const response = await adminWorker.fetch(authedRequest('/usage?page=200&pageSize=100'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('ADMIN_USAGE_DEEP_PAGE_REQUIRES_CURSOR');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('filters usage events on the server before paginating', async () => {
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/profiles') && target.includes('or=')) {
        const query = new URL(target).searchParams;
        expect(query.get('or')).toContain('email.ilike.*reader@example.com*');
        return jsonResponse([{
          user_id: 'user-2',
          email: 'reader@example.com',
          display_name: 'Reader',
          system_role: 'user',
          status: 'active',
        }]);
      }
      if (target.includes('/rest/v1/usage_events')) {
        const query = new URL(target).searchParams;
        expect(query.get('provider')).toBe('eq.custom_proxy');
        expect(query.get('status')).toBe('eq.ok');
        expect(query.get('or')).toContain('user_id.in.(user-2)');
        expect(query.get('or')).toContain('model.ilike.*reader@example.com*');
        return jsonResponse([
          {
            id: 'usage-filtered',
            request_id: 'request-filtered',
            user_id: 'user-2',
            feature_key: 'translator.access',
            provider: 'custom_proxy',
            model: 'gemini-2.5-pro',
            event_type: 'chat',
            count: 1,
            status: 'ok',
            metadata: { action: 'chat' },
            created_at: '2026-07-03T12:30:00.000Z',
          },
        ], 200);
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=in.')) {
        return jsonResponse([{
          user_id: 'user-2',
          email: 'reader@example.com',
          display_name: 'Reader',
          system_role: 'user',
          status: 'active',
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/usage?page=1&pageSize=50&q=reader@example.com&provider=custom_proxy&status=ok'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({
      id: 'usage-filtered',
      email: 'reader@example.com',
    });
  });

  it('ignores short usage searches instead of running broad ilike filters', async () => {
    const { calls } = mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/usage_events')) {
        const query = new URL(target).searchParams;
        expect(query.get('or')).toBeNull();
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/usage?page=1&pageSize=50&q=ab'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
    expect(calls.some((call) => call.url.includes('/rest/v1/profiles') && call.url.includes('or='))).toBe(false);
  });

  it('encodes profile usage search filters before sending PostgREST ilike queries', async () => {
    const { calls } = mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/profiles') && target.includes('or=')) {
        expect(target).toContain('reader%40example.com');
        expect(target).not.toContain('*reader@example.com*');
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/usage_events')) {
        return jsonResponse([], 200);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/usage?page=1&pageSize=50&q=reader@example.com'), createEnv());

    expect(response.status).toBe(200);
    expect(calls.some((call) => call.url.includes('/rest/v1/profiles') && call.url.includes('or='))).toBe(true);
  });

  it('honors admin kill switches for usage, usage search, and VIP ranking', async () => {
    const usageOff = mockAuthAndActor({ role: 'support', id: 'support-1' });
    const usageOffResponse = await adminWorker.fetch(
      authedRequest('/usage?page=1&pageSize=50'),
      createEnv({ ADMIN_USAGE_ENABLED: 'false' }),
    );
    const usageOffPayload = await usageOffResponse.json();

    expect(usageOffResponse.status).toBe(503);
    expect(usageOffPayload.code).toBe('ADMIN_USAGE_DISABLED');
    expect(usageOff.calls.some((call) => call.url.includes('/rest/v1/usage_events'))).toBe(false);

    const searchOff = mockAuthAndActor({ role: 'support', id: 'support-1' });
    const searchOffResponse = await adminWorker.fetch(
      authedRequest('/usage?page=1&pageSize=50&q=reader@example.com'),
      createEnv({ ADMIN_USAGE_SEARCH_ENABLED: 'false' }),
    );
    const searchOffPayload = await searchOffResponse.json();

    expect(searchOffResponse.status).toBe(503);
    expect(searchOffPayload.code).toBe('ADMIN_USAGE_SEARCH_DISABLED');
    expect(searchOff.calls.some((call) => call.url.includes('/rest/v1/usage_events'))).toBe(false);

    const rankingOff = mockAuthAndActor({ role: 'support', id: 'support-1' });
    const rankingOffResponse = await adminWorker.fetch(
      authedRequest('/usage/ranking?range=30d'),
      createEnv({ ADMIN_RANKING_ENABLED: 'false' }),
    );
    const rankingOffPayload = await rankingOffResponse.json();

    expect(rankingOffResponse.status).toBe(503);
    expect(rankingOffPayload.code).toBe('ADMIN_RANKING_DISABLED');
    expect(rankingOff.calls.some((call) => call.url.includes('/rest/v1/rpc/admin_usage_user_rankings'))).toBe(false);
  });

  it('loads VIP usage rankings through the aggregate RPC instead of scanning usage pages', async () => {
    const { calls } = mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/rpc/admin_usage_user_rankings')) {
        const body = JSON.parse(init.body || '{}');
        expect(init.method).toBe('POST');
        expect(body).toMatchObject({
          p_task: 'translation',
          p_plan: 'vip',
          p_provider: 'custom_proxy',
          p_status: 'ok',
          p_search: 'reader@example.com',
          p_limit: 50,
          p_from: '2026-07-01T00:00:00.000Z',
          p_to: '2026-08-01T00:00:00.000Z',
        });
        return jsonResponse([
          {
            rank_order: 1,
            user_id: 'user-2',
            email: 'reader@example.com',
            display_name: 'Reader',
            plan_key: 'vip',
            plan_name: 'VIP',
            total_count: 17,
            event_count: 4,
            ok_count: 17,
            error_count: 0,
            blocked_count: 0,
            last_used_at: '2026-07-20T12:30:00.000Z',
            task_summary: 'Dịch truyện',
            matching_user_count: 3,
            matching_total_count: 99,
            matching_event_count: 21,
            matching_ok_count: 94,
            matching_issue_count: 5,
            matching_last_used_at: '2026-07-21T10:00:00.000Z',
          },
        ]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(
      authedRequest('/usage/ranking?range=custom&from=2026-07-01&to=2026-07-31&task=translation&plan=vip&provider=custom_proxy&status=ok&q=reader@example.com&limit=999'),
      createEnv(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      rank: 1,
      userId: 'user-2',
      email: 'reader@example.com',
      displayName: 'Reader',
      planKey: 'vip',
      totalCount: 17,
      eventCount: 4,
      taskSummary: 'Dịch truyện',
    });
    expect(payload.summary).toMatchObject({
      totalUsers: 3,
      totalCount: 99,
      eventCount: 21,
      okCount: 94,
      issueCount: 5,
      lastUsedAt: '2026-07-21T10:00:00.000Z',
    });
    expect(calls.some((call) => call.url.includes('/rest/v1/usage_events'))).toBe(false);
  });

  it('falls back to the default VIP ranking limit for unsupported sizes', async () => {
    let rpcBody = null;
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target, init = {}) => {
      if (target.includes('/rest/v1/rpc/admin_usage_user_rankings')) {
        rpcBody = JSON.parse(init.body || '{}');
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/usage/ranking?limit=7'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpcBody).toMatchObject({ p_limit: 20 });
    expect(payload.filters.limit).toBe(20);
  });

  it('caches normalized VIP ranking responses and marks cache hits with Server-Timing', async () => {
    let rpcCalls = 0;
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/rpc/admin_usage_user_rankings')) {
        rpcCalls += 1;
        return jsonResponse([{
          rank_order: 1,
          user_id: 'user-cache',
          email: 'cache-reader@example.com',
          display_name: 'Cache Reader',
          plan_key: 'vip',
          plan_name: 'VIP',
          total_count: 11,
          event_count: 3,
          ok_count: 11,
          error_count: 0,
          blocked_count: 0,
          last_used_at: '2026-07-20T12:30:00.000Z',
          task_summary: 'Dịch truyện',
          matching_user_count: 1,
          matching_total_count: 11,
          matching_event_count: 3,
          matching_ok_count: 11,
          matching_issue_count: 0,
          matching_last_used_at: '2026-07-20T12:30:00.000Z',
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const path = '/usage/ranking?range=custom&from=2026-07-01&to=2026-07-31&q=cache-reader@example.com&limit=20';
    const first = await adminWorker.fetch(authedRequest(path), createEnv());
    const second = await adminWorker.fetch(authedRequest(path), createEnv());
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rpcCalls).toBe(1);
    expect(first.headers.get('Server-Timing')).toContain('desc="miss"');
    expect(second.headers.get('Server-Timing')).toContain('desc="hit"');
    expect(secondPayload.items[0]).toMatchObject({
      email: 'cache-reader@example.com',
      totalCount: 11,
    });
  });

  it('deduplicates concurrent VIP ranking requests with the same normalized filters', async () => {
    let rpcCalls = 0;
    let releaseRpc;
    const rpcResponse = new Promise((resolve) => {
      releaseRpc = () => resolve(jsonResponse([{
        rank_order: 1,
        user_id: 'user-shared',
        email: 'shared-reader@example.com',
        display_name: 'Shared Reader',
        plan_key: 'lifetime',
        plan_name: 'Trọn đời',
        total_count: 25,
        event_count: 6,
        ok_count: 23,
        error_count: 2,
        blocked_count: 0,
        last_used_at: '2026-07-22T09:00:00.000Z',
        task_summary: 'Viết truyện',
        matching_user_count: 1,
        matching_total_count: 25,
        matching_event_count: 6,
        matching_ok_count: 23,
        matching_issue_count: 2,
        matching_last_used_at: '2026-07-22T09:00:00.000Z',
      }]));
    });
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/rpc/admin_usage_user_rankings')) {
        rpcCalls += 1;
        return rpcResponse;
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const path = '/usage/ranking?range=custom&from=2026-07-01&to=2026-07-31&q=shared-reader@example.com&limit=20';
    const first = adminWorker.fetch(authedRequest(path), createEnv());
    const second = adminWorker.fetch(authedRequest(path), createEnv());
    await vi.waitFor(() => expect(rpcCalls).toBe(1));
    releaseRpc();
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(rpcCalls).toBe(1);
    expect(responses[0].headers.get('Server-Timing')).toContain('desc="miss"');
    expect(responses[1].headers.get('Server-Timing')).toContain('desc="shared"');
  });

  it('bypasses the VIP ranking cache when force=1 is provided', async () => {
    let rpcCalls = 0;
    mockAuthAndActor({ role: 'support', id: 'support-1' }, async (target) => {
      if (target.includes('/rest/v1/rpc/admin_usage_user_rankings')) {
        rpcCalls += 1;
        return jsonResponse([{
          rank_order: 1,
          user_id: 'user-force',
          email: 'force-reader@example.com',
          display_name: 'Force Reader',
          plan_key: 'vip',
          plan_name: 'VIP',
          total_count: rpcCalls,
          event_count: 1,
          ok_count: rpcCalls,
          error_count: 0,
          blocked_count: 0,
          last_used_at: '2026-07-23T09:00:00.000Z',
          task_summary: 'Chat truyện',
          matching_user_count: 1,
          matching_total_count: rpcCalls,
          matching_event_count: 1,
          matching_ok_count: rpcCalls,
          matching_issue_count: 0,
          matching_last_used_at: '2026-07-23T09:00:00.000Z',
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const path = '/usage/ranking?range=custom&from=2026-07-01&to=2026-07-31&q=force-reader@example.com&limit=20';
    await adminWorker.fetch(authedRequest(path), createEnv());
    const forced = await adminWorker.fetch(authedRequest(`${path}&force=1`), createEnv());
    const forcedPayload = await forced.json();

    expect(forced.status).toBe(200);
    expect(rpcCalls).toBe(2);
    expect(forced.headers.get('Server-Timing')).toContain('desc="miss"');
    expect(forcedPayload.items[0].totalCount).toBe(2);
  });

  it('defines the VIP usage ranking SQL as an aggregate over active VIP plans', () => {
    const migration = readFileSync(resolve(process.cwd(), 'docs/supabase-access-control/007_usage_user_rankings.sql'), 'utf8');

    expect(migration).toContain('create or replace function public.admin_usage_user_rankings');
    expect(migration).toContain('sum(greatest(coalesce(filtered_usage.count, 0), 0))');
    expect(migration).toContain('from public.user_plans');
    expect(migration).toContain("plan.key in ('vip', 'lifetime')");
    expect(migration).toContain("user_plan.status = 'active'");
    expect(migration).toContain('when coalesce(p_limit, 20) in (10, 20, 50)');
    expect(migration).toContain('row_number() over');
    expect(migration).toContain('case input.task_key');
    expect(migration).toContain("else 'Tất cả việc'");
    expect(migration).toContain("then 'Viết truyện'");
    expect(migration).not.toContain('string_agg(distinct candidate.task_label');
    expect(migration).not.toContain('top_task_summary');
    expect(migration).not.toContain('from filtered_usage\n  join limited');
    expect(migration).not.toContain('create table');
  });

  it('adds concurrent covering indexes for the VIP ranking query path', () => {
    const migration = readFileSync(resolve(process.cwd(), 'docs/supabase-access-control/008_usage_ranking_performance.sql'), 'utf8');

    expect(migration).toContain('Run outside a transaction');
    expect(migration).toContain('create index concurrently if not exists idx_usage_events_ranking_recent');
    expect(migration).toContain('on public.usage_events(created_at desc, user_id)');
    expect(migration).toContain('include (count, provider, status, feature_key)');
    expect(migration).toContain('create index concurrently if not exists idx_usage_events_ranking_provider_status_recent');
    expect(migration).toContain('on public.usage_events(provider, status, created_at desc, user_id)');
    expect(migration).toContain('create index concurrently if not exists idx_user_plans_active_plan_user_current');
    expect(migration).toContain("where status = 'active'");
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
              app_metadata: { storyforge_role: 'admin' },
              user_metadata: { role: 'owner' },
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

  it('keeps consent version queries compatible with the deployed schema', () => {
    const schema = readFileSync(resolve(process.cwd(), 'docs/supabase-access-control/001_access_control_schema.sql'), 'utf8');
    const workerSource = readFileSync(resolve(process.cwd(), 'apps/admin-api-worker/src/index.js'), 'utf8');

    const consentTableBlock = schema.slice(
      schema.indexOf('create table if not exists public.consent_versions'),
      schema.indexOf('create unique index if not exists one_active_consent_version_per_key'),
    );

    expect(consentTableBlock).toContain('created_at timestamptz');
    expect(consentTableBlock).not.toContain('updated_at');
    expect(workerSource).toContain("const CONSENT_SELECT = 'id,key,version,title,body,active,effective_at,created_at';");
    expect(workerSource).not.toContain("CONSENT_SELECT = 'id,key,version,title,body,active,effective_at,created_at,updated_at'");
  });

  it('returns a Vietnamese admin message for Supabase schema errors', async () => {
    mockAuthAndActor({}, async (target, init = {}) => {
      if (target.includes('/rest/v1/plans')) return jsonResponse([]);
      if (target.includes('/rest/v1/features')) return jsonResponse([]);
      if (target.includes('/rest/v1/plan_features')) return jsonResponse([]);
      if (target.includes('/rest/v1/consent_versions')) {
        return jsonResponse({
          code: '42703',
          message: 'column consent_versions.updated_at does not exist',
        }, 400);
      }
      throw new Error(`Unexpected fetch ${init.method || 'GET'} ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/catalog'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Cấu trúc dữ liệu Admin chưa khớp');
    expect(payload.error).not.toContain('column consent_versions.updated_at does not exist');
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
