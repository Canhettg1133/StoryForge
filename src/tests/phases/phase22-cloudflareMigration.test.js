import { describe, expect, it, vi } from 'vitest';

import { createCloudflareWorkersAIWebHandler } from '../../../api/cloudflare-workers-ai.js';
import { createOpenAIProxyWebHandler } from '../../../api/openai-proxy.js';
import { shouldFallbackOpenAIProxyRelay } from '../../services/ai/openAIProxyConfig.js';
import { handleStoryForgeWorkerRequest } from '../../../worker/index.js';

function createRuntime(env = {}) {
  const deferred = [];
  return {
    env,
    ctx: {
      waitUntil(promise) {
        deferred.push(Promise.resolve(promise));
      },
    },
    deferred,
    platform: 'cloudflare',
  };
}

function allowFeature() {
  return {
    ok: true,
    decision: { allowed: true },
    user: { id: 'test-user' },
  };
}

describe('Cloudflare Worker routing', () => {
  it('returns JSON for unknown API routes instead of falling through to SPA assets', async () => {
    const assetsFetch = vi.fn();

    const response = await handleStoryForgeWorkerRequest(
      new Request('https://storyforge-web.example/api/does-not-exist'),
      { ASSETS: { fetch: assetsFetch } },
      { waitUntil() {} },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ code: 'API_ROUTE_NOT_FOUND' });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('keeps the retired cloud endpoint at 410', async () => {
    const response = await handleStoryForgeWorkerRequest(
      new Request('https://storyforge-web.example/api/cloud'),
      { ASSETS: { fetch: vi.fn() } },
      { waitUntil() {} },
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'CLOUD_SYNC_LEGACY_RETIRED' });
  });

  it('blocks adult-consent writes in preview before the route handler runs', async () => {
    const adultConsent = vi.fn(async () => new Response(null, { status: 204 }));

    const response = await handleStoryForgeWorkerRequest(
      new Request('https://storyforge-web-preview.example/api/me/adult-consent', {
        method: 'POST',
        body: JSON.stringify({ ageConfirmed: true }),
        headers: { 'content-type': 'application/json' },
      }),
      { DEPLOYMENT_MODE: 'preview', ASSETS: { fetch: vi.fn() } },
      { waitUntil() {} },
      { handlers: { '/api/me/adult-consent': adultConsent } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PREVIEW_READ_ONLY' });
    expect(adultConsent).not.toHaveBeenCalled();
  });
});

describe('Web-native OpenAI relay', () => {
  it('accepts exactly 30 batch payloads and emits every index once', async () => {
    const fetchMock = vi.fn(async (_url, init) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.parse(init.body).messages[0].content } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = createOpenAIProxyWebHandler({
      requireFeatureImpl: async () => allowFeature(),
    });
    const payloads = Array.from({ length: 30 }, (_, index) => ({
      model: 'test-model',
      messages: [{ role: 'user', content: `chunk-${index}` }],
    }));

    const response = await handler(new Request('https://storyforge-web.example/api/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-storyforge-upstream-key': 'disposable-test-key',
      },
      body: JSON.stringify({
        action: 'chat_stream_batch',
        baseUrl: 'https://proxy.example.com',
        payloads,
      }),
    }), createRuntime({
      OPENAI_PROXY_BATCH_CONCURRENCY: '6',
      USAGE_LOGGING_ENABLED: 'false',
    }));

    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-storyforge-relay')).toBe('1');
    expect(fetchMock).toHaveBeenCalledTimes(30);
    expect(lines).toHaveLength(30);
    expect(new Set(lines.map((line) => line.index)).size).toBe(30);
    expect(lines.every((line) => line.ok && line.status === 200)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('rejects payload 31 before making an upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = createOpenAIProxyWebHandler({
      requireFeatureImpl: async () => allowFeature(),
    });

    const response = await handler(new Request('https://storyforge-web.example/api/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-storyforge-upstream-key': 'disposable-test-key',
      },
      body: JSON.stringify({
        action: 'chat_stream_batch',
        baseUrl: 'https://proxy.example.com',
        payloads: Array.from({ length: 31 }, () => ({ model: 'test-model', messages: [] })),
      }),
    }), createRuntime({ USAGE_LOGGING_ENABLED: 'false' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'OPENAI_PROXY_BAD_BATCH' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('passes client abort to the upstream fetch', async () => {
    let upstreamSignal;
    const fetchMock = vi.fn((_url, init) => {
      upstreamSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const handler = createOpenAIProxyWebHandler({
      requireFeatureImpl: async () => allowFeature(),
    });
    const controller = new AbortController();
    const pending = handler(new Request('https://storyforge-web.example/api/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-storyforge-upstream-key': 'disposable-test-key',
      },
      body: JSON.stringify({
        action: 'chat',
        baseUrl: 'https://proxy.example.com',
        payload: { model: 'test-model', messages: [] },
      }),
      signal: controller.signal,
    }), createRuntime({ USAGE_LOGGING_ENABLED: 'false' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const response = await pending;

    expect(upstreamSignal.aborted).toBe(true);
    expect(response.status).toBe(502);
    vi.unstubAllGlobals();
  });

  it('does not fallback direct for an upstream 404 marked by StoryForge relay', () => {
    expect(shouldFallbackOpenAIProxyRelay(new Response('{}', {
      status: 404,
      headers: {
        'content-type': 'application/json',
        'x-storyforge-relay': '1',
      },
    }))).toBe(false);
    expect(shouldFallbackOpenAIProxyRelay(new Response('{}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }))).toBe(true);
  });
});

describe('Web-native Cloudflare Workers AI relay', () => {
  it('returns upstream image bytes without text conversion', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 64]);
    const fetchMock = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = createCloudflareWorkersAIWebHandler({
      requireFeatureImpl: async () => allowFeature(),
    });

    const response = await handler(new Request('https://storyforge-web.example/api/cloudflare-workers-ai', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-storyforge-upstream-key': 'disposable-workers-ai-key',
      },
      body: JSON.stringify({
        action: 'run',
        accountId: '35227c3d18fc83a0478996f9cad7e399',
        model: '@cf/leonardo/lucid-origin',
        payload: { prompt: 'cover' },
      }),
    }), createRuntime());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-storyforge-relay')).toBe('1');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    vi.unstubAllGlobals();
  });
});
