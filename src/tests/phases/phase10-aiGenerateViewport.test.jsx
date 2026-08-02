import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import AIGenerateButton from '../../components/common/AIGenerateButton.jsx';

const rootPath = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootPath, relativePath), 'utf8');
}

function getRule(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'))?.[1] || '';
}

describe('phase10 AI generation viewport safety', () => {
  let container;
  let root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    document.body.innerHTML = '';
    container = null;
  });

  it('renders the prompt outside scrollable headers so it cannot be clipped', async () => {
    container = document.createElement('div');
    container.className = 'codex-header';
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<AIGenerateButton entityType="location" />);
    });

    const trigger = container.querySelector('.ai-gen-trigger');
    await act(async () => {
      trigger.click();
    });

    const popup = document.querySelector('.ai-gen-popup');
    expect(popup).not.toBeNull();
    expect(popup.parentElement).toBe(document.body);
    expect(popup.getAttribute('role')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    document.querySelector('.ai-gen-input').dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('.ai-gen-popup')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the popup in the viewport without turning the whole surface into a scroll pane', () => {
    const componentCss = read('src/components/common/AIGenerateButton.css');
    const worldCss = read('src/pages/WorldLore/WorldLore.css');
    const popupRule = getRule(componentCss, '.ai-gen-popup');
    const inputRule = getRule(componentCss, '.ai-gen-input');
    const previewRule = getRule(componentCss, '.ai-gen-preview');

    expect(popupRule).toContain('position: fixed');
    expect(popupRule).toContain('max-height: calc(100dvh - 24px)');
    expect(popupRule).toContain('overflow: hidden');
    expect(inputRule).toContain('resize: none');
    expect(previewRule).toContain('overflow-y: auto');
    expect(worldCss).not.toMatch(
      /\.project-mobile-shell \.world-lore \.ai-gen-popup\s*\{[^}]*overflow-y:\s*auto;/su,
    );
  });
});
