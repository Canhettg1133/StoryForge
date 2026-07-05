import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import db from '../../services/db/database.js';
import { deleteProjectCascade } from '../../services/db/projectDataService.js';
import { exportProject, importProject } from '../../services/db/exportImport.js';
import {
  createProjectCoverAsset,
  deleteProjectCoverAsset,
  getActiveProjectCover,
} from '../../services/projectCovers/coverRepository.js';

const SAMPLE_COVER_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
const SAMPLE_SECOND_COVER_DATA_URL = 'data:image/png;base64,second-cover-data';

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

async function createProject(title = 'Truyện bìa test') {
  const now = Date.now();
  return db.projects.add({
    title,
    genre_primary: 'fantasy',
    status: 'draft',
    created_at: now,
    updated_at: now,
  });
}

describe('phase19 project cover assets', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.unstubAllGlobals();
    await resetDatabase();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (db.isOpen()) db.close();
    await db.delete();
  });

  it('stores the active cover as a project asset and preserves it through export/import/cascade delete', async () => {
    const projectId = await createProject('Bìa test');
    const cover = await createProjectCoverAsset({
      projectId,
      source: 'upload',
      mimeType: 'image/png',
      dataUrl: SAMPLE_COVER_DATA_URL,
      thumbnailDataUrl: SAMPLE_COVER_DATA_URL,
    });

    const project = await db.projects.get(projectId);
    expect(project.cover_asset_id).toBe(cover.id);
    expect(project.cover_thumbnail_data_url).toBe(SAMPLE_COVER_DATA_URL);
    expect(await getActiveProjectCover(projectId)).toMatchObject({
      id: cover.id,
      project_id: projectId,
      role: 'cover',
      source: 'upload',
      data_url: SAMPLE_COVER_DATA_URL,
    });

    const exported = JSON.parse(await exportProject(projectId));
    expect(exported._storyforge_version).toBeGreaterThanOrEqual(7);
    expect(exported.project_assets).toEqual([
      expect.objectContaining({
        id: cover.id,
        project_id: projectId,
        role: 'cover',
        data_url: SAMPLE_COVER_DATA_URL,
      }),
    ]);

    const importedProjectId = await importProject(JSON.stringify(exported), { titleMode: 'original' });
    const importedProject = await db.projects.get(importedProjectId);
    const importedCover = await getActiveProjectCover(importedProjectId);
    expect(importedCover).toMatchObject({
      project_id: importedProjectId,
      role: 'cover',
      data_url: SAMPLE_COVER_DATA_URL,
    });
    expect(importedProject.cover_asset_id).toBe(importedCover.id);
    expect(importedProject.cover_thumbnail_data_url).toBe(SAMPLE_COVER_DATA_URL);
    expect(importedCover.id).not.toBe(cover.id);

    await deleteProjectCascade(projectId);
    expect(await db.project_assets.where('project_id').equals(projectId).count()).toBe(0);
    expect(await getActiveProjectCover(importedProjectId)).toMatchObject({
      project_id: importedProjectId,
      data_url: SAMPLE_COVER_DATA_URL,
    });
  });

  it('deletes covers and keeps the project cover metadata in sync', async () => {
    const projectId = await createProject('Đổi bìa test');
    const firstCover = await createProjectCoverAsset({
      projectId,
      source: 'upload',
      mimeType: 'image/png',
      dataUrl: SAMPLE_COVER_DATA_URL,
      thumbnailDataUrl: SAMPLE_COVER_DATA_URL,
    });
    const secondCover = await createProjectCoverAsset({
      projectId,
      source: 'generated',
      mimeType: 'image/png',
      dataUrl: SAMPLE_SECOND_COVER_DATA_URL,
      thumbnailDataUrl: SAMPLE_SECOND_COVER_DATA_URL,
    });

    expect(await getActiveProjectCover(projectId)).toMatchObject({ id: secondCover.id });

    const deleteActiveResult = await deleteProjectCoverAsset(projectId, secondCover.id);
    const projectAfterActiveDelete = await db.projects.get(projectId);
    expect(deleteActiveResult.activeCover).toMatchObject({ id: firstCover.id });
    expect(await db.project_assets.get(secondCover.id)).toBeUndefined();
    expect(projectAfterActiveDelete.cover_asset_id).toBe(firstCover.id);
    expect(projectAfterActiveDelete.cover_thumbnail_data_url).toBe(SAMPLE_COVER_DATA_URL);

    const deleteLastResult = await deleteProjectCoverAsset(projectId, firstCover.id);
    const projectAfterLastDelete = await db.projects.get(projectId);
    expect(deleteLastResult.activeCover).toBeNull();
    expect(await db.project_assets.get(firstCover.id)).toBeUndefined();
    expect(projectAfterLastDelete.cover_asset_id).toBe(0);
    expect(projectAfterLastDelete.cover_thumbnail_data_url).toBe('');
  });

  it('stores remote provider image URLs as generated cover assets', async () => {
    const projectId = await createProject('Remote bìa test');
    const imageUrl = 'https://catiecli.sukaka.top/images/generated-cover.jpg';

    const cover = await createProjectCoverAsset({
      projectId,
      source: 'generated',
      mimeType: 'image/jpeg',
      dataUrl: imageUrl,
      thumbnailDataUrl: imageUrl,
    });

    const project = await db.projects.get(projectId);
    expect(cover.data_url).toBe(imageUrl);
    expect(cover.mime_type).toBe('image/jpeg');
    expect(project.cover_thumbnail_data_url).toBe(imageUrl);
  });
});

describe('phase19 cover provider contracts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadCoverProviderStack() {
    vi.resetModules();
    vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
      getSession: async () => ({ access_token: 'story-token' }),
      subscribe: () => () => {},
    }));
    const [
      coverProviderModule,
      keyManagerModule,
      routerModule,
      proxyConfigModule,
    ] = await Promise.all([
      import('../../services/projectCovers/coverImageProvider.js'),
      import('../../services/ai/keyManager.js'),
      import('../../services/ai/router.js'),
      import('../../services/ai/openAIProxyConfig.js'),
    ]);

    return {
      ...coverProviderModule,
      keyManager: keyManagerModule.default,
      routerModule,
      proxyConfigModule,
    };
  }

  it('parses OpenAI, Gemini, and Cloudflare image responses into the same cover image result shape', async () => {
    const {
      parseCloudflareWorkersAIImageResponse,
      parseGeminiInteractionImageResponse,
      parseOpenAIChatImageResponse,
      parseOpenAIImageGenerationResponse,
    } = await loadCoverProviderStack();

    expect(parseOpenAIImageGenerationResponse({
      data: [{ b64_json: 'openai-base64', revised_prompt: 'artwork without text' }],
    })).toEqual({
      b64: 'openai-base64',
      mimeType: 'image/png',
      revisedPrompt: 'artwork without text',
    });

    expect(parseGeminiInteractionImageResponse({
      output_image: { data: 'gemini-base64', mime_type: 'image/png' },
    })).toEqual({
      b64: 'gemini-base64',
      mimeType: 'image/png',
      revisedPrompt: '',
    });

    expect(parseCloudflareWorkersAIImageResponse({
      result: { image: 'cloudflare-base64' },
      success: true,
      errors: [],
      messages: [],
    })).toEqual({
      b64: 'cloudflare-base64',
      mimeType: 'image/jpeg',
      revisedPrompt: '',
    });

    expect(parseCloudflareWorkersAIImageResponse({
      result: { image: 'cloudflare-png-base64' },
      mimeType: 'image/png',
    })).toEqual({
      b64: 'cloudflare-png-base64',
      mimeType: 'image/png',
      revisedPrompt: '',
    });

    expect(parseOpenAIChatImageResponse({
      choices: [{
        message: {
          content: '![cover](data:image/jpeg;base64,chat-image-base64)',
        },
      }],
    })).toEqual({
      b64: 'chat-image-base64',
      mimeType: 'image/jpeg',
      revisedPrompt: '',
    });

    expect(parseOpenAIChatImageResponse({
      choices: [{
        message: {
          content: '![Generated Image](http://catiecli.sukaka.top/images/cover-output.jpg)',
        },
      }],
    })).toEqual({
      b64: '',
      imageUrl: 'http://catiecli.sukaka.top/images/cover-output.jpg',
      mimeType: 'image/jpeg',
      revisedPrompt: '',
    });
  });

  it('generates Cloudflare Workers AI covers through the same-origin relay to avoid browser CORS', async () => {
    const {
      CLOUDFLARE_COVER_IMAGE_MODELS,
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      saveCloudflareWorkersAISettings,
      routerModule: { PROVIDERS },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.CLOUDFLARE_WORKERS_AI, 'cf-workers-ai-token');
    saveCloudflareWorkersAISettings({ accountId: '35227c3d18fc83a0478996f9cad7e399' });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: { image: 'cf-cover-base64' },
      success: true,
      errors: [],
      messages: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI,
      model: CLOUDFLARE_COVER_IMAGE_MODELS[0].id,
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });

    expect(result).toEqual({
      b64: 'cf-cover-base64',
      mimeType: 'image/jpeg',
      revisedPrompt: '',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/cloudflare-workers-ai');
    expect(request.headers.Authorization).toBe('Bearer story-token');
    expect(request.headers['X-StoryForge-Upstream-Key']).toBe('cf-workers-ai-token');
    expect(request.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      action: 'run',
      accountId: '35227c3d18fc83a0478996f9cad7e399',
      model: '@cf/leonardo/lucid-origin',
      payload: {
        prompt: 'Artwork only. No text.',
        guidance: 4.5,
        num_steps: 30,
        width: 1024,
        height: 1536,
      },
    });
    expect(body.payload).not.toHaveProperty('size');
  });

  it('ships current Cloudflare Workers AI cover model defaults', async () => {
    const {
      CLOUDFLARE_COVER_IMAGE_MODELS,
      DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL,
      getCloudflareWorkersAIModelMeta,
      getCloudflareWorkersAIModelOptions,
    } = await loadCoverProviderStack();

    expect(CLOUDFLARE_COVER_IMAGE_MODELS.map((model) => model.id)).toEqual([
      '@cf/leonardo/lucid-origin',
      '@cf/black-forest-labs/flux-2-dev',
      '@cf/black-forest-labs/flux-2-klein-9b',
      '@cf/black-forest-labs/flux-2-klein-4b',
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/bytedance/stable-diffusion-xl-lightning',
      '@cf/lykon/dreamshaper-8-lcm',
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    ]);
    expect(DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL).toBe('@cf/leonardo/lucid-origin');
    expect(getCloudflareWorkersAIModelMeta(DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL)).toMatchObject({
      family: 'Leonardo',
      channel: 'Khuyến nghị bìa truyện',
    });
    expect(getCloudflareWorkersAIModelOptions()).toEqual([
      '@cf/leonardo/lucid-origin',
      '@cf/black-forest-labs/flux-2-dev',
      '@cf/black-forest-labs/flux-2-klein-9b',
      '@cf/black-forest-labs/flux-2-klein-4b',
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/bytedance/stable-diffusion-xl-lightning',
      '@cf/lykon/dreamshaper-8-lcm',
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    ]);
  });

  it('sends Cloudflare Flux 2 covers with cover dimensions for the multipart relay', async () => {
    const {
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      saveCloudflareWorkersAISettings,
      routerModule: { PROVIDERS },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.CLOUDFLARE_WORKERS_AI, 'cf-workers-ai-token');
    saveCloudflareWorkersAISettings({ accountId: '35227c3d18fc83a0478996f9cad7e399' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: { image: 'flux-2-cover-base64' },
      success: true,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const result = await generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI,
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });

    expect(result.b64).toBe('flux-2-cover-base64');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      action: 'run',
      model: '@cf/black-forest-labs/flux-2-klein-4b',
      payload: {
        prompt: 'Artwork only. No text.',
        steps: 25,
        width: 1024,
        height: 1536,
      },
    });
  });

  it('loads Cloudflare Workers AI image models through the same-origin relay', async () => {
    const {
      fetchCloudflareWorkersAIModels,
      keyManager,
      saveCloudflareWorkersAISettings,
      routerModule: { PROVIDERS },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.CLOUDFLARE_WORKERS_AI, 'cf-workers-ai-token');
    saveCloudflareWorkersAISettings({ accountId: '35227c3d18fc83a0478996f9cad7e399' });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: [
        { id: '@cf/meta/llama-3.1-8b-instruct' },
        { name: '@cf/black-forest-labs/flux-1-schnell' },
        { name: '@cf/bytedance/stable-diffusion-xl-lightning' },
      ],
      success: true,
      errors: [],
      messages: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchCloudflareWorkersAIModels();

    expect(models).toEqual([
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/bytedance/stable-diffusion-xl-lightning',
    ]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/cloudflare-workers-ai');
    expect(request.headers['X-StoryForge-Upstream-Key']).toBe('cf-workers-ai-token');
    expect(JSON.parse(request.body)).toMatchObject({
      action: 'models',
      accountId: '35227c3d18fc83a0478996f9cad7e399',
      search: 'image',
    });
  });

  it('requires a Cloudflare Account ID before calling Workers AI', async () => {
    const {
      CLOUDFLARE_COVER_IMAGE_MODELS,
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      routerModule: { PROVIDERS },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.CLOUDFLARE_WORKERS_AI, 'cf-workers-ai-token');
    vi.stubGlobal('fetch', vi.fn());

    await expect(generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI,
      model: CLOUDFLARE_COVER_IMAGE_MODELS[0].id,
      prompt: 'Artwork only. No text.',
    })).rejects.toMatchObject({
      code: 'COVER_IMAGE_MISSING_ACCOUNT_ID',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('generates through the image endpoint without changing chat provider or chat model settings', async () => {
    const {
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadCoverProviderStack();

    localStorage.setItem('sf-preferred-provider', PROVIDERS.GEMINI_DIRECT);
    localStorage.setItem('sf-proxy-model', 'chat-model-before');
    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-cover-test-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://proxy.example.com/v1',
      defaultModel: 'chat-text-model',
      models: ['chat-text-model', 'cover-image-model'],
      imageGenerationsPath: '/v1/images/generations',
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: 'cover-base64' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.OPENAI_PROXY,
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'cover-image-model',
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });

    expect(result.b64).toBe('cover-base64');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proxy.example.com/v1/images/generations');
    expect(url).not.toContain('/v1/chat/completions');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'cover-image-model',
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });
    expect(localStorage.getItem('sf-preferred-provider')).toBe(PROVIDERS.GEMINI_DIRECT);
    expect(localStorage.getItem('sf-proxy-model')).toBe('chat-model-before');
  });

  it('falls back to chat completions when a custom proxy does not expose the image endpoint', async () => {
    const {
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: {
        CUSTOM_PROXY_PROFILE_ID,
        setOpenAIProxyActiveProfile,
        updateCustomOpenAIProxyProfile,
      },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.OPENAI_PROXY, 'sk-cover-test-key');
    updateCustomOpenAIProxyProfile({
      baseUrl: 'https://ag.example.com/v1',
      defaultModel: 'gemini-3-pro-image-[AG]',
      models: ['gemini-3-pro-image-[AG]'],
      imageGenerationsPath: '/v1/images/generations',
      chatCompletionsPath: '/v1/chat/completions',
      transport: 'direct',
    });
    setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '![cover](http://ag.example.com/images/chat-cover.jpg)',
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.OPENAI_PROXY,
      proxyProfileId: CUSTOM_PROXY_PROFILE_ID,
      model: 'gemini-3-pro-image-[AG]',
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });

    expect(result).toMatchObject({
      b64: '',
      imageUrl: 'http://ag.example.com/images/chat-cover.jpg',
      mimeType: 'image/jpeg',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ag.example.com/v1/images/generations');
    expect(fetchMock.mock.calls[1][0]).toBe('https://ag.example.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      model: 'gemini-3-pro-image-[AG]',
      stream: false,
      size: '1024x1536',
      aspect_ratio: '2:3',
    });
  });

  it('uses AG chat completions image mode and gemini_proxy key pool for AG image models', async () => {
    const {
      AG_COVER_IMAGE_MODELS,
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      routerModule: { PROVIDERS },
      proxyConfigModule: { AG_PROXY_PROFILE_ID, DEFAULT_AG_PROXY_BASE_URL },
    } = await loadCoverProviderStack();

    localStorage.setItem('sf-preferred-provider', PROVIDERS.GEMINI_DIRECT);
    localStorage.setItem('sf-proxy-model', 'chat-model-before');
    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'ag-cover-test-key');

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '![cover](data:image/png;base64,ag-cover-base64)',
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.AG_PROXY,
      model: AG_COVER_IMAGE_MODELS[0].id,
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    });

    expect(result.b64).toBe('ag-cover-base64');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe('/api/openai-proxy');
    expect(request.headers['X-StoryForge-Upstream-Key']).toBe('ag-cover-test-key');
    expect(body).toMatchObject({
      action: 'chat',
      baseUrl: DEFAULT_AG_PROXY_BASE_URL,
      chatCompletionsPath: '/v1/chat/completions',
      payload: {
        model: 'gemini-3-pro-image-[星星公益站-反重力渠道]',
        stream: false,
        size: '1024x1536',
      },
    });
    expect(body.payload.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'Artwork only. No text.',
    });
    expect(body.payload.model).toBe(AG_COVER_IMAGE_MODELS[0].id);
    expect(body.payload.model).toContain('image');
    expect(body.baseUrl).not.toContain('/v1/chat/completions');
    expect(body.payload).not.toHaveProperty('prompt');
    expect(AG_PROXY_PROFILE_ID).toBe('ag-gemini-proxy');
    expect(localStorage.getItem('sf-preferred-provider')).toBe(PROVIDERS.GEMINI_DIRECT);
    expect(localStorage.getItem('sf-proxy-model')).toBe('chat-model-before');
  });

  it('reports provider rate limits clearly for AG image generation', async () => {
    const {
      AG_COVER_IMAGE_MODELS,
      COVER_IMAGE_PROVIDERS,
      generateCoverImage,
      keyManager,
      routerModule: { PROVIDERS },
    } = await loadCoverProviderStack();

    keyManager.addKey(PROVIDERS.GEMINI_PROXY, 'ag-cover-test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: 'Unknown error' },
    }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(generateCoverImage({
      provider: COVER_IMAGE_PROVIDERS.AG_PROXY,
      model: AG_COVER_IMAGE_MODELS[0].id,
      prompt: 'Artwork only. No text.',
      size: '1024x1536',
    })).rejects.toMatchObject({
      code: 'COVER_IMAGE_RATE_LIMITED',
      message: expect.stringContaining('giới hạn lượt'),
    });
  });

  it('prioritizes image-capable models before chat-only models in cover model lists', async () => {
    const {
      AG_COVER_IMAGE_MODELS,
      CLOUDFLARE_COVER_IMAGE_MODELS,
      sortCoverImageModels,
    } = await loadCoverProviderStack();

    expect(sortCoverImageModels([
      'claude-sonnet-4-5-[星星公益站-反重力渠道]',
      'gemini-3-pro-low-[星星公益站-反重力渠道]',
      'gemini-3-pro-image-preview-[星星公益站-反重力渠道]',
      'gemini-3-pro-image-[星星公益站-反重力渠道]',
    ])).toEqual([
      AG_COVER_IMAGE_MODELS[0].id,
      AG_COVER_IMAGE_MODELS[1].id,
      'claude-sonnet-4-5-[星星公益站-反重力渠道]',
      'gemini-3-pro-low-[星星公益站-反重力渠道]',
    ]);
    expect(sortCoverImageModels([
      '@cf/bytedance/stable-diffusion-xl-lightning',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/leonardo/lucid-origin',
      '@cf/black-forest-labs/flux-2-dev',
    ])).toEqual([
      CLOUDFLARE_COVER_IMAGE_MODELS[0].id,
      CLOUDFLARE_COVER_IMAGE_MODELS[1].id,
      CLOUDFLARE_COVER_IMAGE_MODELS[4].id,
      CLOUDFLARE_COVER_IMAGE_MODELS[5].id,
      '@cf/meta/llama-3.1-8b-instruct',
    ]);
  });
});

describe('phase19 project cover UI contract', () => {
  it('keeps the cover controls visible in Vietnamese with accents', () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), 'src/pages/Dashboard/Dashboard.jsx'), 'utf8');
    const storyBibleSource = readFileSync(resolve(process.cwd(), 'src/pages/StoryBible/sections/StoryBibleOverviewSection.jsx'), 'utf8');
    const coverPanelSource = readFileSync(resolve(process.cwd(), 'src/pages/StoryBible/components/ProjectCoverPanel.jsx'), 'utf8');
    const coverProviderSource = readFileSync(resolve(process.cwd(), 'src/services/projectCovers/coverImageProvider.js'), 'utf8');
    const settingsSource = readFileSync(resolve(process.cwd(), 'src/pages/Settings/Settings.jsx'), 'utf8');

    expect(dashboardSource).toContain('Thêm bìa');
    expect(storyBibleSource).toContain('ProjectCoverPanel');
    expect(coverPanelSource).toContain('Bìa & nhận diện truyện');
    expect(coverPanelSource).toContain('Model tạo bìa');
    expect(coverPanelSource).toContain('Nhà cung cấp ảnh');
    expect(coverPanelSource).toContain('Gemini Proxy mặc định (AG)');
    expect(coverPanelSource).toContain('Tìm model');
    expect(coverPanelSource).toContain('Model ảnh');
    expect(coverPanelSource).toContain('Đổi bìa');
    expect(coverPanelSource).toContain('Xóa bìa');
    expect(coverPanelSource).toContain('Dùng model đã nhập');
    expect(coverPanelSource).toContain('getActiveOpenAIProxyProfile(CUSTOM_PROXY_PROFILE_ID)');
    expect(coverPanelSource).toContain('OPENAI_PROXY_SETTINGS_CHANGED_EVENT');
    expect(coverPanelSource).toContain('readProjectCoverProxyProfiles');
    expect(coverPanelSource).toContain('Cloudflare Workers AI');
    expect(coverProviderSource).toContain('@cf/black-forest-labs/flux-1-schnell');
    expect(settingsSource).toContain('PROVIDERS.CLOUDFLARE_WORKERS_AI');
    expect(settingsSource).toContain('PROVIDER_CARD_CLOUDFLARE_COVER');
    expect(settingsSource).toContain('CloudflareWorkersAIModelSettingsPanel');
    expect(settingsSource).toContain('CloudflareWorkersAIAccountSettingsFields');
    expect(settingsSource).toContain('Account ID Cloudflare');
    expect(settingsSource).toContain('Model Cloudflare Workers AI');
    expect(settingsSource).toContain('CloudflareWorkersAIModelPicker');
    expect(settingsSource).toContain('Danh sách model Cloudflare');
    expect(settingsSource).toContain('Khuyến nghị bìa truyện');
    expect(settingsSource).toContain('Nhập model Cloudflare thủ công');
    expect(settingsSource).toContain('getCloudflareWorkersAIModelMeta');
    expect(settingsSource).toContain('Lấy model ảnh');
    expect(coverPanelSource).not.toContain('<datalist');
    expect(coverPanelSource).not.toContain('project-cover-proxy-models');
    expect(coverPanelSource).not.toContain('getActiveOpenAIProxyProfile(CUSTOM_PROXY_PROFILE_ID),\n  }), []);');
    expect(`${coverPanelSource}\n${coverProviderSource}`).toContain('gemini-3-pro-image-[星星公益站-反重力渠道]');
    expect(`${dashboardSource}\n${coverPanelSource}`).not.toMatch(/\b(Bia|Them bia|Model tao bia|Nha cung cap anh)\b/u);
  });
});
