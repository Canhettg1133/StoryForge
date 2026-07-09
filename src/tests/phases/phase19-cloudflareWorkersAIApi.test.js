import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createCloudflareWorkersAIHandler } from '../../../api/cloudflare-workers-ai.js';

const allowCoverGeneration = async () => ({
  ok: true,
  decision: { allowed: true, feature: 'project.cover_generation' },
});

const handler = createCloudflareWorkersAIHandler({
  requireFeatureImpl: allowCoverGeneration,
});

function createReqRes({ method = 'POST', body = {}, headers = {} } = {}) {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    setHeader(key, value) {
      if (this.headersSent) throw new Error('Cannot set headers after they are sent to the client');
      this.headers[key.toLowerCase()] = value;
    },
    write(chunk) {
      this.headersSent = true;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk) {
      if (chunk) this.write(chunk);
      this.bodyBuffer = Buffer.concat(chunks);
      this.body = this.bodyBuffer.toString('utf8');
      this.headersSent = true;
      this.writableEnded = true;
    },
  };

  return {
    req: { method, body, headers },
    res,
  };
}

describe('/api/cloudflare-workers-ai', () => {
  it('forwards image generation to the Cloudflare Workers AI run endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: { image: 'cf-cover-base64' },
      success: true,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = { prompt: 'Artwork only. No text.', steps: 4 };
    const { req, res } = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/black-forest-labs/flux-1-schnell',
        payload,
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/35227c3d18fc83a0478996f9cad7e399/ai/run/@cf/black-forest-labs/flux-1-schnell',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({
          Authorization: 'Bearer cf-workers-ai-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.image).toBe('cf-cover-base64');
    vi.unstubAllGlobals();
  });

  it('pipes raw image responses from Cloudflare without text conversion', async () => {
    const imageBytes = Uint8Array.from([0, 255, 128, 64]);
    const fetchMock = vi.fn(async () => new Response(imageBytes, {
      status: 200,
      headers: { 'content-type': 'image/jpg' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/leonardo/lucid-origin',
        payload: { prompt: 'Artwork only. No text.', width: 1024, height: 1536 },
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpg');
    expect(res.bodyBuffer).toEqual(Buffer.from(imageBytes));
    vi.unstubAllGlobals();
  });

  it('forwards Flux 2 image generation as multipart form data', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: { image: 'cf-flux-2-base64' },
      success: true,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/black-forest-labs/flux-2-klein-4b',
        payload: {
          prompt: 'Artwork only. No text.',
          steps: 25,
          width: 1024,
          height: 1536,
        },
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });

    await handler(req, res);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/35227c3d18fc83a0478996f9cad7e399/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer cf-workers-ai-token' });
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('prompt')).toBe('Artwork only. No text.');
    expect(init.body.get('steps')).toBe('25');
    expect(init.body.get('width')).toBe('1024');
    expect(init.body.get('height')).toBe('1536');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.image).toBe('cf-flux-2-base64');
    vi.unstubAllGlobals();
  });

  it('forwards model search to the Cloudflare Workers AI models endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: [{ name: '@cf/black-forest-labs/flux-1-schnell' }],
      success: true,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = createReqRes({
      body: {
        action: 'models',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        search: 'image',
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });

    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/35227c3d18fc83a0478996f9cad7e399/ai/models/search?search=image&per_page=100',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({ Authorization: 'Bearer cf-workers-ai-token' }),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result[0].name).toBe('@cf/black-forest-labs/flux-1-schnell');
    vi.unstubAllGlobals();
  });

  it('blocks missing keys and invalid model paths before calling Cloudflare', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const missingKey = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/black-forest-labs/flux-1-schnell',
        payload: { prompt: 'cover' },
      },
    });
    await handler(missingKey.req, missingKey.res);
    expect(missingKey.res.statusCode).toBe(400);
    expect(JSON.parse(missingKey.res.body).code).toBe('CLOUDFLARE_WORKERS_AI_UPSTREAM_KEY_REQUIRED');

    const invalidModel = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: 'https://evil.example/model',
        payload: { prompt: 'cover' },
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });
    await handler(invalidModel.req, invalidModel.res);
    expect(invalidModel.res.statusCode).toBe(400);
    expect(JSON.parse(invalidModel.res.body).code).toBe('CLOUDFLARE_WORKERS_AI_BAD_MODEL');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('requires StoryForge project cover access before using the upstream key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const gatedHandler = createCloudflareWorkersAIHandler({
      requireFeatureImpl: async () => ({
        ok: false,
        status: 403,
        reason: 'FEATURE_NOT_ALLOWED',
        decision: {
          allowed: false,
          feature: 'project.cover_generation',
          reason: 'FEATURE_NOT_ALLOWED',
        },
      }),
    });
    const { req, res } = createReqRes({
      body: {
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/black-forest-labs/flux-1-schnell',
        payload: { prompt: 'cover' },
      },
      headers: { 'x-storyforge-upstream-key': 'cf-workers-ai-token' },
    });

    await gatedHandler(req, res);

    expect(res.statusCode).toBe(403);
    const payload = JSON.parse(res.body);
    expect(payload).toMatchObject({
      code: 'FEATURE_NOT_ALLOWED',
      error: 'FEATURE_NOT_ALLOWED',
    });
    expect(payload).not.toHaveProperty('feature');
    expect(payload).not.toHaveProperty('decision');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is registered in local Vite middleware and Vercel function config', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');
    const vercelConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));

    expect(viteConfig).toContain("'/api/cloudflare-workers-ai': './api/cloudflare-workers-ai.js'");
    expect(vercelConfig.functions?.['api/cloudflare-workers-ai.js']?.maxDuration).toBe(300);
  });
});
