import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAdminApiForHost(hostname) {
  vi.resetModules();
  vi.stubGlobal('window', { location: { hostname } });
  return import('../../../apps/admin/src/adminApi.js');
}

describe('admin API base URL resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the local Admin API when the admin app runs on localhost', async () => {
    vi.stubEnv('VITE_ADMIN_API_BASE_URL', 'https://storyforge-admin-api.example.workers.dev');

    const { createAdminApiClient } = await loadAdminApiForHost('localhost');

    expect(createAdminApiClient({ getAccessToken: async () => '' }).baseUrl).toBe('http://localhost:8788');
  });

  it('uses the configured Admin API URL outside local development', async () => {
    vi.stubEnv('VITE_ADMIN_API_BASE_URL', 'https://storyforge-admin-api.example.workers.dev/');

    const { createAdminApiClient } = await loadAdminApiForHost('admin.storyforge.example');

    expect(createAdminApiClient({ getAccessToken: async () => '' }).baseUrl).toBe('https://storyforge-admin-api.example.workers.dev');
  });

  it('keeps explicit test overrides higher priority than localhost fallback', async () => {
    const { createAdminApiClient } = await loadAdminApiForHost('localhost');

    expect(createAdminApiClient({
      baseUrl: 'http://127.0.0.1:9999/',
      getAccessToken: async () => '',
    }).baseUrl).toBe('http://127.0.0.1:9999');
  });
});
