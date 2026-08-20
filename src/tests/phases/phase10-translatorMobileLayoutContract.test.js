import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

describe('translator narrow mobile layout contract', () => {
  it('keeps a long uploaded filename inside the card while preserving a 44px remove action', () => {
    const css = read('public/translator-runtime/style.css');
    const html = read('public/translator-runtime/index.html');

    expect(css).toMatch(/\.file-info\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    expect(css).toMatch(/\.file-details\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.file-meta\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.file-name\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.file-info\s*>\s*\.btn-danger\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    expect(html).toMatch(/data-click-action="clearFile"[^>]*aria-label="Xóa file"/);
  });

  it('gives the conditional Han audit sections one flex height owner and protects short mobile viewports', () => {
    const css = read('public/translator-runtime/han-audit-file.css');
    const html = read('public/translator-runtime/index.html');

    expect(css).toMatch(/\.han-file-audit__shell\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.han-file-audit__layout\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*min-height:\s*0/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*820px\)\s*and\s*\(max-height:\s*700px\)/);
    expect(css).toMatch(/\.han-file-audit__nav\s*\{[^}]*background:\s*var\(--bg-secondary\)/s);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(html).toContain('viewport-fit=cover');
  });
});
