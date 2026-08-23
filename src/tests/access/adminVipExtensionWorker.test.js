import { afterEach, describe, expect, it, vi } from 'vitest';
import adminWorker from '../../../apps/admin-api-worker/src/index.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ENV = {
  SUPABASE_URL: 'https://storyforge.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  ADMIN_ALLOWED_ORIGINS: 'https://admin.storyforge.test',
};
const MUTATION_ID = '87654321-4321-4321-8321-ba0987654321';

function request(body) {
  return new Request('https://admin-api.storyforge.test/users/user-2/plan', {
    method: 'POST',
    headers: {
      Origin: 'https://admin.storyforge.test',
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mutationId: MUTATION_ID, ...body }),
  });
}

function mockAdmin(extraHandler) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
    if (target.includes('/auth/v1/user')) return jsonResponse({ id: 'admin-1', email: 'admin@example.com' });
    if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.admin-1')) {
      return jsonResponse([{ user_id: 'admin-1', email: 'admin@example.com', system_role: 'admin', status: 'active' }]);
    }
    if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.user-2')) {
      return jsonResponse([{ user_id: 'user-2', email: 'vip@example.com', system_role: 'user', status: 'active' }]);
    }
    return extraHandler(target, init);
  }));
  return calls;
}

describe('atomic VIP extension', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delegates day extension and its audit to one atomic database RPC', async () => {
    const calls = mockAdmin(async (target, init = {}) => {
      if (target.includes('/rest/v1/rpc/admin_extend_vip')) {
        expect(JSON.parse(init.body)).toEqual({
          p_user_id: 'user-2',
          p_amount: 30,
          p_unit: 'day',
          p_granted_by: 'admin-1',
          p_mutation_id: MUTATION_ID,
          p_client_ip: '',
          p_user_agent: '',
        });
        return jsonResponse([{
          id: 'canonical-vip',
          user_id: 'user-2',
          plan_id: 'vip-plan',
          status: 'active',
          starts_at: '2026-07-01T00:00:00.000Z',
          previous_expires_at: '2026-08-01T00:00:00.000Z',
          expires_at: '2026-08-31T00:00:00.000Z',
          consolidated_count: 1,
        }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs')) {
        throw new Error('VIP audit must be committed inside admin_extend_vip');
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(request({
      operation: 'extend',
      planKey: 'vip',
      amount: 30,
      unit: 'day',
    }), ENV);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.item).toMatchObject({
      id: 'canonical-vip',
      previous_expires_at: '2026-08-01T00:00:00.000Z',
      expires_at: '2026-08-31T00:00:00.000Z',
    });
    expect(calls.filter((call) => call.url.includes('/rpc/admin_extend_vip'))).toHaveLength(1);
    expect(calls.some((call) => call.url.includes('/rest/v1/user_plans'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/rest/v1/admin_audit_logs'))).toBe(false);
  });

  it.each([
    [{ amount: 0, unit: 'day' }, 'ADMIN_VIP_EXTENSION_AMOUNT_INVALID'],
    [{ amount: 3651, unit: 'day' }, 'ADMIN_VIP_EXTENSION_AMOUNT_INVALID'],
    [{ amount: 121, unit: 'month' }, 'ADMIN_VIP_EXTENSION_AMOUNT_INVALID'],
    [{ amount: 1.5, unit: 'day' }, 'ADMIN_VIP_EXTENSION_AMOUNT_INVALID'],
    [{ amount: 1, unit: 'year' }, 'ADMIN_VIP_EXTENSION_UNIT_INVALID'],
  ])('rejects invalid extension input %#', async (extension, expectedCode) => {
    const calls = mockAdmin(async (target) => {
      throw new Error(`Database must not be reached: ${target}`);
    });

    const response = await adminWorker.fetch(request({ operation: 'extend', planKey: 'vip', ...extension }), ENV);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe(expectedCode);
    expect(calls.some((call) => call.url.includes('/rpc/admin_extend_vip'))).toBe(false);
  });

  it('returns 409 and keeps data untouched for lifetime or unlimited VIP', async () => {
    const calls = mockAdmin(async (target) => {
      if (target.includes('/rest/v1/rpc/admin_extend_vip')) {
        return jsonResponse({ code: 'P0001', message: 'VIP_EXTENSION_UNLIMITED' }, 400);
      }
      if (target.includes('/rest/v1/admin_audit_logs')) throw new Error('Failed extension must not be audited');
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(request({
      operation: 'extend', planKey: 'vip', amount: 1, unit: 'month',
    }), ENV);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('ADMIN_VIP_EXTENSION_UNLIMITED');
    expect(calls.some((call) => call.url.includes('/rest/v1/admin_audit_logs'))).toBe(false);
  });

  it.each([
    [{ operation: 'set', planKey: 'vip' }, 'ADMIN_PLAN_EXPIRES_AT_REQUIRED'],
    [{ operation: 'set', planKey: 'vip', expiresAt: 'not-a-date' }, 'ADMIN_PLAN_EXPIRES_AT_INVALID'],
    [{ operation: 'set', planKey: 'vip', status: 'mystery', expiresAt: '2026-09-01T00:00:00.000Z' }, 'ADMIN_PLAN_STATUS_INVALID'],
    [{ operation: 'set', planKey: 'enterprise', expiresAt: '2026-09-01T00:00:00.000Z' }, 'ADMIN_PLAN_KEY_INVALID'],
    [{ operation: 'set', planKey: 'vip', startsAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-01T00:00:00.000Z' }, 'ADMIN_PLAN_DATE_RANGE_INVALID'],
  ])('hardens set validation %#', async (body, expectedCode) => {
    const calls = mockAdmin(async (target) => {
      throw new Error(`Database must not be reached: ${target}`);
    });

    const response = await adminWorker.fetch(request(body), ENV);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe(expectedCode);
    expect(calls.some((call) => call.url.includes('/rest/v1/plans'))).toBe(false);
  });

  it('rejects a missing or invalid mutation id before extending VIP', async () => {
    const calls = mockAdmin(async (target) => {
      throw new Error(`Database must not be reached: ${target}`);
    });
    const invalidRequest = new Request('https://admin-api.storyforge.test/users/user-2/plan', {
      method: 'POST',
      headers: {
        Origin: 'https://admin.storyforge.test',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation: 'extend', planKey: 'vip', amount: 30, unit: 'day', mutationId: 'invalid',
      }),
    });

    const response = await adminWorker.fetch(invalidRequest, ENV);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('ADMIN_MUTATION_ID_INVALID');
    expect(calls.some((call) => call.url.includes('/rpc/admin_extend_vip'))).toBe(false);
  });
});


