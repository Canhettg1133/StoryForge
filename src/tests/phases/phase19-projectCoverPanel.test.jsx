import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coverRepositoryMock = vi.hoisted(() => ({
  COVER_ASSET_SOURCES: { UPLOAD: 'upload', GENERATED: 'generated' },
  COVER_IMAGE_ACCEPT: 'image/png,image/jpeg,image/webp',
  createProjectCoverAsset: vi.fn(),
  createProjectCoverAssetFromFile: vi.fn(),
  dataUrlFromBase64: vi.fn((b64, mimeType = 'image/png') => `data:${mimeType};base64,${b64}`),
  deleteProjectCoverAsset: vi.fn(),
  getActiveProjectCover: vi.fn(),
  getProjectCoverGenerationSettings: vi.fn((project = {}) => ({
    provider: project.cover_image_provider || 'gemini_direct',
    model: project.cover_image_model || '',
    proxyProfileId: project.cover_image_proxy_profile_id || '',
    prompt: project.cover_image_prompt || '',
  })),
  listProjectCoverAssets: vi.fn(),
  setProjectCoverAsset: vi.fn(),
}));

const coverProviderMock = vi.hoisted(() => ({
  AG_COVER_IMAGE_MODELS: [{ id: 'gemini-3-pro-image-[AG]', label: 'Gemini 3 Pro Image (AG)' }],
  CLOUDFLARE_COVER_IMAGE_MODELS: [{ id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell' }],
  CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT: 'storyforge:cloudflare-workers-ai-settings-changed',
  COVER_IMAGE_PROVIDERS: {
    GEMINI_DIRECT: 'gemini_direct',
    AG_PROXY: 'gemini_proxy',
    OPENAI_PROXY: 'openai_proxy',
    CLOUDFLARE_WORKERS_AI: 'cloudflare_workers_ai',
  },
  DEFAULT_COVER_IMAGE_SIZE: '1024x1536',
  DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
  DEFAULT_GEMINI_COVER_IMAGE_MODEL: 'gemini-cover-image',
  GEMINI_COVER_IMAGE_MODELS: [{ id: 'gemini-cover-image', label: 'Gemini Cover Image' }],
  buildCoverArtworkPrompt: vi.fn(() => 'Artwork prompt'),
  generateCoverImage: vi.fn(),
  getCloudflareWorkersAIModelOptions: vi.fn(() => ['@cf/black-forest-labs/flux-1-schnell']),
  getCloudflareWorkersAISettings: vi.fn(() => ({
    defaultModel: '@cf/black-forest-labs/flux-1-schnell',
    models: [],
  })),
  getCoverProviderLabel: vi.fn((provider) => provider),
  isLikelyCoverImageModel: vi.fn(() => true),
  sortCoverImageModels: vi.fn((models = []) => [...new Set((Array.isArray(models) ? models : []).filter(Boolean))]),
}));

vi.mock('../../services/projectCovers/coverRepository.js', () => coverRepositoryMock);
vi.mock('../../services/projectCovers/coverImageProvider.js', () => coverProviderMock);
vi.mock('../../services/ai/keyManager.js', () => ({
  default: { getKeyCount: vi.fn(() => 1) },
}));
vi.mock('../../services/ai/router.js', () => ({
  PROVIDERS: {
    GEMINI_DIRECT: 'gemini_direct',
    GEMINI_PROXY: 'gemini_proxy',
    OPENAI_PROXY: 'openai_proxy',
    CLOUDFLARE_WORKERS_AI: 'cloudflare_workers_ai',
  },
}));
vi.mock('../../services/ai/openAIProxyConfig.js', () => ({
  AG_PROXY_PROFILE_ID: 'ag-gemini-proxy',
  CUSTOM_PROXY_PROFILE_ID: 'custom-openai-proxy',
  OPENAI_PROXY_SETTINGS_CHANGED_EVENT: 'storyforge:openai-proxy-settings-changed',
  getActiveOpenAIProxyProfile: vi.fn(() => ({ defaultModel: '', models: [] })),
  getAgOpenAIProxyProfile: vi.fn(() => ({ defaultModel: 'gemini-3-pro-image-[AG]', models: [] })),
}));
vi.mock('../../utils/constants.js', () => ({
  TONES: [],
  getGenreLabel: vi.fn(() => 'Fantasy'),
}));

import ProjectCoverPanel from '../../pages/StoryBible/components/ProjectCoverPanel.jsx';

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('phase19 project cover panel generation', () => {
  let container;
  let root;
  let nextAssetId;

  beforeEach(() => {
    nextAssetId = 100;
    coverRepositoryMock.createProjectCoverAsset.mockImplementation(async ({ dataUrl, thumbnailDataUrl }) => {
      nextAssetId += 1;
      return {
        id: nextAssetId,
        data_url: dataUrl,
        thumbnail_data_url: thumbnailDataUrl || dataUrl,
      };
    });
    coverRepositoryMock.listProjectCoverAssets.mockResolvedValue([]);
    coverRepositoryMock.getActiveProjectCover.mockResolvedValue(null);
    coverProviderMock.generateCoverImage.mockResolvedValue({
      b64: 'generated-cover',
      mimeType: 'image/png',
      revisedPrompt: '',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPanel(project, onSaveProjectSettings = vi.fn()) {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectCoverPanel
          project={project}
          onSaveProjectSettings={onSaveProjectSettings}
        />,
      );
      await flushAsync();
    });
    return onSaveProjectSettings;
  }

  it('activates the first generated cover when the project has no active cover metadata', async () => {
    const onSaveProjectSettings = await renderPanel({
      id: 1,
      title: 'No Cover Yet',
      genre_primary: 'fantasy',
      cover_asset_id: 0,
      cover_thumbnail_data_url: '',
    });

    const generateButton = container.querySelector('.project-cover-actions .btn-primary');
    await act(async () => {
      generateButton.click();
      await flushAsync();
    });

    expect(coverRepositoryMock.createProjectCoverAsset).toHaveBeenCalledTimes(2);
    expect(coverRepositoryMock.createProjectCoverAsset.mock.calls[0][0]).toMatchObject({
      source: 'generated',
      activate: true,
    });
    expect(coverRepositoryMock.createProjectCoverAsset.mock.calls[1][0]).toMatchObject({
      source: 'generated',
      activate: false,
    });
    expect(onSaveProjectSettings).toHaveBeenCalledWith(expect.objectContaining({
      cover_asset_id: 101,
      cover_thumbnail_data_url: 'data:image/png;base64,generated-cover',
    }));
  });

  it('keeps the current active cover when generating additional variants', async () => {
    const onSaveProjectSettings = await renderPanel({
      id: 1,
      title: 'Existing Cover',
      genre_primary: 'fantasy',
      cover_asset_id: 9,
      cover_thumbnail_data_url: 'data:image/png;base64,current-cover',
    });

    const generateButton = container.querySelector('.project-cover-actions .btn-primary');
    await act(async () => {
      generateButton.click();
      await flushAsync();
    });

    expect(coverRepositoryMock.createProjectCoverAsset).toHaveBeenCalledTimes(2);
    expect(coverRepositoryMock.createProjectCoverAsset.mock.calls.every((call) => call[0].activate === false)).toBe(true);
    expect(onSaveProjectSettings.mock.calls.some(([patch]) => patch.cover_asset_id === 101)).toBe(false);
  });
});
