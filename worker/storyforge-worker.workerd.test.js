import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('StoryForge Worker in workerd', () => {
  it('keeps unknown API routes as JSON instead of the SPA shell', async () => {
    const response = await exports.default.fetch('https://storyforge.test/api/not-a-route');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'API_ROUTE_NOT_FOUND' });
  });

  it('serves SPA deep links through the assets binding', async () => {
    const response = await exports.default.fetch('https://storyforge.test/project/example/chapter/1');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('/project/example/chapter/1');
  });

  it('ships both local-runtime compatibility routes', async () => {
    const promptResponse = await exports.default.fetch('https://storyforge.test/api/translator-prompt-settings');
    const cloudResponse = await exports.default.fetch('https://storyforge.test/api/cloud');

    expect(promptResponse.status).toBe(200);
    expect(await promptResponse.json()).toMatchObject({ ok: true, source: 'fallback' });
    expect(cloudResponse.status).toBe(410);
    expect(await cloudResponse.json()).toMatchObject({ code: 'CLOUD_SYNC_LEGACY_RETIRED' });
  });

  it('enforces preview read-only policy before adult-consent handling', async () => {
    const response = await exports.default.fetch('https://storyforge.test/api/me/adult-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PREVIEW_READ_ONLY' });
  });

  it('marks every API response as no-store, including preflight responses', async () => {
    const routes = [
      '/api/openai-proxy',
      '/api/translator-openai-proxy',
      '/api/cloudflare-workers-ai',
      '/api/me/access',
      '/api/me/adult-consent',
      '/api/site-announcement',
      '/api/translator-prompt-settings',
      '/api/vip-page-content',
      '/api/cloud',
    ];

    for (const route of routes) {
      const response = await exports.default.fetch(`https://storyforge.test${route}`, { method: 'OPTIONS' });
      expect(response.headers.get('cache-control'), route).toContain('no-store');
    }
  });
});
