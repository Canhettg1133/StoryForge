import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const DEFAULT_MODEL = 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]';

function createSelectElement() {
  const select = {
    value: '',
    innerHTML: '',
    options: [],
    appendChild(option) {
      this.options.push(option);
      if (option.selected) this.value = option.value;
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
});
