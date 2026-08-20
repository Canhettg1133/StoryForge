import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeFrontendBudgets } from '../../../scripts/performance-budget-guard.mjs';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('production frontend performance budget guard', () => {
  it('counts only the entry module, module preloads, and preloaded fonts', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'storyforge-budget-'));
    mkdirSync(path.join(tempDir, 'assets'));
    mkdirSync(path.join(tempDir, 'fonts'));
    writeFileSync(path.join(tempDir, 'assets', 'main.js'), 'const main = true;');
    writeFileSync(path.join(tempDir, 'assets', 'vendor.js'), 'const vendor = true;');
    writeFileSync(path.join(tempDir, 'assets', 'route.js'), 'const route = true;');
    writeFileSync(path.join(tempDir, 'fonts', 'inter.woff2'), Buffer.alloc(64));
    writeFileSync(path.join(tempDir, 'index.html'), [
      '<script type="module" src="/assets/main.js"></script>',
      '<link rel="modulepreload" href="/assets/vendor.js">',
      '<link rel="preload" as="font" href="/fonts/inter.woff2">',
    ].join('\n'));

    const result = analyzeFrontendBudgets(tempDir, {
      eagerJsBudget: 1024,
      fontPreloadBudget: 128,
    });

    expect(result.passed).toBe(true);
    expect(result.eagerJsPaths).toEqual(['/assets/main.js', '/assets/vendor.js']);
    expect(result.eagerJsPaths).not.toContain('/assets/route.js');
    expect(result.fontPreloadBytes).toBe(64);
  });

  it('fails when either transferred budget is exceeded', () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'storyforge-budget-'));
    mkdirSync(path.join(tempDir, 'assets'));
    writeFileSync(path.join(tempDir, 'assets', 'main.js'), 'export default 1;');
    writeFileSync(path.join(tempDir, 'index.html'), '<script type="module" src="/assets/main.js"></script>');

    const result = analyzeFrontendBudgets(tempDir, { eagerJsBudget: 1 });
    expect(result.passed).toBe(false);
    expect(result.eagerJsBytes).toBeGreaterThan(1);
  });
});
