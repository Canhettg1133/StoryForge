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
    expect(pkg.scripts.build).toContain('scripts/build-production-app.mjs user');
    expect(pkg.scripts['build:admin']).toContain('scripts/build-production-app.mjs admin');
    expect(pkg.scripts['build:secure']).toContain('scripts/build-production-app.mjs user');
    expect(pkg.scripts['build:admin:secure']).toContain('scripts/build-production-app.mjs admin');
    expect(read('scripts/build-production-app.mjs')).toContain('scripts/secure-build-guard.mjs');
    expect(read('scripts/secure-build-guard.mjs')).toContain('assertNoPublicSourceMaps');
  });

  it('fails production builds before Vite can emit a login bundle without Supabase Auth env', () => {
    const buildScript = read('scripts/build-production-app.mjs');
    expect(buildScript).toContain('loadProductionBuildEnv');
    expect(buildScript).toContain('VITE_SUPABASE_URL');
    expect(buildScript).toContain('VITE_SUPABASE_ANON_KEY');
    expect(buildScript).toContain('Missing required production client env');
  });
});
