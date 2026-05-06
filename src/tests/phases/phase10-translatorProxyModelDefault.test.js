import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const DEFAULT_MODEL = 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]';

function createSelectElement() {
  const select = {
    _value: '',
    innerHTML: '',
    options: [],
    get value() {
      return this._value;
    },
    set value(nextValue) {
      const normalized = String(nextValue || '');
      this._value = this.options.some((option) => option.value === normalized) ? normalized : '';
    },
    appendChild(option) {
      this.options.push(option);
      if (option.selected) this._value = option.value;
    },
  };
  return select;
}

function loadRuntime({ savedSettings = null } = {}) {
  const proxyModelSelect = createSelectElement();
  const elements = {
    proxyModelSelect,
    customPrompt: { value: '' },
    sourceLang: { value: 'auto', options: [{ textContent: 'Auto' }], selectedIndex: 0 },
    parallelCount: { value: '10' },
    chunkSize: { value: '4500' },
    delayMs: { value: '5000' },
    useProxyToggle: { checked: false },
    proxySettings: { style: {} },
    proxyStatus: { textContent: '', style: {} },
    proxyBaseUrlInput: { value: '' },
  };

  const stored = new Map();
  if (savedSettings) {
    stored.set('novelTranslatorProSettings', JSON.stringify(savedSettings));
  }

  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: {
      getItem(key) {
        return stored.has(key) ? stored.get(key) : null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      },
    },
    document: {
      addEventListener() {},
      createElement(tagName) {
        if (tagName === 'optgroup') return { label: '', children: [], appendChild(child) { this.children.push(child); } };
        if (tagName === 'option') return { value: '', textContent: '', selected: false };
        return {};
      },
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
    },
    showToast() {},
  };

  vm.createContext(context);
  [
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/ui/settings.js',
    'public/translator-runtime/js/proxy/proxy-api.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });
  vm.runInContext('useOllama = false; ollamaModel = ""; ollamaUrl = "";', context);

  return { context, elements, stored };
}

describe('phase10 translator proxy model default', () => {
  it('ships the proxy default model and versioned runtime assets in the translator HTML', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');

    expect(html).toContain(`<option value="${DEFAULT_MODEL}" selected>`);
    expect(html).toContain('Gemini 3 Flash HIGH');
    expect(html).toContain('href="style.css?v=10"');
    expect(html).toContain('src="js/app.js?v=10"');
    expect(html).toContain('src="js/proxy/proxy-api.js?v=10"');
    expect(html).toContain('src="js/init.js?v=10"');
  });

  it('defaults Gemini Proxy to Flash 3 when saved translator settings do not contain a model', () => {
    const { context, elements, stored } = loadRuntime({
      savedSettings: {
        useProxy: true,
        proxyApiKeys: ['sk-demo'],
        proxyBaseUrl: '/api/proxy/v1/chat/completions',
        proxyModel: '',
      },
    });

    context.loadSettings();
    context.renderProxyModelsDropdown();

    const proxyModel = vm.runInContext('proxyModel', context);
    expect(proxyModel).toBe(DEFAULT_MODEL);
    expect(elements.proxyModelSelect.value).toBe(DEFAULT_MODEL);

    const saved = JSON.parse(stored.get('novelTranslatorProSettings'));
    expect(saved.proxyModel).toBe(DEFAULT_MODEL);
  });

  it('re-renders the proxy dropdown after importing a custom proxy model from StoryForge settings', () => {
    const customModel = 'custom-gemini-model-from-main-settings';
    const { context, elements, stored } = loadRuntime();

    stored.set('sf-preferred-provider', 'openai_proxy');
    stored.set('sf-api-keys-v2', JSON.stringify({
      openai_proxy: [{ key: 'sk-custom-proxy-key' }],
      gemini_proxy: [{ key: 'sk-ag-proxy-key' }],
    }));
    stored.set('sf-ai-settings', JSON.stringify({
      openAIProxy: {
        activeProfileId: 'custom-openai-proxy',
        customProfile: {
          baseUrl: 'https://custom.example/v1',
          defaultModel: customModel,
          models: [customModel],
        },
      },
    }));

    context.initProxyUI();
    context.loadSettings();

    expect(vm.runInContext('proxyModel', context)).toBe(customModel);
    expect(elements.proxyModelSelect.value).toBe(customModel);
    expect(elements.proxyModelSelect.options.some((option) => option.value === customModel)).toBe(true);
    expect(vm.runInContext('proxyApiKeys', context)).toEqual(['sk-custom-proxy-key']);
  });
});
