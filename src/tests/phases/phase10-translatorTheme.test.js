import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = process.cwd();

function loadThemeRuntime(savedTheme = 'dark') {
  const listeners = new Map();
  const documentElement = {
    dataset: {},
    style: {},
  };
  const meta = { content: '' };
  const context = {
    document: {
      documentElement,
      querySelector: () => meta,
    },
    localStorage: {
      getItem: vi.fn(() => savedTheme),
      setItem: vi.fn(),
    },
    window: {
      location: { origin: 'https://storyforge.local' },
      parent: {},
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/theme.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/theme.js' },
  );
  return { context, documentElement, listeners, meta };
}

describe('phase10 translator theme bridge', () => {
  it('ships light and Cream Paper surface overrides for the full translator workspace', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');

    expect(css).toContain('html[data-theme="light"]');
    expect(css).toContain('html[data-theme="cream"]');
    expect(css).toContain('--bg-primary: #f7f5f0');
    expect(css).toContain('--bg-modal: #ffffff');
    expect(css).toContain('html[data-theme="cream"] .proxy-key-item');
    expect(css).toContain('html[data-theme="cream"] .story-prompt-feedback-grid');
    expect(css).toContain('html[data-theme="cream"] .translation-queue-item');
    expect(css).toContain('html[data-theme="cream"] .chunk-detail-modal-content');
  });

  it('applies the stored theme before the translator UI initializes', () => {
    const { documentElement, meta } = loadThemeRuntime('cream');

    expect(documentElement.dataset.theme).toBe('cream');
    expect(meta.content).toBe('#f7f5f0');
  });

  it('accepts theme messages from the StoryForge parent without reloading', () => {
    const { context, documentElement, listeners } = loadThemeRuntime('dark');

    listeners.get('message')({
      origin: 'https://storyforge.local',
      source: context.window.parent,
      data: { type: 'STORYFORGE_THEME_CONTEXT', theme: 'cream' },
    });

    expect(documentElement.dataset.theme).toBe('cream');
  });

  it('falls back to dark for unsupported theme values', () => {
    const { context } = loadThemeRuntime('sepia');

    expect(context.normalizeStoryForgeTheme('sepia')).toBe('dark');
    expect(context.document.documentElement.dataset.theme).toBe('dark');
  });
});
