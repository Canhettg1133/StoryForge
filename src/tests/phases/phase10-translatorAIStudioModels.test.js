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
    renderRPDDashboard() {},
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

  it('exposes a button in the translator model panel to fetch AI Studio models', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const initScript = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');

    expect(html).toContain('onclick="fetchAIStudioFreeModels()"');
    expect(html).toContain('Lấy model AI Studio');
    expect(html).toContain('id="aiStudioModelSelect"');
    expect(html).toContain('id="customModelRpd"');
    expect(initScript).toContain('window.fetchAIStudioFreeModels = fetchAIStudioFreeModels');
    expect(initScript).toContain('window.selectAIStudioFetchedModel = selectAIStudioFetchedModel');
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
    expect(discovered.find((model) => model.name === 'gemma-4-31b-it')).toEqual(
      expect.objectContaining({ quota: 15, rpd: 1500 })
    );
    expect(discovered.find((model) => model.name === 'gemini-2.5-pro')).toEqual(
      expect.objectContaining({ quota: 15, rpd: 1500 })
    );

    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual([
      'gemini-2.5-flash',
    ]);

    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(elements.aiStudioModelSelect.innerHTML).toContain('gemini-2.5-pro');
    expect(elements.aiStudioModelPicker.innerHTML).toContain('selectAIStudioFetchedModel');
    expect(elements.modelsList.innerHTML).toContain('selectOnlyGeminiModel(1)');
    expect(elements.modelsList.innerHTML).toContain('Chỉ dùng');
    expect(toastMessages.at(-1)).toEqual(expect.objectContaining({
      type: 'success',
      message: expect.stringContaining('Chọn 1 model'),
    }));

    context.selectAIStudioFetchedModel('gemini-2.5-pro');

    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual([
      'gemini-2.5-pro',
    ]);
    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(JSON.parse(stored.get('novelTranslatorActiveDirectModels'))).toEqual([
      expect.objectContaining({ id: 'gemini-2.5-pro', rpm: 15, rpd: 1500 }),
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
    context.selectAIStudioFetchedModel('gemma-3-27b-it');

    expect(vm.runInContext('getActiveModels().map((model) => model.name)', context)).toEqual(['gemma-3-27b-it']);
    expect(stored.has('sf-active-direct-models')).toBe(false);
    expect(JSON.parse(stored.get('novelTranslatorActiveDirectModels'))).toEqual([
      expect.objectContaining({ id: 'gemma-3-27b-it', rpm: 15, rpd: 1500 }),
    ]);
  });

  it('hydrates legacy model records without RPD using model defaults', () => {
    const { context, stored } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by model hydration');
    });

    stored.set('novelTranslatorModels', JSON.stringify([
      { name: 'gemma-4-31b-it', quota: 15, enabled: true },
      { name: 'gemini-2.5-flash', quota: 5, enabled: true },
    ]));

    context.loadGeminiModels();

    expect(vm.runInContext('GEMINI_MODELS', context)).toEqual([
      expect.objectContaining({ name: 'gemma-4-31b-it', quota: 15, rpd: 1500 }),
      expect.objectContaining({ name: 'gemini-2.5-flash', quota: 5, rpd: 20 }),
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

  it('does not force a Gemini Direct pair when every pair is out of RPM', () => {
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
      GEMINI_MODELS = [{ name: 'gemma-4-31b-it', quota: 1, rpd: 1500, enabled: true }];
      requestTimestamps = { 'gemma-4-31b-it|0': [Date.now()] };
    `, context);

    expect(() => context.getBestAvailablePair()).toThrow(/Đang chờ quota hồi lại/);
  });

  it('does not force a Gemini Direct pair when internal RPD is exhausted', () => {
    const { context } = createRuntimeContext(async () => {
      throw new Error('fetch is not used by model rotation');
    });

    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/gemini/rpd-tracker.js'), 'utf8'),
      context,
      { filename: 'public/translator-runtime/js/gemini/rpd-tracker.js' },
    );
    vm.runInContext(
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/gemini/model-rotation.js'), 'utf8'),
      context,
      { filename: 'public/translator-runtime/js/gemini/model-rotation.js' },
    );

    vm.runInContext(`
      apiKeys = ['direct-key'];
      GEMINI_MODELS = [{ name: 'gemma-4-31b-it', quota: 15, rpd: 1500, enabled: true }];
      rpdData = {
        date: getPacificDateString(),
        pairs: { 'gemma-4-31b-it|0': { used: 1500, limit: 1500 } }
      };
    `, context);

    expect(() => context.getBestAvailablePair()).toThrow(/Hết RPD/);
  });
});
