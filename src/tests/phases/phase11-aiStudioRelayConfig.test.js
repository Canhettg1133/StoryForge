import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_RELAY_URL = 'https://storyforge-ai-studio-relay.canhettg113.workers.dev';
const DEFAULT_CONNECTOR_URL = 'https://ai.studio/apps/685f3deb-17d8-4197-9733-a8f144543129';

async function loadClient() {
  vi.resetModules();
  return import('../../services/ai/client.js');
}

describe('AI Studio Relay public configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('uses public production fallbacks when Vercel env vars are missing', async () => {
    vi.stubEnv('VITE_AI_STUDIO_RELAY_URL', '');
    vi.stubEnv('VITE_AI_STUDIO_CONNECTOR_URL', '');

    const { getAIStudioConnectorUrl, getAIStudioRelayUrl } = await loadClient();

    expect(getAIStudioRelayUrl()).toBe(DEFAULT_RELAY_URL);
    expect(getAIStudioConnectorUrl()).toBe(DEFAULT_CONNECTOR_URL);
  });

  it('lets Vercel env vars override the public fallback', async () => {
    vi.stubEnv('VITE_AI_STUDIO_RELAY_URL', 'https://relay.example.workers.dev');
    vi.stubEnv('VITE_AI_STUDIO_CONNECTOR_URL', 'https://ai.studio/apps/env-connector');

    const { getAIStudioConnectorUrl, getAIStudioRelayUrl } = await loadClient();

    expect(getAIStudioRelayUrl()).toBe('https://relay.example.workers.dev');
    expect(getAIStudioConnectorUrl()).toBe('https://ai.studio/apps/env-connector');
  });

  it('keeps user Settings above Vercel env vars', async () => {
    vi.stubEnv('VITE_AI_STUDIO_RELAY_URL', 'https://relay.example.workers.dev');
    vi.stubEnv('VITE_AI_STUDIO_CONNECTOR_URL', 'https://ai.studio/apps/env-connector');

    const { getAIStudioConnectorUrl, getAIStudioRelayUrl, saveSettings } = await loadClient();
    saveSettings({
      aiStudioRelayUrl: 'https://relay.user.example',
      aiStudioConnectorUrl: 'https://ai.studio/apps/user-connector',
    });

    expect(getAIStudioRelayUrl()).toBe('https://relay.user.example');
    expect(getAIStudioConnectorUrl()).toBe('https://ai.studio/apps/user-connector');
  });
});
