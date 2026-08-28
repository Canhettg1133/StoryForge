import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadProgressRuntime() {
  const elements = {
    speedStat: { textContent: '' },
    activeKeysStat: { textContent: '' },
    etaStat: { textContent: '' },
  };
  const context = vm.createContext({
    Date,
    console: { log() {}, warn() {}, error() {} },
    document: {
      addEventListener() {},
      getElementById(id) {
        return elements[id] || null;
      },
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    showToast() {},
  });

  for (const file of [
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/gemini/model-rotation.js',
    'public/translator-runtime/js/ui/progress.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  }

  return { context, elements };
}

describe('translator progress stats', () => {
  it('shows keys from the active proxy instead of stored Gemini Direct keys', () => {
    const { context, elements } = loadProgressRuntime();

    vm.runInContext(`
      apiKeys = ['DIRECT_1', 'DIRECT_2', 'DIRECT_3', 'DIRECT_4'];
      useProxy = true;
      useOllama = false;
      activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
      proxyApiKeys = ['ONLY_PROXY_KEY'];
      updateProgressStats(0, getActiveTranslatorKeyCount(), '--:--');
    `, context);

    expect(elements.activeKeysStat.textContent).toBe(1);
  });

  it('keeps the active-key count provider-aware for Direct, Custom Proxy, and Ollama', () => {
    const { context } = loadProgressRuntime();

    const counts = vm.runInContext(`
      (() => {
        apiKeys = ['DIRECT_1', 'DIRECT_2'];
        useProxy = false;
        useOllama = false;
        const direct = getActiveTranslatorKeyCount();

        useProxy = true;
        activeTranslatorProvider = TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
        customProxyApiKeys = ['CUSTOM_1', 'CUSTOM_2', 'CUSTOM_3'];
        const customProxy = getActiveTranslatorKeyCount();

        useProxy = false;
        useOllama = true;
        const ollama = getActiveTranslatorKeyCount();
        return { direct, customProxy, ollama };
      })()
    `, context);

    expect(counts).toEqual({ direct: 2, customProxy: 3, ollama: 0 });
  });

  it('separates the active translation action from the progress card', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');

    expect(css).toMatch(
      /body\.translator-is-translating\s+\.translate-actions\s*\{[^}]*margin-bottom:\s*var\(--spacing-lg\)/u,
    );
  });
});
