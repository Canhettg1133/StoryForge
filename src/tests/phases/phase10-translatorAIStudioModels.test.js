import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function createRuntimeContext(fetchImpl) {
  const stored = new Map();
  const toastMessages = [];
  const elements = {
    modelsList: { innerHTML: '' },
    modelCount: { textContent: '', style: {} },
    presetModelSelect: { innerHTML: '' },
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
  it('exposes a button in the translator model panel to fetch AI Studio models', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const initScript = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');

    expect(html).toContain('onclick="fetchAIStudioFreeModels()"');
    expect(html).toContain('Lấy model AI Studio');
    expect(initScript).toContain('window.fetchAIStudioFreeModels = fetchAIStudioFreeModels');
  });

  it('fetches AI Studio text models, enables them, and persists them for Gemini Direct translation', async () => {
    let requestedUrl = '';
    const { context, stored, toastMessages, elements } = createRuntimeContext(async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-3.1-flash-lite-preview',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent', 'countTokens'],
            },
            {
              name: 'models/text-embedding-004',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/imagen-4.0-generate-preview',
              supportedGenerationMethods: ['predict'],
            },
          ],
        }),
      };
    });

    vm.runInContext(`
      apiKeys = ['direct-key-for-list-models'];
      GEMINI_MODELS = [{ name: 'gemini-2.5-flash', quota: 5, enabled: false }];
    `, context);

    const imported = await context.fetchAIStudioFreeModels();

    expect(requestedUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models?key=direct-key-for-list-models');
    expect(imported.map((model) => model.name)).toEqual([
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
    ]);

    const activeModels = vm.runInContext('getActiveModels().map((model) => model.name)', context);
    expect(activeModels).toEqual([
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
    ]);

    const persisted = JSON.parse(stored.get('novelTranslatorModels'));
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'gemini-3.1-flash-lite-preview', enabled: true }),
      expect.objectContaining({ name: 'gemini-2.5-pro', enabled: true }),
    ]));
    expect(JSON.parse(stored.get('sf-active-direct-models'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gemini-3.1-flash-lite-preview' }),
      expect.objectContaining({ id: 'gemini-2.5-pro' }),
    ]));
    expect(elements.modelCount.textContent).toContain('2/3 models');
    expect(toastMessages.at(-1)).toEqual(expect.objectContaining({
      type: 'success',
      message: expect.stringContaining('Đã lấy 2 model'),
    }));
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
});
