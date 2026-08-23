import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import adminWorker from '../../../apps/admin-api-worker/src/index.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createEnv() {
  return {
    SUPABASE_URL: 'https://storyforge.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    ADMIN_ALLOWED_ORIGINS: 'https://admin.storyforge.test',
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

function mockActor(role, extraHandler) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
    if (target.includes('/auth/v1/user')) return jsonResponse({ id: 'actor-1', email: 'actor@example.com' });
    if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.actor-1')) {
      return jsonResponse([{ user_id: 'actor-1', email: 'actor@example.com', system_role: role, status: 'active' }]);
    }
    return extraHandler(target, init);
  }));
  return calls;
}

const ITEMS = [{ id: 'direct', label: 'Direct', url: '/guide', enabled: true, icon: 'book' }];
const MUTATION_ID = '12345678-1234-4234-8234-1234567890ab';

describe('admin setup guides API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('checks catalog read permission before touching setup-guide storage', async () => {
    const calls = mockActor('user', async (target) => {
      throw new Error(`Storage must not be reached: ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/setup-guides'), createEnv());
    expect(response.status).toBe(403);
    expect(calls.some((call) => call.url.includes('site_settings'))).toBe(false);
  });

  it('allows catalog readers to fetch the full editable configuration', async () => {
    mockActor('support', async (target) => {
      if (target.includes('/rest/v1/site_settings')) {
        return jsonResponse([{ key: 'setup_guides', revision: 3, value_json: { items: ITEMS } }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/setup-guides'), createEnv());
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      setupGuides: { key: 'setup_guides', revision: 3, items: ITEMS },
    });
  });

  it('rejects bodies over 32 KiB before calling the settings RPC', async () => {
    const calls = mockActor('admin', async (target) => {
      throw new Error(`RPC must not be reached: ${target}`);
    });
    const body = JSON.stringify({ expectedRevision: 1, items: ITEMS, padding: 'x'.repeat(33 * 1024) });

    const response = await adminWorker.fetch(authedRequest('/setup-guides', {
      method: 'PUT',
      body,
      headers: { 'Content-Length': String(new TextEncoder().encode(body).byteLength) },
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.code).toBe('ADMIN_JSON_BODY_TOO_LARGE');
    expect(calls.some((call) => call.url.includes('/rpc/update_setup_guides'))).toBe(false);
  });

  it('saves and audits atomically inside one revision-checked RPC', async () => {
    const calls = mockActor('admin', async (target, init = {}) => {
      if (target.includes('/rest/v1/rpc/update_setup_guides')) {
        expect(JSON.parse(init.body)).toEqual({
          p_items: ITEMS,
          p_expected_revision: 3,
          p_updated_by: 'actor-1',
          p_mutation_id: MUTATION_ID,
          p_client_ip: '',
          p_user_agent: '',
        });
        return jsonResponse([{
          key: 'setup_guides',
          revision: 4,
          value_json: { items: ITEMS },
          previous_revision: 3,
          previous_value_json: { items: [{ ...ITEMS[0], label: 'Old' }] },
        }]);
      }
      if (target.includes('/rest/v1/admin_audit_logs')) {
        throw new Error('Guide audit must be committed inside update_setup_guides');
      }
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/setup-guides', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: 3, items: ITEMS, mutationId: MUTATION_ID }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.setupGuides.revision).toBe(4);
    expect(calls.filter((call) => call.url.includes('/rpc/update_setup_guides'))).toHaveLength(1);
  });

  it('returns 409 on stale revision and does not write a success audit', async () => {
    const calls = mockActor('admin', async (target) => {
      if (target.includes('/rest/v1/rpc/update_setup_guides')) {
        return jsonResponse({ code: 'P0001', message: 'SETUP_GUIDES_REVISION_CONFLICT' }, 400);
      }
      if (target.includes('/rest/v1/admin_audit_logs')) throw new Error('Conflict must not be audited');
      throw new Error(`Unexpected fetch ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/setup-guides', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: 2, items: ITEMS, mutationId: MUTATION_ID }),
    }), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('ADMIN_SETUP_GUIDES_REVISION_CONFLICT');
    expect(calls.some((call) => call.url.includes('/rest/v1/admin_audit_logs'))).toBe(false);
  });

  it('rejects an invalid mutation id before calling the settings RPC', async () => {
    const calls = mockActor('admin', async (target) => {
      throw new Error(`RPC must not be reached: ${target}`);
    });

    const response = await adminWorker.fetch(authedRequest('/setup-guides', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: 3, items: ITEMS, mutationId: 'not-a-uuid' }),
    }), createEnv());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('ADMIN_MUTATION_ID_INVALID');
    expect(calls.some((call) => call.url.includes('/rpc/update_setup_guides'))).toBe(false);
  });

  it('ships hardened, service-role-only guide and VIP RPC migrations', () => {
    const guideMigration = readFileSync(resolve(process.cwd(), 'docs/supabase-access-control/021_setup_guides.sql'), 'utf8');
    const vipMigration = readFileSync(resolve(process.cwd(), 'docs/supabase-access-control/022_extend_vip.sql'), 'utf8');

    for (const migration of [guideMigration, vipMigration]) {
      expect(migration).toContain('security definer');
      expect(migration).toContain('set search_path = pg_catalog, public');
      expect(migration).toMatch(/revoke all on function[\s\S]+from public, anon, authenticated, service_role/iu);
      expect(migration).toMatch(/grant execute on function[\s\S]+to service_role/iu);
    }
    expect(guideMigration).toContain('SETUP_GUIDES_REVISION_CONFLICT');
    expect(guideMigration).toContain('mutation_id');
    expect(guideMigration).toContain("'setup_guides.update'");
    expect(guideMigration).toContain('insert into public.admin_audit_logs');
    expect(guideMigration).toContain('for update');
    expect(vipMigration).toContain('VIP_EXTENSION_UNLIMITED');
    expect(vipMigration).toContain('p_unit is null');
    expect(vipMigration.indexOf('v_now := clock_timestamp()')).toBeGreaterThan(vipMigration.indexOf('for update'));
    expect(vipMigration).toContain("'users.plan.extend'");
    expect(vipMigration).toContain('insert into public.admin_audit_logs');
    expect(vipMigration).toContain("make_interval(months => p_amount)");
    expect(vipMigration).toContain('for update');
    expect(vipMigration).toContain('order by up.expires_at desc');
    expect(vipMigration).toContain("set status = 'cancelled'");
    expect(vipMigration).not.toMatch(/delete\s+from\s+public\.user_plans/iu);
    expect(vipMigration).not.toMatch(/status\s*=\s*'scheduled'/iu);

    const aclVerification = readFileSync(
      resolve(process.cwd(), 'docs/supabase-access-control/verify_022_admin_mutation_rpc_acl.sql'),
      'utf8',
    );
    expect(aclVerification).toContain('update_setup_guides(jsonb,integer,uuid,uuid,text,text)');
    expect(aclVerification).toContain('admin_extend_vip(uuid,integer,text,uuid,uuid,text,text)');
    expect(aclVerification).toContain("has_function_privilege('anon'");
  });
});


