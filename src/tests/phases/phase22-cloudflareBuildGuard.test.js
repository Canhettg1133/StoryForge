import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanCloudflareBuildOutput } from '../../../scripts/cloudflare-command.mjs';
import {
  assertNoServerOnlySecretMarkers,
  resolvePublicBundleRoot,
} from '../../../scripts/secure-build-guard.mjs';

const tempRoots = [];

function createCloudflareOutput({ clientSource = 'console.log("client")', workerSource = 'env.SUPABASE_SERVICE_ROLE_KEY' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'storyforge-cloudflare-guard-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, 'client'), { recursive: true });
  mkdirSync(path.join(root, 'storyforge_web'), { recursive: true });
  writeFileSync(path.join(root, 'client', 'app.js'), clientSource);
  writeFileSync(path.join(root, 'storyforge_web', 'index.js'), workerSource);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('Cloudflare secure build guard', () => {
  it('removes stale dist artifacts before a Cloudflare build without touching the worktree root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'storyforge-cloudflare-clean-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'dist', 'assets', 'stale.js'), 'stale');

    cleanCloudflareBuildOutput(root);

    expect(existsSync(root)).toBe(true);
    expect(existsSync(path.join(root, 'dist'))).toBe(false);
  });

  it('allows Worker env binding names while keeping them forbidden in public client assets', () => {
    const root = createCloudflareOutput();

    expect(resolvePublicBundleRoot(root)).toBe(path.join(root, 'client'));
    expect(() => assertNoServerOnlySecretMarkers(root, {}, {
      markerRootDir: resolvePublicBundleRoot(root),
    })).not.toThrow();
  });

  it('still rejects a real secret value anywhere in the Cloudflare output', () => {
    const secret = 'service-role-secret-value-for-test';
    const root = createCloudflareOutput({ workerSource: `const leaked = ${JSON.stringify(secret)};` });

    expect(() => assertNoServerOnlySecretMarkers(root, {
      SUPABASE_SERVICE_ROLE_KEY: secret,
    }, {
      markerRootDir: resolvePublicBundleRoot(root),
    })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/u);
  });
});
