import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'public/translator-runtime/js/proxy/custom-proxy-presets.js'),
  'utf8',
);

function createRuntime() {
  const stored = new Map();
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => 'generated-preset-id' },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
  });
  context.window = context;
  vm.runInContext(`
    const CUSTOM_PROXY_PROFILE_ID = 'custom-openai-proxy';
    const DEFAULT_CUSTOM_PROXY_PROFILE = {
      id: CUSTOM_PROXY_PROFILE_ID,
      label: 'Custom OpenAI-compatible',
      baseUrl: '',
      defaultModel: '',
      models: [],
      chatCompletionsPath: '/v1/chat/completions',
      modelsPath: '/v1/models',
      transport: 'auto'
    };
    let customProxyProfile = { ...DEFAULT_CUSTOM_PROXY_PROFILE };
    let customProxyApiKey = '';
    let customProxyApiKeys = [];
    let customProxyKeyHealthMap = {};
    let isTranslating = false;
    let toastMessages = [];
    let saveCalls = 0;
    function saveSettings() { saveCalls += 1; }
    function showToast(message) { toastMessages.push(message); }
    function renderCustomProxyPreviews() {}
    function renderCustomProxyKeysList() {}
    function renderCustomProxyModelsDropdown() {}
    function updateWorkspaceToolbar() {}
  `, context);
  vm.runInContext(source, context);
  return { context, stored };
}

describe('translator Custom Proxy saved sets', () => {
  it('stores and switches URL plus API keys without reading StoryForge main settings', () => {
    const { context, stored } = createRuntime();

    vm.runInContext(`
      customProxyProfile = {
        ...DEFAULT_CUSTOM_PROXY_PROFILE,
        label: 'Translator A',
        baseUrl: 'https://translator-a.example/v1',
        defaultModel: 'model-a'
      };
      customProxyApiKeys = ['sk-translator-a-123'];
      customProxyApiKey = customProxyApiKeys[0];
      saveCurrentTranslatorCustomProxyPreset({ id: 'translator-a', label: 'Translator A' });

      customProxyProfile = {
        ...DEFAULT_CUSTOM_PROXY_PROFILE,
        label: 'Translator B',
        baseUrl: 'https://translator-b.example/v1',
        defaultModel: 'model-b'
      };
      customProxyApiKeys = ['sk-translator-b-456'];
      customProxyApiKey = customProxyApiKeys[0];
      saveCurrentTranslatorCustomProxyPreset({ id: 'translator-b', label: 'Translator B' });

      activateTranslatorCustomProxyPreset('translator-a');
    `, context);

    expect(vm.runInContext('customProxyProfile.baseUrl', context))
      .toBe('https://translator-a.example/v1');
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('model-a');
    expect(vm.runInContext('[...customProxyApiKeys]', context)).toEqual(['sk-translator-a-123']);
    expect(vm.runInContext('getTranslatorCustomProxyPresetState().activePresetId', context))
      .toBe('translator-a');
    expect(stored.has('novelTranslatorCustomProxyPresetsV1')).toBe(true);
    expect(stored.has('sf-ai-settings')).toBe(false);
    expect(stored.has('sf-api-keys-v2')).toBe(false);
  });

  it('reports unsaved changes and tolerates damaged preset storage', () => {
    const { context, stored } = createRuntime();
    stored.set('novelTranslatorCustomProxyPresetsV1', '{broken');

    expect(vm.runInContext('getTranslatorCustomProxyPresetState().presets.length', context)).toBe(0);

    vm.runInContext(`
      customProxyProfile = {
        ...DEFAULT_CUSTOM_PROXY_PROFILE,
        baseUrl: 'https://translator.example/v1'
      };
      customProxyApiKeys = ['sk-translator-123'];
      saveCurrentTranslatorCustomProxyPreset({ id: 'translator', label: 'Translator' });
      customProxyProfile.baseUrl = 'https://edited.example/v1';
    `, context);

    expect(vm.runInContext('isCurrentTranslatorCustomProxyPresetDirty()', context)).toBe(true);
  });

  it('does not switch URL or keys while a translation is running', () => {
    const { context } = createRuntime();

    vm.runInContext(`
      customProxyProfile = { ...DEFAULT_CUSTOM_PROXY_PROFILE, baseUrl: 'https://a.example/v1' };
      customProxyApiKeys = ['sk-translator-a-123'];
      saveCurrentTranslatorCustomProxyPreset({ id: 'a', label: 'A' });
      customProxyProfile = { ...DEFAULT_CUSTOM_PROXY_PROFILE, baseUrl: 'https://b.example/v1' };
      customProxyApiKeys = ['sk-translator-b-456'];
      saveCurrentTranslatorCustomProxyPreset({ id: 'b', label: 'B' });
      isTranslating = true;
      requestTranslatorCustomProxyPresetSwitch({ dataset: { presetId: 'a' } });
    `, context);

    expect(vm.runInContext('customProxyProfile.baseUrl', context)).toBe('https://b.example/v1');
    expect(vm.runInContext('[...customProxyApiKeys]', context)).toEqual(['sk-translator-b-456']);
    expect(vm.runInContext('toastMessages[0]', context)).toContain('hoàn tất lượt dịch');
  });

  it('wires the saved-set UI and runtime through versioned translator assets', () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), 'public/translator-runtime/index.html'),
      'utf8',
    );
    const init = fs.readFileSync(
      path.join(process.cwd(), 'public/translator-runtime/js/init.js'),
      'utf8',
    );

    expect(html).toContain('id="translatorCustomProxyPresetList"');
    expect(html).toContain('src="js/proxy/custom-proxy-presets.js?v=1"');
    expect(html).toContain('href="custom-proxy-presets.css?v=1"');
    expect(init).toContain('useTranslatorCustomProxyPreset');
    expect(init).toContain('deleteTranslatorCustomProxyPreset');
  });
});
