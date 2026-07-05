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
          scene: { content: '<p>secret admin story</p>' },
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

function mockActor(role = 'owner', id = `${role}-1`) {
  if (role === 'support') {
    return {
      id,
      email: 'support@example.com',
      system_role: 'support',
      status: 'active',
    };
  }
  return {
    id,
    email: 'owner@example.com',
    system_role: 'owner',
    status: 'active',
  };
}

describe('story mirror admin worker routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads raw scene content through POST view with a reason and redacts storage metadata', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      calls.push({ url: target, method: init.method || 'GET', body: init.body || '' });
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'owner-1', email: 'owner@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.owner-1')) {
        return jsonResponse([mockActor('owner', 'owner-1')]);
      }
      if (target.includes('/rest/v1/story_mirror_scenes')) {
        return jsonResponse([{
          id: 'scene-1',
          user_id: 'user-1',
          project_id: 'project-1',
          title: 'Scene 1',
          content_hash: 'sha256:server-hash',
          size_bytes: 32,
          storage_key: 'users/user-1/projects/11/scenes/33.json',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_admin_audit')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const env = createEnv();
    const response = await adminWorker.fetch(authedRequest('/story-mirror/scenes/scene-1/view', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Investigate support ticket 123' }),
    }), env);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.content).toBe('<p>secret admin story</p>');
    expect(payload.scene.storage_key).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('storage_key');
    expect(env.STORY_MIRROR_BUCKET.get).toHaveBeenCalledWith('users/user-1/projects/11/scenes/33.json');
    const auditCall = calls.find((call) => call.url.includes('/rest/v1/story_mirror_admin_audit'));
    expect(auditCall).toBeTruthy();
    expect(auditCall.body).toContain('story_mirror.scene.view');
    expect(auditCall.body).toContain('Investigate support ticket 123');
    expect(auditCall.body).not.toContain('storage_key');
    expect(auditCall.body).not.toContain('users/user-1/projects/11/scenes/33.json');
    expect(auditCall.body).not.toContain('secret admin story');
  });

  it('blocks support from raw scene view and project export', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'support-1', email: 'support@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.support-1')) {
        return jsonResponse([mockActor('support', 'support-1')]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const env = createEnv();
    const viewResponse = await adminWorker.fetch(authedRequest('/story-mirror/scenes/scene-1/view', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Support should not read raw content' }),
    }), env);
    const exportResponse = await adminWorker.fetch(authedRequest('/story-mirror/projects/project-1/export', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Support should not export raw content' }),
    }), env);

    expect(viewResponse.status).toBe(403);
    expect(exportResponse.status).toBe(403);
    expect(env.STORY_MIRROR_BUCKET.get).not.toHaveBeenCalled();
  });

  it('lists project scenes without returning private R2 storage keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'owner-1', email: 'owner@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.owner-1')) {
        return jsonResponse([mockActor('owner', 'owner-1')]);
      }
      if (target.includes('/rest/v1/story_mirror_projects') && method === 'GET') {
        return jsonResponse([{
          id: 'project-1',
          user_id: 'user-1',
          client_project_id: '11',
          title: 'Mirrored project',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_scenes') && method === 'GET') {
        return jsonResponse([{
          id: 'scene-1',
          user_id: 'user-1',
          project_id: 'project-1',
          client_scene_id: '33',
          title: 'Scene 1',
          storage_key: 'users/user-1/projects/11/scenes/33.json',
        }]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const response = await adminWorker.fetch(authedRequest('/story-mirror/projects/project-1/scenes'), createEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].storage_key).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('storage_key');
    expect(JSON.stringify(payload)).not.toContain('users/user-1/projects/11/scenes/33.json');
  });

  it('exports raw project content only for owner and redacts storage keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'owner-1', email: 'owner@example.com' });
      }
      if (target.includes('/rest/v1/profiles') && target.includes('user_id=eq.owner-1')) {
        return jsonResponse([mockActor('owner', 'owner-1')]);
      }
      if (target.includes('/rest/v1/story_mirror_projects') && method === 'GET') {
        return jsonResponse([{
          id: 'project-1',
          user_id: 'user-1',
          client_project_id: '11',
          title: 'Mirrored project',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_chapters') && method === 'GET') {
        return jsonResponse([{ id: 'chapter-1', project_id: 'project-1', title: 'Chapter 1' }]);
      }
      if (target.includes('/rest/v1/story_mirror_scenes') && method === 'GET') {
        return jsonResponse([{
          id: 'scene-1',
          user_id: 'user-1',
          project_id: 'project-1',
          chapter_id: 'chapter-1',
          title: 'Scene 1',
          storage_key: 'users/user-1/projects/11/scenes/33.json',
        }]);
      }
      if (target.includes('/rest/v1/story_mirror_admin_audit')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const env = createEnv();
    const response = await adminWorker.fetch(authedRequest('/story-mirror/projects/project-1/export', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Owner legal export ticket 456' }),
    }), env);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.chapters[0].scenes[0].content).toBe('<p>secret admin story</p>');
    expect(JSON.stringify(payload)).not.toContain('storage_key');
    expect(JSON.stringify(payload)).not.toContain('users/user-1/projects/11/scenes/33.json');
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
        return jsonResponse([mockActor('owner', 'owner-1')]);
      }
      if (target.includes('/rest/v1/story_mirror_projects') && method === 'GET') {
        return jsonResponse([{
          id: 'project-1',
          user_id: 'user-1',
          client_project_id: '11',
          title: 'Test project',
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
