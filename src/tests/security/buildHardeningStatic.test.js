import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots = [];

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('production build hardening', () => {
  afterEach(() => {
    while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
  });

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
    expect(read('scripts/secure-build-guard.mjs')).toContain('assertNoServerOnlySecretMarkers');
  });

  it('leaves third-party vendor files byte-for-byte intact during obfuscation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-obfuscator-'));
    tempRoots.push(root);
    const vendorDirectory = path.join(root, 'translator-runtime', 'vendor');
    mkdirSync(vendorDirectory, { recursive: true });
    const vendorFile = path.join(vendorDirectory, 'jszip.min.js');
    const firstPartyFile = path.join(root, 'app.js');
    const licensedVendor = '/*! JSZip v3.10.1 - MIT License */\nglobalThis.JSZip = {};\n';
    writeFileSync(vendorFile, licensedVendor);
    writeFileSync(firstPartyFile, 'globalThis.storyForgeAnswer = 42;\n');

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/obfuscate-first-party.mjs'), root],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(vendorFile, 'utf8')).toBe(licensedVendor);
    expect(readFileSync(firstPartyFile, 'utf8')).not.toBe('globalThis.storyForgeAnswer = 42;\n');
    const manifest = JSON.parse(readFileSync(path.join(root, '.storyforge-obfuscated.json'), 'utf8'));
    expect(manifest.skipped).toContain('translator-runtime/vendor/jszip.min.js');
  });

  it('fails production builds before Vite can emit a login bundle without Supabase Auth env', () => {
    const buildScript = read('scripts/build-production-app.mjs');
    expect(buildScript).toContain('loadProductionBuildEnv');
    expect(buildScript).toContain('assertNoForbiddenPublicSupabaseEnv');
    expect(buildScript).toContain('sanitizeClientBuildEnv');
    expect(buildScript).toContain('VITE_SUPABASE_URL');
    expect(buildScript).toContain('VITE_SUPABASE_ANON_KEY');
    expect(buildScript).toContain('Missing required production client env');
  });
});
