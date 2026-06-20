import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function createRuntimeContext(fetchImpl) {
  const stored = new Map();
  const toastMessages = [];
  const elements = {
    newApiKey: { value: '', focus() {} },
    apiKeysList: { innerHTML: '' },
    apiCount: { textContent: '', style: {} },
    modelsList: { innerHTML: '' },
    modelCount: { textContent: '', style: {} },
    geminiModelSelect: { innerHTML: '', value: '' },
    presetModelSelect: { innerHTML: '' },
    aiStudioModelPicker: { innerHTML: '', style: {} },
    aiStudioModelSelect: {
      innerHTML: '',
      value: '',
      addEventListener() {},
    },
    aiStudioModelStatus: { textContent: '', className: '' },
  };

  const context = {
    AbortController,
    clearTimeout,
    setTimeout,
    URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    fetch: fetchImpl,
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
      getElementById(id) {
        return elements[id] || null;
      },
    },
    showToast(message, type) {
      toastMessages.push({ message, type });
    },
    saveSettings() {},
    updateWorkspaceToolbar() {},
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/app.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/app.js' },
  );

  return { context, stored, toastMessages, elements };
}

describe('phase10 translator AI Studio model discovery', () => {
  it('accepts Gemini Direct keys without assuming an AIza prefix', () => {
    const { context, elements } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by key import');
    });

    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/gemini/model-rotation.js'), 'utf8'),
      context,
      { filename: 'public/translator-runtime/js/gemini/model-rotation.js' },
    );

    elements.newApiKey.value = 'new-key';
    context.addApiKey();

    expect(vm.runInContext('apiKeys', context)).toEqual(['new-key']);
    expect(context.parseApiKeysFromText('next-format\nAIza-legacy').validKeys).toEqual([
      'next-format',
      'AIza-legacy',
    ]);
  });

  it('renders the compact Gemini Direct controls without per-model quota UI', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');
    const initScript = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');

    expect(html).toContain('id="activateGeminiDirectButton"');
    expect(html).toContain('onclick="fetchAIStudioFreeModels()"');
    expect(html).toContain('Lấy model từ AI Studio');
    expect(html).toContain('id="geminiModelSelect"');
    expect(html).toContain('class="gemini-direct-grid"');
    expect(html).not.toContain('id="rpdDashboard"');
    expect(html).not.toContain('Gemini Direct • RPM / RPD');
    expect(html).not.toContain('model-quota-input');
    expect(html).not.toContain('model-rpd-input');
    expect(html).not.toContain('js/gemini/rpd-tracker.js');
    expect(css).toMatch(/\.gemini-direct-grid\s*\{[\s\S]*?grid-template-columns:/u);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.gemini-direct-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/u);
    expect(initScript).toContain('window.fetchAIStudioFreeModels = fetchAIStudioFreeModels');
    expect(initScript).toContain('window.selectGeminiModel = selectGeminiModel');
  });

  it('fetches AI Studio text models for selection without enabling every discovered model', async () => {
    let requestedUrl = '';
    const { context, stored, toastMessages, elements } = createRuntimeContext(async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.1-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
            { name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/imagen-4.0-generate-preview', supportedGenerationMethods: ['predict'] },
          ],
        }),
      };
    });

    vm.runInContext(`
      apiKeys = ['direct-key-for-list-models'];
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', quota: 5, enabled: true }];
    `, context);

    const discovered = await context.fetchAIStudioFreeModels();

    expect(requestedUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models?key=direct-key-for-list-models');
    expect(discovered.map((model) => model.name)).toEqual([
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemma-4-31b-it',
    ]);
    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual([
      'gemini-2.5-flash',
    ]);

    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(elements.geminiModelSelect.innerHTML).toContain('gemini-2.5-pro');
    expect(toastMessages.at(-1)).toEqual(expect.objectContaining({
      type: 'success',
      message: expect.stringContaining('Chọn 1 model'),
    }));

    context.selectGeminiModel('gemini-2.5-pro');

    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual([
      'gemini-2.5-pro',
    ]);
    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(JSON.parse(stored.get('novelTranslatorActiveDirectModels'))).toEqual([
      { id: 'gemini-2.5-pro' },
    ]);
  });

  it('can select one discovered AI Studio model as the only active translation model', async () => {
    const { context, stored } = createRuntimeContext(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    }));

    vm.runInContext('apiKeys = ["direct-key-for-list-models"]; GEMINI_MODELS = [];', context);
    await context.fetchAIStudioFreeModels();
    context.selectGeminiModel('gemma-3-27b-it');

    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual(['gemma-3-27b-it']);
    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(JSON.parse(stored.get('novelTranslatorActiveDirectModels'))).toEqual([
      { id: 'gemma-3-27b-it' },
    ]);
  });

  it('migrates legacy multi-model records to one selected model without quota fields', () => {
    const { context, stored } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by model hydration');
    });

    stored.set('novelTranslatorModels', JSON.stringify([
      { name: 'gemma-4-31b-it', quota: 15, enabled: true },
      { name: 'gemini-2.5-flash', quota: 5, enabled: true },
    ]));

    context.loadGeminiModels();

    expect(vm.runInContext('GEMINI_MODELS', context)).toEqual([
      { name: 'gemma-4-31b-it', enabled: true },
      { name: 'gemini-2.5-flash', enabled: false },
    ]);
  });

  it('explains in Vietnamese when no Gemini Direct key is available for ListModels', async () => {
    const { context, toastMessages } = createRuntimeContext(async () => {
      throw new Error('fetch should not be called without a key');
    });

    vm.runInContext('apiKeys = [];', context);

    const imported = await context.fetchAIStudioFreeModels();

    expect(imported).toEqual([]);
    expect(toastMessages.at(-1)).toEqual({
      type: 'warning',
      message: 'Thêm ít nhất 1 Gemini Direct API key trước khi lấy model từ AI Studio.',
    });
  });

  it('uses only active Gemini Direct models when selecting model/key pairs for translation', () => {
    const { context } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by model rotation');
    });

    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/gemini/model-rotation.js'), 'utf8'),
      context,
      { filename: 'public/translator-runtime/js/gemini/model-rotation.js' },
    );

    vm.runInContext(`
      apiKeys = ['direct-key'];
      GEMINI_MODELS = [
        { name: 'disabled-flash', quota: 5, enabled: false },
        { name: 'active-pro', quota: 5, enabled: true }
      ];
    `, context);

    const pair = context.getBestAvailablePair();
    expect(pair.model).toBe('active-pro');
  });

  it('does not force a Gemini Direct pair when its key is out of shared RPM', () => {
    const { context } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by model rotation');
    });

    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/gemini/model-rotation.js'), 'utf8'),
      context,
      { filename: 'public/translator-runtime/js/gemini/model-rotation.js' },
    );

    vm.runInContext(`
      apiKeys = ['direct-key'];
      rpmPerKey = 1;
      GEMINI_MODELS = [{ name: 'gemma-4-31b-it', enabled: true }];
      recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.GEMINI_DIRECT, 0);
    `, context);

    expect(() => context.getBestAvailablePair()).toThrow(/giới hạn RPM chung/);
  });
});
