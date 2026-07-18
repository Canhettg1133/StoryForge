import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const repoRoot = process.cwd();

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => (value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readCreamTokens() {
  const css = fs.readFileSync(path.join(repoRoot, 'src/styles/index.css'), 'utf8');
  const block = css.match(/\[data-theme="cream"\]\s*\{([\s\S]*?)\n\}/u)?.[1] || '';
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/gu)]
      .map(([, name, value]) => [name, value.trim()]),
  );
}

describe('phase10 StoryForge theme system', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.resetModules();
  });

  it('defines the three supported themes with Vietnamese labels', async () => {
    const { THEMES, THEME_IDS } = await import('../../config/themes.js');

    expect(THEME_IDS).toEqual(['dark', 'light', 'cream']);
    expect(THEMES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'dark', label: 'Tối' },
      { id: 'light', label: 'Sáng' },
      { id: 'cream', label: 'Giấy Kem Mềm' },
    ]);
  });

  it('normalizes missing and unsupported values to dark', async () => {
    const { normalizeTheme } = await import('../../config/themes.js');

    expect(normalizeTheme(null)).toBe('dark');
    expect(normalizeTheme('sepia')).toBe('dark');
    expect(normalizeTheme('cream')).toBe('cream');
  });

  it('persists a valid theme and applies it to the document', async () => {
    const { default: useUIStore } = await import('../../stores/uiStore.js');

    useUIStore.getState().setTheme('cream');

    expect(useUIStore.getState().theme).toBe('cream');
    expect(localStorage.getItem('sf-theme')).toBe('cream');
    expect(document.documentElement.dataset.theme).toBe('cream');
  });

  it('heals an unsupported stored theme during initialization', async () => {
    localStorage.setItem('sf-theme', 'sepia');
    const { default: useUIStore } = await import('../../stores/uiStore.js');

    useUIStore.getState().initTheme();

    expect(useUIStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('sf-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ships complete Cream Paper tokens with readable text colors', () => {
    const tokens = readCreamTokens();
    const expected = {
      '--color-bg-primary': '#f7f5f0',
      '--color-bg-sidebar': '#f2eee7',
      '--color-bg-secondary': '#fffdfa',
      '--color-bg-tertiary': '#f6f2eb',
      '--color-bg-modal': '#ffffff',
      '--color-bg-editor': '#fffaf2',
      '--color-text-heading': '#211c17',
      '--color-text-primary': '#342d27',
      '--color-text-secondary': '#4f453c',
      '--color-text-tertiary': '#62564a',
      '--color-text-muted': '#6f6256',
      '--color-accent': '#98420b',
      '--color-accent-fill': '#a94b08',
      '--color-success': '#047857',
      '--color-warning': '#854d0e',
      '--color-danger': '#b91c1c',
      '--color-info': '#1d4ed8',
    };

    expect(tokens).toMatchObject(expected);
    expect(contrastRatio(tokens['--color-text-primary'], tokens['--color-bg-editor'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-text-muted'], tokens['--color-bg-secondary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-text-secondary'], tokens['--color-bg-sidebar'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-text-muted'], tokens['--color-bg-sidebar'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-accent'], tokens['--color-bg-sidebar'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', tokens['--color-accent-fill'])).toBeGreaterThanOrEqual(4.5);
    ['--color-success', '--color-warning', '--color-danger', '--color-info'].forEach((token) => {
      expect(contrastRatio(tokens[token], tokens['--color-bg-modal']), token).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('covers the editor and dark-only product surfaces with Cream overrides', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'src/styles/cream-overrides.css'), 'utf8');

    [
      '[data-theme="cream"] .story-editor-content',
      '[data-theme="cream"] .scene-detail-panel',
      '[data-theme="cream"] .narrative-lab',
      '[data-theme="cream"] .analysis-viewer',
      '[data-theme="cream"] .su-that-page__priority-panel',
      '[data-theme="cream"] .project-chat-composer__input',
      '[data-theme="cream"] .sidebar-item--disabled',
    ].forEach((selector) => expect(css).toContain(selector));

    expect(css).toMatch(/\[data-theme="cream"\] \.sidebar-item\s*\{[\s\S]*?color:\s*var\(--color-text-primary\);[\s\S]*?font-weight:\s*550;/u);
    expect(css).toMatch(/\[data-theme="cream"\] \.sidebar-item--disabled\s*\{[\s\S]*?color:\s*#756a5f;[\s\S]*?opacity:\s*1;/u);
  });

  it('keeps the desktop picker unclipped and exposes the same choices in Settings', () => {
    const sidebar = fs.readFileSync(path.join(repoRoot, 'src/components/common/Sidebar.jsx'), 'utf8');
    const sidebarCss = fs.readFileSync(path.join(repoRoot, 'src/components/common/Sidebar.css'), 'utf8');
    const settings = fs.readFileSync(path.join(repoRoot, 'src/pages/Settings/Settings.jsx'), 'utf8');

    expect(sidebar).toContain('aria-expanded={themeMenuOpen}');
    expect(sidebar).toContain('<ThemePicker');
    expect(sidebar).toContain('disabled={isDisabled}');
    expect(sidebar).toContain('aria-disabled={isDisabled || undefined}');
    expect(sidebar).toContain('Chọn truyện trước để mở');
    expect(sidebarCss).toMatch(/\.sidebar-theme-popover\s*\{[\s\S]*?position:\s*fixed;/u);
    expect(settings).toContain('<h2>Giao diện</h2>');
    expect(settings).toContain('<ThemePicker variant="settings" />');
  });
});

describe('phase10 theme picker', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
    vi.resetModules();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
  });

  it('renders three choices and applies the selected theme immediately', async () => {
    const { default: ThemePicker } = await import('../../components/common/ThemePicker.jsx');

    root = createRoot(container);
    await act(async () => {
      root.render(<ThemePicker variant="settings" />);
    });

    const choices = [...container.querySelectorAll('[role="radio"]')];
    expect(choices).toHaveLength(3);
    expect(container.textContent).toContain('Giấy Kem Mềm');

    const creamChoice = choices.find((choice) => choice.textContent.includes('Giấy Kem Mềm'));
    await act(async () => creamChoice.click());

    expect(creamChoice.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('cream');
    expect(localStorage.getItem('sf-theme')).toBe('cream');
  });
});
