import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('phase10 chapter completion model Settings', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sf-preferred-provider', 'gemini_direct');
    localStorage.setItem('sf-quality-mode', 'best');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('saves a completion-only model without changing the active provider or global quality', async () => {
    vi.resetModules();
    const [{ default: ChapterCompletionModelSetting }, routerModule] = await Promise.all([
      import('../../pages/Settings/ChapterCompletionModelSetting.jsx'),
      import('../../services/ai/router.js'),
    ]);

    root = createRoot(container);
    await act(async () => {
      root.render(<ChapterCompletionModelSetting />);
    });

    expect(container.textContent).toContain('Model cho Hoàn thành chương');
    expect(container.textContent).toContain('Flash');
    expect(container.textContent).toContain('gemini-3-flash-preview');

    const select = container.querySelector('select');
    expect(select.value).toBe('');
    await act(async () => {
      select.value = 'gemini-2.5-flash';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(JSON.parse(localStorage.getItem('sf-chapter-completion-model-preferences')))
      .toMatchObject({
        scopes: {
          gemini_direct: { model: 'gemini-2.5-flash', prompted: true },
        },
      });
    expect(routerModule.default.getPreferredProvider()).toBe(routerModule.PROVIDERS.GEMINI_DIRECT);
    expect(routerModule.default.getQualityMode()).toBe(routerModule.QUALITY_MODES.BEST);
  });

  it('mounts the setting only for text providers, not the Cloudflare cover provider', () => {
    const settingsSource = readFileSync('src/pages/Settings/Settings.jsx', 'utf8');

    expect(settingsSource).toContain('<ChapterCompletionModelSetting');
    expect(settingsSource).toMatch(
      /selectedProviderCard\s*!==\s*PROVIDER_CARD_CLOUDFLARE_COVER[\s\S]*?<ChapterCompletionModelSetting/u,
    );
  });
});
