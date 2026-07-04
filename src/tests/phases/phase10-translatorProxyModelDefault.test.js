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

function createClassList() {
  return { add() {}, remove() {}, toggle() {} };
}

function loadRuntime({ savedSettings = null } = {}) {
  const proxyModelSelect = createSelectElement();
  const customProxyModelSelect = createSelectElement();
  const elements = {
    proxyModelSelect,
    customProxyModelSelect,
    customPrompt: { value: '' },
    sourceLang: { value: 'auto', options: [{ textContent: 'Auto' }], selectedIndex: 0 },
    parallelCount: { value: '10' },
    chunkSize: { value: '4500' },
    rpmPerKey: { value: '10' },
    useProxyToggle: { checked: false },
    proxySettings: { style: {} },
    proxyStatus: { textContent: '', style: {} },
    proxyBaseUrlInput: { value: '' },
    customProxyToggle: { checked: false },
    customProxySettings: { style: {} },
    customProxyStatus: { textContent: '', style: {}, classList: { add() {}, remove() {} } },
    customProxyBaseUrlInput: { id: 'customProxyBaseUrlInput', value: '' },
    customProxyChatPreview: { textContent: '' },
    customProxyModelsPreview: { textContent: '' },
    customProxyKeysList: { innerHTML: '' },
    customProxyKeyCount: { textContent: '', style: {} },
    customProxyModelInput: { id: 'customProxyModelInput', value: '' },
    customProxyModelStatus: { textContent: '', className: '' },
    activateGeminiDirectButton: { textContent: '', disabled: false, classList: createClassList(), setAttribute() {} },
    useOllamaToggle: { checked: false },
    ollamaSettings: { style: {} },
    ollamaStatus: { textContent: '', style: {}, classList: createClassList() },
    ollamaUrl: { value: 'http://localhost:11434' },
    ollamaModel: { value: 'local-model' },
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
  context.window = context;

  vm.createContext(context);
  [
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/ui/settings.js',
    'public/translator-runtime/js/proxy/proxy-api.js',
    'public/translator-runtime/js/local-ai/ollama.js',
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
    expect(html).toContain('Gemini Proxy AG');
    expect(html).toContain('Custom Proxy');
    expect(html).toContain('id="customProxyBaseUrlInput"');
    expect(html).toContain('id="customProxyModelSelect"');
    expect(html).toContain('id="customProxyModelSearch"');
    expect(html).toContain('id="customProxyModelFilters"');
    expect(html).toContain('id="customProxyModelPicker"');
    expect(html).toContain('Lấy models');
    expect(html).toContain('Nhập model thủ công');
    expect(html).toContain('href="style.css?v=15"');
    expect(html).toContain('src="js/app.js?v=17"');
    expect(html).toContain('src="js/gemini/model-rotation.js?v=15"');
    expect(html).toContain('src="js/gemini/api.js?v=17"');
    expect(html).toContain('src="js/translation/retry.js?v=17"');
    expect(html).toContain('src="js/translation/engine.js?v=17"');
    expect(html).toContain('src="js/ui/chunk-tracker.js?v=15"');
    expect(html).toContain('src="js/proxy/proxy-api.js?v=15"');
    expect(html).toContain('src="js/init.js?v=14"');
  });

  it('keeps translator model filters visible on mobile without a one-line horizontal scroller', () => {
    const css = fs
      .readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8')
      .replace(/\r\n/gu, '\n');

    expect(css).toContain('.model-family-filters {\n        display: grid;');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(css).toContain('overflow-x: visible;');
    expect(css).toContain('.model-family-filter {\n        width: 100%;');
  });

  it('keeps the selected Custom Proxy model card compact on mobile', () => {
    const css = fs
      .readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8')
      .replace(/\r\n/gu, '\n');

    expect(css).toContain('.selected-model-card {\n        min-height: 0;');
    expect(css).toContain('max-height: 3.2rem;');
    expect(css).toContain('display: -webkit-box;');
    expect(css).toContain('-webkit-line-clamp: 2;');
  });

  it('keeps the manual Custom Proxy model input compact on mobile', () => {
    const css = fs
      .readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8')
      .replace(/\r\n/gu, '\n');

    expect(css).toContain('.add-model-row {\n        display: grid;');
    expect(css).toContain('background: rgba(99, 102, 241, 0.08);');
    expect(css).toContain('.add-model-row .model-name-input {\n        flex: 0 0 auto;');
    expect(css).toContain('height: 38px;');
    expect(css).toContain('.add-model-row .btn {\n        width: 100%;');
  });

  it('keeps every translator provider model control compact on mobile', () => {
    const css = fs
      .readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8')
      .replace(/\r\n/gu, '\n');

    expect(css).toContain('#geminiModelSelect,\n    #proxyModelSelect,\n    #ollamaModelSelect,\n    #ollamaModel,\n    #proxyCustomModel,\n    .model-name-input {');
    expect(css).toContain('min-height: 38px;');
    expect(css).toContain('background: rgba(2, 6, 23, 0.42) !important;');
    expect(css).toContain('border-color: rgba(129, 140, 248, 0.4) !important;');
  });

  it('keeps Custom Proxy model list items readable and highlighted on mobile', () => {
    const css = fs
      .readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8')
      .replace(/\r\n/gu, '\n');

    expect(css).toContain('.model-picker-list {\n        max-height: min(48vh, 380px);');
    expect(css).toContain('min-height: 300px;');
    expect(css).toContain('.model-picker-item {\n        min-height: 54px;');
    expect(css).toContain('.model-picker-item__id {\n        font-size: 0.8rem;');
    expect(css).toContain('.model-picker-item.is-active {\n        border-color: rgba(16, 185, 129, 0.72);');
    expect(css).toContain('.model-picker-badge {\n        min-height: 21px;');
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
    expect(vm.runInContext('proxyBaseUrl', context)).toBe('https://ag.beijixingxing.com/v1/chat/completions');
    expect(elements.proxyModelSelect.value).toBe(DEFAULT_MODEL);

    const saved = JSON.parse(stored.get('novelTranslatorProSettings'));
    expect(saved.proxyModel).toBe(DEFAULT_MODEL);
    expect(saved.proxyBaseUrl).toBe('https://ag.beijixingxing.com/v1/chat/completions');
  });

  it('activates Gemini Direct directly and disables every other provider', () => {
    const { context, elements, stored } = loadRuntime();

    vm.runInContext(`
      useProxy = true;
      useOllama = true;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
    `, context);
    elements.customProxyToggle.checked = true;
    elements.useOllamaToggle.checked = true;

    context.activateGeminiDirect();

    expect(vm.runInContext('useProxy', context)).toBe(false);
    expect(vm.runInContext('useOllama', context)).toBe(false);
    expect(vm.runInContext('activeTranslatorProvider', context)).toBe('gemini_direct');
    expect(elements.customProxyToggle.checked).toBe(false);
    expect(elements.useOllamaToggle.checked).toBe(false);
    expect(elements.activateGeminiDirectButton.disabled).toBe(true);
    expect(elements.activateGeminiDirectButton.textContent).toBe('Đang dùng Gemini Direct');
    expect(JSON.parse(stored.get('novelTranslatorProSettings'))).toEqual(
      expect.objectContaining({ useProxy: false, activeTranslatorProvider: 'gemini_direct' }),
    );
    expect(JSON.parse(stored.get('novelTranslatorOllamaSettings'))).toEqual(
      expect.objectContaining({ useOllama: false }),
    );
  });

  it('ignores main StoryForge custom proxy settings when translator settings are empty', () => {
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

    expect(vm.runInContext('activeTranslatorProvider', context)).toBe('gemini_direct');
    expect(vm.runInContext('proxyModel', context)).toBe(DEFAULT_MODEL);
    expect(elements.proxyModelSelect.value).toBe(DEFAULT_MODEL);
    expect(elements.proxyModelSelect.options.some((option) => option.value === customModel)).toBe(false);
    expect(vm.runInContext('proxyApiKeys', context)).toEqual([]);
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('');
    expect(elements.customProxyModelSelect.value).toBe('');
    expect(vm.runInContext('customProxyApiKeys', context)).toEqual([]);
  });

  it('keeps existing translator proxy settings instead of importing main StoryForge settings', () => {
    const customModel = 'google/gemini-custom-model';
    const { context, elements } = loadRuntime();

    vm.runInContext(`
      activeTranslatorProvider = 'ag_proxy';
      useProxy = true;
      proxyModel = 'ag-model-before-import';
      proxyApiKeys = ['sk-ag-existing'];
      customProxyProfile = {
        baseUrl: '',
        defaultModel: '',
        models: [],
        chatCompletionsPath: '/v1/chat/completions',
        modelsPath: '/v1/models',
        transport: 'auto'
      };
      customProxyApiKeys = [];
    `, context);

    context.localStorage.setItem('sf-preferred-provider', 'openai_proxy');
    context.localStorage.setItem('sf-api-keys-v2', JSON.stringify({
      gemini_proxy: [{ key: 'sk-ag-proxy-key' }],
      openai_proxy: [{ key: 'sk-custom-proxy-key' }],
    }));
    context.localStorage.setItem('sf-ai-settings', JSON.stringify({
      openAIProxy: {
        activeProfileId: 'custom-openai-proxy',
        customProfile: {
          baseUrl: 'https://custom.example/v1',
          defaultModel: customModel,
          models: [customModel],
        },
      },
    }));

    context.loadSettings();
    context.initProxyUI();

    expect(vm.runInContext('activeTranslatorProvider', context)).toBe('ag_proxy');
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('');
    expect(vm.runInContext('customProxyApiKeys', context)).toEqual([]);
    expect(vm.runInContext('proxyModel', context)).toBe('ag-model-before-import');
    expect(vm.runInContext('proxyApiKeys', context)).toEqual(['sk-ag-existing']);
    expect(elements.customProxyModelSelect.value).toBe('');
  });

  it('clears stale Custom Proxy models when the Base URL is removed', () => {
    const { context, elements } = loadRuntime({
      savedSettings: {
        useProxy: true,
        activeTranslatorProvider: 'custom_proxy',
        customProxyProfile: {
          baseUrl: 'https://old-custom.example/v1',
          defaultModel: 'old-custom-model',
          models: ['old-custom-model', 'old-custom-model-2'],
          chatCompletionsPath: '/v1/chat/completions',
          modelsPath: '/v1/models',
          transport: 'direct',
        },
        customProxyApiKeys: ['old-custom-key'],
        customProxyApiKey: 'old-custom-key',
      },
    });

    context.loadSettings();
    expect(vm.runInContext('customProxyProfile.models', context)).toEqual([
      'old-custom-model',
      'old-custom-model-2',
    ]);

    elements.customProxyBaseUrlInput.value = '';
    context.updateCustomProxyConfig();

    expect(vm.runInContext('customProxyProfile.baseUrl', context)).toBe('');
    expect(vm.runInContext('customProxyProfile.defaultModel', context)).toBe('');
    expect(vm.runInContext('customProxyProfile.models', context)).toEqual([]);
    expect(elements.customProxyModelSelect.options.some((option) => option.value === 'old-custom-model')).toBe(false);
  });

  it('does not import main StoryForge AG or Gemini Direct provider settings', () => {
    const { context, stored } = loadRuntime();

    stored.set('sf-preferred-provider', 'gemini_proxy');
    stored.set('sf-api-keys-v2', JSON.stringify({
      gemini_direct: [{ key: 'direct-key-from-main' }],
      gemini_proxy: [{ key: 'ag-key-from-main' }],
    }));
    stored.set('sf-ai-settings', JSON.stringify({
      proxyUrl: 'https://main-ag.example/v1/chat/completions',
    }));

    context.loadSettings();

    expect(vm.runInContext('activeTranslatorProvider', context)).toBe('gemini_direct');
    expect(vm.runInContext('apiKeys', context)).toEqual([]);
    expect(vm.runInContext('proxyApiKeys', context)).toEqual([]);
    expect(vm.runInContext('proxyBaseUrl', context)).not.toBe('https://main-ag.example/v1/chat/completions');
  });

  it('does not import main StoryForge Ollama settings when translator Ollama settings are empty', () => {
    const { context, stored } = loadRuntime();

    stored.set('sf-preferred-provider', 'ollama');
    stored.set('sf-ai-settings', JSON.stringify({
      ollamaUrl: 'http://main-ollama.local:11434',
    }));
    stored.set('sf-ollama-model', 'main-ollama-model');

    context.loadOllamaSettings();

    expect(vm.runInContext('useOllama', context)).toBe(false);
    expect(vm.runInContext('ollamaUrl', context)).toBe('');
    expect(vm.runInContext('ollamaModel', context)).toBe('');
  });
});
