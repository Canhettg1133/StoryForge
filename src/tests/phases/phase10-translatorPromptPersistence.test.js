import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const templateIds = ['convert', 'novel', 'adult', 'sacHiep', 'sacHiepPro', 'sacHiepENI', 'wuxia', 'romance'];

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
    },
    contains(value) {
      return values.has(value);
    },
  };
}

function createElement(value = '') {
  return {
    value,
    textContent: '',
    innerHTML: '',
    hidden: false,
    style: {},
    scrollHeight: 0,
    classList: createClassList(),
    options: [{ textContent: 'Tự động' }],
    selectedIndex: 0,
    appendChild() {},
    setAttribute() {},
  };
}

function loadPromptRuntime({ savedSettings = null } = {}) {
  const stored = new Map();
  if (savedSettings) {
    stored.set('novelTranslatorProSettings', JSON.stringify(savedSettings));
  }

  const templateButtons = templateIds.map((templateId) => ({
    dataset: { actionValue: templateId },
    classList: createClassList(),
  }));

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
      createElement: () => createElement(''),
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll(selector) {
        if (selector === '.template-btn') return templateButtons;
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
    'public/translator-runtime/js/local-ai/ollama.js',
    'public/translator-runtime/js/ui/settings.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });

  return { context, elements, stored, templateButtons };
}

describe('phase10 translator prompt persistence', () => {
  it('wires manual prompt edits to a dedicated autosave input action', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const app = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/app.js'), 'utf8');
    const init = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/init.js'), 'utf8');
    const settings = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/ui/settings.js'), 'utf8');
    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');

    expect(html).toContain('id="customPrompt"');
    expect(html).toContain('data-input-action="saveCustomPrompt"');
    expect(init).toContain('saveCustomPrompt: () => saveCustomPrompt()');
    expect(settings).toContain('function saveCustomPrompt()');
    expect(settings).toContain('function resizeCustomPromptEditor()');
    expect(settings).toContain('function hasSavedTranslatorCustomPrompt()');
    expect(app).toContain('hasSavedTranslatorCustomPrompt');
    expect(css).toContain('overflow-y: hidden;');
  });

  it('saves custom prompt text without losing the selected template used for reset', async () => {
    const { context, elements, stored } = loadPromptRuntime();

    vm.runInContext("setActiveTranslatorTemplateId('romance')", context);
    elements.customPrompt.value = 'PROMPT NGƯỜI DÙNG ĐÃ SỬA';
    context.saveCustomPrompt();

    const saved = JSON.parse(stored.get('novelTranslatorProSettings'));
    expect(saved.customPrompt).toBe('PROMPT NGƯỜI DÙNG ĐÃ SỬA');
    expect(saved.activeTranslatorTemplateId).toBe('romance');

    await context.resetActivePromptTemplate();

    const expectedRomancePrompt = vm.runInContext(
      "ensureCharacterNameConsistencyPrompt(PROMPT_TEMPLATES.romance)",
      context,
    );
    expect(elements.customPrompt.value).toBe(expectedRomancePrompt);
    expect(JSON.parse(stored.get('novelTranslatorProSettings')).activeTranslatorTemplateId).toBe('romance');
  });

  it('restores the selected template after reload even when the prompt is custom text', () => {
    const { context } = loadPromptRuntime({
      savedSettings: {
        customPrompt: 'PROMPT WUXIA ĐÃ SỬA',
        activeTranslatorTemplateId: 'wuxia',
        sourceLang: 'auto',
        parallelCount: '2',
        chunkSize: '6000',
        rpmPerKey: '10',
      },
    });

    context.loadSettings();

    expect(vm.runInContext('getActiveTranslatorTemplateId()', context)).toBe('wuxia');
  });

  it('keeps an intentionally empty saved prompt instead of treating it as missing', () => {
    const { context, elements } = loadPromptRuntime({
      savedSettings: {
        customPrompt: '',
        activeTranslatorTemplateId: 'novel',
        sourceLang: 'auto',
        parallelCount: '2',
        chunkSize: '6000',
        rpmPerKey: '10',
      },
    });

    expect(context.hasSavedTranslatorCustomPrompt()).toBe(true);
    context.loadSettings();

    expect(elements.customPrompt.value).toBe('');
    expect(vm.runInContext('getActiveTranslatorTemplateId()', context)).toBe('novel');
  });

  it('expands the prompt editor to fit short and long prompt content without an inner scrollbar', () => {
    const { context, elements } = loadPromptRuntime();

    elements.customPrompt.scrollHeight = 720;
    context.resizeCustomPromptEditor();

    expect(elements.customPrompt.style.height).toBe('720px');
    expect(elements.customPrompt.style.overflowY).toBe('hidden');

    elements.customPrompt.scrollHeight = 40;
    context.resizeCustomPromptEditor();

    expect(elements.customPrompt.style.height).toBe('180px');
    expect(elements.customPrompt.style.overflowY).toBe('hidden');
  });
});
