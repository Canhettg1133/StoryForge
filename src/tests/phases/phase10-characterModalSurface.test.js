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
    const css = read('src/pages/CharacterHub/CharacterHub.css');
    const overlay = getCssRuleBody(css, '.codex-modal-overlay');
    const modal = getCssRuleBody(css, '.codex-modal');

    expect(modal).toContain('background: var(--color-bg-secondary);');
    expect(modal).not.toContain('var(--color-surface-1)');
    expect(modal).toContain('isolation: isolate;');
    expect(modal).toContain('z-index: var(--z-modal);');
    expect(overlay).toContain('z-index: var(--z-modal-overlay);');
  });
});
