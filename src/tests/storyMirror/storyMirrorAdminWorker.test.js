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
    STORY_MIRROR_BUCKET: {
      get: vi.fn(async () => ({
        json: async () => ({
          scene: { content: '<p>Nội dung bí mật</p>' },
        }),
      })),
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    },
    ...overrides,
  };
}

function authedRequest(path, init = {}) {
  return new Request(`https://admin-api.storyforge.test${path}`, {
    ...init,
    headers: {
      Origin: 'https://admin.storyforge.test',
      Authorization: 'Bearer admin-token',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

describe('story mirror admin worker routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads raw scene content from R2 lazily and records an audit event without raw content', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'owner-1', email: 'owner@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.owner-1')) {
        return jsonResponse([{
          user_id: 'owner-1',
          email: 'owner@example.com',
          system_role: 'owner',
          status: 'active',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_scenes')) {
        return jsonResponse([{
          id: 'scene-1',
          user_id: 'user-1',
          project_id: 'project-1',
          title: 'Cảnh 1',
          storage_key: 'users/user-1/projects/11/scenes/33.json',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_admin_audit')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const env = createEnv();
    const response = await adminWorker.fetch(authedRequest('/story-mirror/scenes/scene-1'), env);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.content).toBe('<p>Nội dung bí mật</p>');
    expect(env.STORY_MIRROR_BUCKET.get).toHaveBeenCalledWith('users/user-1/projects/11/scenes/33.json');
    const auditCall = calls.find((call) => call.url.includes('/rest/v1/story_mirror_admin_audit'));
    expect(auditCall).toBeTruthy();
    expect(auditCall.body).toContain('story_mirror.scene.view');
    expect(auditCall.body).not.toContain('Nội dung bí mật');
  });

  it('records delete audit before removing project metadata', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      calls.push({ url: target, method, body: init.body || '' });
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'owner-1', email: 'owner@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.owner-1')) {
        return jsonResponse([{
          user_id: 'owner-1',
          email: 'owner@example.com',
          system_role: 'owner',
          status: 'active',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_projects') && method === 'GET') {
        return jsonResponse([{
          id: 'project-1',
          user_id: 'user-1',
          client_project_id: '11',
          title: 'Truyen thu',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_scenes') && method === 'GET') {
        return jsonResponse([{
          id: 'scene-1',
          storage_key: 'users/user-1/projects/11/scenes/33.json',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_admin_audit')) {
        return jsonResponse([]);
      }
      if (target.includes('/rest/v1/story_mirror_projects') && method === 'DELETE') {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const env = createEnv();
    const response = await adminWorker.fetch(authedRequest('/story-mirror/projects/project-1', {
      method: 'DELETE',
    }), env);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(env.STORY_MIRROR_BUCKET.delete).toHaveBeenCalledWith('users/user-1/projects/11/scenes/33.json');
    expect(env.STORY_MIRROR_BUCKET.delete).toHaveBeenCalledWith('users/user-1/projects/11/manifest.json');
    const auditIndex = calls.findIndex((call) => call.url.includes('/rest/v1/story_mirror_admin_audit'));
    const deleteIndex = calls.findIndex((call) => call.url.includes('/rest/v1/story_mirror_projects') && call.method === 'DELETE');
    expect(auditIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeLessThan(deleteIndex);
    expect(calls[auditIndex].body).toContain('story_mirror.project.delete');
    expect(calls[auditIndex].body).not.toContain('<p>');
  });
});
