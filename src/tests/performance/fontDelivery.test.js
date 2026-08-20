import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('self-hosted font delivery', () => {
  it('removes render-blocking Google Fonts and preloads only the primary local font', () => {
    const html = read('index.html');
    const preloadMatches = html.match(/rel="preload"[^>]+as="font"/g) || [];

    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(preloadMatches).toHaveLength(1);
    expect(html).toContain('/fonts/inter-latin-300-700.woff2');
  });

  it('keeps Inter and Lora Vietnamese/Latin assets under the first-paint budget', () => {
    const css = read('src/styles/fonts.css');
    const fontFiles = fs.readdirSync(path.join(root, 'public/fonts'))
      .filter((file) => file.endsWith('.woff2'));
    const totalBytes = fontFiles.reduce(
      (total, file) => total + fs.statSync(path.join(root, 'public/fonts', file)).size,
      0,
    );

    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("font-family: 'Lora'");
    expect(css.match(/font-display: swap/g)).toHaveLength(6);
    expect(css).toContain('U+1EA0-1EF9');
    expect(totalBytes).toBeLessThanOrEqual(160 * 1024);
  });
});
