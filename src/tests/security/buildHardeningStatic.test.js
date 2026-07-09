import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('production build hardening', () => {
  it('explicitly disables public sourcemaps for user and admin builds', () => {
    expect(read('vite.config.js')).toContain('sourcemap: false');
    expect(read('apps/admin/vite.config.js')).toContain('sourcemap: false');
  });

  it('provides a secure build gate for sourcemap and obfuscation verification', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['build:secure']).toContain('secure-build-guard');
    expect(pkg.scripts['build:admin:secure']).toContain('secure-build-guard');
    expect(read('scripts/secure-build-guard.mjs')).toContain('assertNoPublicSourceMaps');
  });
});
