import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n?/g, '\n');
}

function getCssRuleBody(source, selector) {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  const end = source.indexOf('\n}', braceStart);
  expect(end).toBeGreaterThan(braceStart);
  return source.slice(braceStart + 1, end);
}

describe('Prompt Doctor layout', () => {
  it('keeps every section card separated by a consistent vertical gap', () => {
    const css = read('src/pages/StyleImporter/StyleImporter.css');
    const page = getCssRuleBody(css, '.style-importer-page');

    expect(page).toContain('display: flex;');
    expect(page).toContain('flex-direction: column;');
    expect(page).toContain('gap: var(--space-5);');
  });
});
