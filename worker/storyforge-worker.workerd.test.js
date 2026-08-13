import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { prepareSupremeAttachments } from '../api/_lib/supreme-chat/attachments.js';

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

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

  it('validates the Edge TTS route inside workerd before contacting the provider', async () => {
    const response = await exports.default.fetch('https://storyforge.test/api/tts/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', voiceId: 'hoai-my' }),
    });

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ code: 'TTS_TEXT_REQUIRED' });
  });

  it('validates the fast Google TTS route inside workerd before contacting the provider', async () => {
    const response = await exports.default.fetch('https://storyforge.test/api/tts/google-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ code: 'TTS_TEXT_REQUIRED' });
  });

  it('validates the maximum 12 MB Supreme image context inside workerd', () => {
    const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const attachments = Array.from({ length: 3 }, (_, index) => {
      const bytes = new Uint8Array(4 * 1024 * 1024);
      bytes.set(pngMagic);
      return {
        kind: 'image',
        fileId: index + 1,
        fileName: `image-${index + 1}.png`,
        mimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
        turnOnly: false,
      };
    });

    const prepared = prepareSupremeAttachments(attachments);

    expect(prepared.attachments).toHaveLength(3);
    expect(prepared.skippedAttachmentChunks).toEqual([]);
  });

  it('marks every API response as no-store, including preflight responses', async () => {
    const routes = [
      '/api/openai-proxy',
      '/api/translator-openai-proxy',
      '/api/supreme-chat',
      '/api/supreme-chat-capabilities',
      '/api/cloudflare-workers-ai',
      '/api/me/access',
      '/api/me/adult-consent',
      '/api/site-announcement',
      '/api/translator-prompt-settings',
      '/api/vip-page-content',
      '/api/cloud',
      '/api/tts/edge',
      '/api/tts/google-free',
    ];

    for (const route of routes) {
      const response = await exports.default.fetch(`https://storyforge.test${route}`, { method: 'OPTIONS' });
      expect(response.headers.get('cache-control'), route).toContain('no-store');
    }
  });
});
