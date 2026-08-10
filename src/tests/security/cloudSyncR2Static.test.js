import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(file) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('Cloud Sync R2 static security', () => {
  it('keeps Worker/R2 secrets out of every frontend Cloud Sync module', () => {
    for (const file of [
      'src/services/cloud/cloudR2ApiClient.js',
      'src/services/cloud/cloudSnapshotStore.js',
      'src/services/cloud/cloudBackupService.js',
      'src/services/cloud/cloudSyncService.js',
      'src/pages/Settings/CloudSyncSection.jsx',
    ]) {
      const source = read(file);
      expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(source).not.toContain('R2_ACCESS_KEY_ID');
      expect(source).not.toContain('R2_SECRET_ACCESS_KEY');
      expect(source).not.toContain('CLOUD_SYNC_BUCKET');
    }
  });

  it('keeps Cloud Sync isolated from Story Mirror and public R2 access', () => {
    const config = read('apps/cloud-sync-worker/wrangler.toml');
    expect(config).toContain('name = "storyforge-cloud-sync"');
    expect(config).toContain('bucket_name = "storyforge-cloud-sync"');
    expect(config).not.toContain('storyforge-story-mirror');
    expect(config).not.toMatch(/r2\.dev|public_bucket/iu);
    expect(config).not.toContain('CLOUD_SYNC_ALLOWED_ORIGINS = "*"');
    expect(config.match(/\[\[ratelimits\]\]/gu)).toHaveLength(3);
    expect(config).not.toContain('[[unsafe.bindings]]');
  });

  it('keeps every Cloudflare client artifact on the same hybrid R2 contract', () => {
    for (const file of [
      '.env.cloudflare.preview.example',
      '.env.cloudflare.production.example',
    ]) {
      const env = read(file);
      expect(env).toContain('VITE_CLOUD_SYNC_API_URL=https://storyforge-cloud-sync.example.workers.dev');
      expect(env).toContain('VITE_CLOUD_SYNC_STORAGE_MODE=hybrid');
    }
  });

  it('uses jose/JWKS claims validation and never embeds a JWT secret', () => {
    const auth = read('apps/cloud-sync-worker/src/auth.js');
    expect(auth).toContain("algorithms: ['ES256']");
    expect(auth).toContain("audience: 'authenticated'");
    expect(auth).toContain('issuer,');
    expect(auth).toContain("`${issuer}/.well-known/jwks.json`");
    expect(auth).not.toMatch(/JWT_SECRET|SUPABASE_JWT_SECRET/u);
  });

  it('keeps responses no-store and operational logs payload-free', () => {
    const worker = read('apps/cloud-sync-worker/src/index.js');
    expect(worker).toContain("'Cache-Control': 'no-store'");
    expect(worker).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(worker).toContain("'Referrer-Policy': 'no-referrer'");
    expect(worker).toContain("'X-Request-Id': requestId");
    expect(worker).not.toMatch(/console\.(log|info|warn)\(/u);
    expect(worker).not.toMatch(/console\.error\([^)]*(itemTitle|itemSlug|metadata|objectKey|payload)/su);
  });

  it('uses R2-supported single-object integrity checks in the S3 backfill path', () => {
    const migrator = read('scripts/cloud-sync-r2-backfill.mjs');
    expect(migrator).toContain('ContentMD5:');
    expect(migrator).toContain("Metadata: { 'payload-sha256': payloadSha256 }");
    expect(migrator).not.toContain('ChecksumSHA256:');
  });
});
