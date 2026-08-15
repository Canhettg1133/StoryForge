import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadPresetRuntime() {
  vi.resetModules();
  const config = await import('../../services/ai/openAIProxyConfig.js');
  const { default: keyManager } = await import('../../services/ai/keyManager.js');
  const presets = await import('../../services/ai/customOpenAIProxyPresets.js');
  return { config, keyManager, presets };
}

describe('Custom OpenAI proxy saved sets', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('keeps each saved URL paired with its own API keys and restores both together', async () => {
    const { config, keyManager, presets } = await loadPresetRuntime();

    config.updateCustomOpenAIProxyProfile({
      label: 'Provider A',
      baseUrl: 'https://provider-a.example/v1',
      defaultModel: 'model-a',
    });
    keyManager.replaceKeys('openai_proxy', ['sk-provider-a-123456']);
    presets.saveCurrentCustomOpenAIProxyPreset({ id: 'provider-a', label: 'Provider A' });

    config.updateCustomOpenAIProxyProfile({
      label: 'Provider B',
      baseUrl: 'https://provider-b.example/v1',
      defaultModel: 'model-b',
    });
    keyManager.replaceKeys('openai_proxy', ['sk-provider-b-654321']);
    presets.saveCurrentCustomOpenAIProxyPreset({ id: 'provider-b', label: 'Provider B' });

    const stateBeforeSwitch = presets.getCustomOpenAIProxyPresetState();
    expect(stateBeforeSwitch.presets).toHaveLength(2);
    expect(stateBeforeSwitch.activePresetId).toBe('provider-b');
    expect(stateBeforeSwitch.presets.find((item) => item.id === 'provider-a')?.keys)
      .toEqual([{ key: 'sk-provider-a-123456', label: 'Key 1' }]);

    keyManager.markRateLimited('sk-provider-a-123456', 60_000);
    expect(keyManager.isRateLimited('sk-provider-a-123456')).toBe(true);
    const activated = presets.activateCustomOpenAIProxyPreset('provider-a');

    expect(activated.profile.baseUrl).toBe('https://provider-a.example/v1');
    expect(activated.profile.defaultModel).toBe('model-a');
    expect(keyManager.getKeys('openai_proxy')).toEqual([
      { key: 'sk-provider-a-123456', label: 'Key 1' },
    ]);
    expect(keyManager.isRateLimited('sk-provider-a-123456')).toBe(false);
    expect(config.getOpenAIProxySettings().customProfile.baseUrl)
      .toBe('https://provider-a.example/v1');
    expect(presets.getCustomOpenAIProxyPresetState().activePresetId).toBe('provider-a');
    expect(presets.isCurrentCustomOpenAIProxyPresetDirty()).toBe(false);
  });

  it('marks unsaved URL or key changes as dirty without writing every edit into the saved set', async () => {
    const { config, keyManager, presets } = await loadPresetRuntime();

    config.updateCustomOpenAIProxyProfile({
      label: 'Stable provider',
      baseUrl: 'https://stable.example/v1',
      defaultModel: 'stable-model',
    });
    keyManager.replaceKeys('openai_proxy', ['sk-stable-provider-123']);
    presets.saveCurrentCustomOpenAIProxyPreset({ id: 'stable-provider', label: 'Stable provider' });

    config.updateCustomOpenAIProxyProfile({ baseUrl: 'https://edited.example/v1' });
    expect(presets.isCurrentCustomOpenAIProxyPresetDirty()).toBe(true);

    presets.activateCustomOpenAIProxyPreset('stable-provider');
    keyManager.replaceKeys('openai_proxy', ['sk-replaced-provider-456']);
    expect(presets.isCurrentCustomOpenAIProxyPresetDirty()).toBe(true);
  });

  it('recovers from malformed local preset data and deletes only the requested saved set', async () => {
    localStorage.setItem('sf-custom-openai-proxy-presets-v1', '{broken');
    const { config, keyManager, presets } = await loadPresetRuntime();

    expect(presets.getCustomOpenAIProxyPresetState()).toEqual({
      activePresetId: '',
      presets: [],
    });

    config.updateCustomOpenAIProxyProfile({ baseUrl: 'https://keep-current.example/v1' });
    keyManager.replaceKeys('openai_proxy', ['sk-keep-current-123']);
    presets.saveCurrentCustomOpenAIProxyPreset({ id: 'keep-current', label: 'Keep current' });

    expect(presets.removeCustomOpenAIProxyPreset('keep-current')).toBe(true);
    expect(presets.getCustomOpenAIProxyPresetState()).toEqual({
      activePresetId: '',
      presets: [],
    });
    expect(config.getOpenAIProxySettings().customProfile.baseUrl)
      .toBe('https://keep-current.example/v1');
    expect(keyManager.getKeys('openai_proxy')).toHaveLength(1);
  });
});
