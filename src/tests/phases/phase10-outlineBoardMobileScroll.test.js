import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function getRuleBody(source, selector, startIndex = 0) {
  const ruleIndex = source.indexOf(selector, startIndex);
  expect(ruleIndex, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf('{', ruleIndex) + 1;
  const bodyEnd = source.indexOf('}', bodyStart);
  expect(bodyEnd, `Malformed CSS rule for ${selector}`).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe('phase10 outline board mobile scrolling', () => {
  it('lets the mobile project shell own vertical scrolling for long outline lists', () => {
    const css = read('src/pages/OutlineBoard/OutlineBoard.css');
    const mobileMediaStart = css.indexOf('@media (max-width: 900px)');
    expect(mobileMediaStart).toBeGreaterThanOrEqual(0);

    const boardRule = getRuleBody(css, '.outline-board--mobile', mobileMediaStart);
    const layoutRule = getRuleBody(css, '.outline-board--mobile .outline-layout', mobileMediaStart);
    const mainRule = getRuleBody(css, '.outline-board--mobile .outline-main,', mobileMediaStart);
    const listRule = getRuleBody(css, '.outline-board--mobile .outline-list', mobileMediaStart);
    const plotBodyRule = getRuleBody(css, '.outline-board--mobile .plot-sidebar-body', mobileMediaStart);

    expect(boardRule).toContain('height: auto;');
    expect(boardRule).toContain('overflow-y: visible;');
    expect(layoutRule).toContain('overflow: visible;');
    expect(mainRule).toContain('overflow: visible;');
    expect(listRule).toContain('flex: none;');
    expect(listRule).toContain('overflow: visible;');
    expect(plotBodyRule).toContain('flex: none;');
    expect(plotBodyRule).toContain('overflow: visible;');
  });
});
