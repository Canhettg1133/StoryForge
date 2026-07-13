import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = process.cwd();

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  };
}

function createElement(value = '') {
  return {
    value,
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    className: '',
    style: {},
    scrollHeight: 0,
    classList: createClassList(),
    addEventListener() {},
    appendChild() {},
    setAttribute() {},
  };
}

function loadRuntime({ fetchImpl, savedSettings = null } = {}) {
  const stored = new Map();
  if (savedSettings) {
    stored.set('novelTranslatorProSettings', JSON.stringify(savedSettings));
  }

  const elements = {
    customPrompt: createElement(''),
    sourceLang: createElement('auto'),
    parallelCount: createElement('2'),
    chunkSize: createElement('6000'),
    rpmPerKey: createElement('10'),
    activePromptTemplateLabel: createElement(''),
    promptSaveStatus: createElement(''),
  };

  const context = {
    AbortController,
    clearTimeout,
    setTimeout,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    fetch: fetchImpl || vi.fn(async () => {
      throw new Error('fetch not mocked');
    }),
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
      createElement: () => createElement(''),
      getElementById(id) {
        return elements[id] || null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    showToast() {},
  };
  context.window = context;

  vm.createContext(context);
  [
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/translation/prompt-settings.js',
    'public/translator-runtime/js/local-ai/ollama.js',
    'public/translator-runtime/js/ui/settings.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });

  vm.runInContext(`
    loadGeminiModels = () => {};
    loadHistory = async () => {};
    setupEventListeners = () => {};
    updateStats = () => {};
    renderApiKeysList = () => {};
    renderHistoryList = () => {};
    renderModelsList = () => {};
    renderProxyKeysList = () => {};
    updateWorkspaceToolbar = () => {};
    updatePromptTemplateUi = () => {};
    resizeCustomPromptEditor = () => {};
  `, context);

  return { context, elements, stored };
}

describe('phase10 translator global prompt settings runtime', () => {
  it('loads active global prompts before applying the default translator prompt', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      expect(url).toBe('/api/translator-prompt-settings');
      expect(init.cache).toBe('no-store');
      return {
        ok: true,
        json: async () => ({
          ok: true,
          prompts: {
            sacHiep: 'GLOBAL SAC HIEP PROMPT',
          },
          revision: 12,
        }),
      };
    });
    const { context, elements, stored } = loadRuntime({ fetchImpl: fetchMock });

    await context.initializeApp();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elements.customPrompt.value).toContain('GLOBAL SAC HIEP PROMPT');
    expect(JSON.parse(stored.get('novelTranslatorProSettings') || '{}')).not.toHaveProperty('customPrompt');
  });

  it('falls back to the hard-coded prompt when the public prompt API fails', async () => {
    const { context, elements, stored } = loadRuntime({
      fetchImpl: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const expected = vm.runInContext('ensureCharacterNameConsistencyPrompt(PROMPT_TEMPLATES.sacHiep)', context);

    await context.initializeApp();

    expect(elements.customPrompt.value).toBe(expected);
    expect(JSON.parse(stored.get('novelTranslatorProSettings') || '{}')).not.toHaveProperty('customPrompt');
  });

  it('keeps a saved local custom prompt ahead of global prompt settings', async () => {
    const { context, elements } = loadRuntime({
      savedSettings: {
        customPrompt: 'LOCAL CUSTOM PROMPT',
        activeTranslatorTemplateId: 'sacHiepPro',
        sourceLang: 'auto',
        parallelCount: '2',
        chunkSize: '6000',
        rpmPerKey: '10',
      },
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          prompts: {
            sacHiepPro: 'GLOBAL SH PRO PROMPT',
          },
          revision: 4,
        }),
      })),
    });

    await context.initializeApp();

    expect(elements.customPrompt.value).toBe('LOCAL CUSTOM PROMPT');
  });

  it('feeds active global prompt overrides into Gemini Direct system instruction', async () => {
    const { context } = loadRuntime({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          prompts: {
            sacHiepPro: 'GLOBAL SYSTEM PROMPT SENTINEL\n\nVĂN BẢN CẦN BIÊN TẬP:',
          },
          revision: 6,
        }),
      })),
    });

    [
      'public/translator-runtime/js/translation/engine.js',
      'public/translator-runtime/js/gemini/api.js',
    ].forEach((file) => {
      vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
    });

    await context.loadTranslatorGlobalPromptSettings();
    const result = vm.runInContext(`(() => {
      const prompted = buildPromptedChunk(PROMPT_TEMPLATES.sacHiepPro, 'SOURCE TEXT SENTINEL', 'en');
      return {
        prompted,
        systemInstruction: getDirectGeminiSystemInstructionText(prompted),
      };
    })()`, context);

    expect(result.prompted).toContain('GLOBAL SYSTEM PROMPT SENTINEL');
    expect(result.prompted).toContain('SOURCE TEXT SENTINEL');
    expect(result.systemInstruction).toContain('GLOBAL SYSTEM PROMPT SENTINEL');
    expect(result.systemInstruction).not.toContain('SOURCE TEXT SENTINEL');
    expect(result.systemInstruction).not.toContain('[Đoạn nguồn]');
  });

  it('loads the prompt settings runtime module before UI settings without using HTML sinks', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const promptSettings = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/prompt-settings.js'), 'utf8');
    const app = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/app.js'), 'utf8');

    expect(html.indexOf('js/translation/prompt-settings.js')).toBeGreaterThan(html.indexOf('js/app.js'));
    expect(html.indexOf('js/translation/prompt-settings.js')).toBeLessThan(html.indexOf('js/ui/settings.js'));
    expect(app).toContain('loadTranslatorGlobalPromptSettings');
    expect(promptSettings).not.toContain('innerHTML');
    expect(promptSettings).not.toContain('dangerouslySetInnerHTML');
  });
});
