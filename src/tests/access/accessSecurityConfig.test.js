import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('access control deployment config', () => {
  it('does not expose the legacy /api/proxy rewrite bypass', () => {
    const vercelConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    const rewrites = Array.isArray(vercelConfig.rewrites) ? vercelConfig.rewrites : [];

    expect(rewrites.some((rewrite) => String(rewrite.source || '').startsWith('/api/proxy'))).toBe(false);
    expect(JSON.stringify(vercelConfig)).not.toContain('ag.beijixingxing.com/:match');
  });

  it('does not expose the legacy /api/proxy dev-server bypass', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');

    expect(viteConfig).not.toContain("'/api/proxy'");
    expect(viteConfig).not.toContain('"/api/proxy"');
    expect(viteConfig).not.toMatch(/\/api\/proxy['"`\s]*:/u);
  });

  it('does not rewrite Vite dev module requests to index.html', () => {
    const vercelConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    const rewriteSource = String(vercelConfig.rewrites?.[0]?.source || '');

    expect(rewriteSource).toContain('src/');
    expect(rewriteSource).toContain('@react-refresh');
    expect(rewriteSource).toContain('@vite/');
    expect(rewriteSource).toContain('node_modules/');
    expect(rewriteSource).toContain('.*\\..*');
  });
});
