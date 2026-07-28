import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function getCssRuleBody(source, selector) {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  const end = source.indexOf('\n}', braceStart);
  expect(end).toBeGreaterThan(braceStart);
  return source.slice(braceStart + 1, end);
}

describe('phase10 character modal surface', () => {
  it('uses an opaque elevated surface instead of an undefined transparent token', () => {
    const css = read('src/styles/components.css');
    const overlay = getCssRuleBody(css, '.codex-modal-overlay');
    const modal = getCssRuleBody(css, '.codex-modal');

    expect(modal).toContain('background: var(--color-bg-modal);');
    expect(modal).not.toContain('var(--color-surface-1)');
    expect(modal).toContain('isolation: isolate;');
    expect(modal).toContain('z-index: var(--z-modal);');
    expect(overlay).toContain('z-index: var(--z-modal-overlay);');
  });

  it('keeps the character count readable when the desktop header runs out of room', () => {
    const sharedCss = read('src/styles/components.css');
    const characterCss = read('src/pages/CharacterHub/CharacterHub.css');
    const left = getCssRuleBody(sharedCss, '.codex-header-left');
    const count = getCssRuleBody(sharedCss, '.codex-count');

    expect(left).toContain('flex: 0 0 auto;');
    expect(left).toContain('min-width: max-content;');
    expect(count).toContain('flex: 0 0 auto;');
    expect(count).toContain('white-space: nowrap;');
    expect(characterCss).toContain('.character-hub > .codex-header .codex-header-actions .btn');
    expect(characterCss).toContain('padding-inline: 8px;');
  });

  it('uses compact modal tabs and content-sized character text fields', () => {
    const sharedCss = read('src/styles/components.css');
    const css = read('src/pages/CharacterHub/CharacterHub.css');
    const characterModal = getCssRuleBody(sharedCss, '.codex-modal--character');
    const tabs = getCssRuleBody(css, '.character-modal-tabs');
    const textarea = getCssRuleBody(css, '.form-group textarea.character-form-textarea');

    expect(characterModal).toContain('width: min(90vw, 820px);');
    expect(tabs).toContain('align-self: flex-start;');
    expect(tabs).toContain('width: fit-content;');
    expect(textarea).toContain('min-height:');
    expect(textarea).toContain('max-height:');
    expect(textarea).toContain('resize: none;');
  });
});
