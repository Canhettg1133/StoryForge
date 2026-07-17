import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveCloudflareBuildEnv,
  resolveCloudflarePreviewEnv,
  resolveWranglerArgs,
} from '../../../scripts/cloudflare-command.mjs';
import { shouldInjectVercelAnalytics } from '../../services/analytics/vercelAnalytics.js';

function read(pathname) {
  return readFileSync(resolve(process.cwd(), pathname), 'utf8');
}

describe('Cloudflare build configuration', () => {
  it('pins the Cloudflare toolchain and defines both Worker environments', () => {
    const pkg = JSON.parse(read('package.json'));
    const wrangler = read('wrangler.toml');

    expect(pkg.devDependencies).toMatchObject({
      '@cloudflare/vite-plugin': '1.45.0',
      '@cloudflare/vitest-pool-workers': '0.18.5',
      wrangler: '4.111.0',
    });
    expect(pkg.scripts).toMatchObject({
      'worker:admin:dry-run': expect.stringContaining('apps/admin-api-worker/wrangler.toml'),
      'worker:relay:dry-run': expect.stringContaining('relay-worker/wrangler.toml'),
      'worker:story-mirror:dry-run': expect.stringContaining('apps/story-mirror-worker/wrangler.toml'),
    });
    expect(wrangler).toContain('name = "storyforge-web"');
    expect(wrangler).toContain('name = "storyforge"');
    expect(wrangler).toContain('main = "worker/index.js"');
    expect(wrangler).toContain('run_worker_first = ["/api", "/api/*"]');
    expect(wrangler).toContain('not_found_handling = "single-page-application"');
  });

  it('deploys the preview Worker slot with full production product features', () => {
    const env = resolveCloudflareBuildEnv('preview', {
      VITE_ENABLE_CLOUD_SYNC: 'false',
      VITE_CLOUD_AUTO_SYNC_ENABLED: 'false',
      VITE_ENABLE_STORY_MIRROR: 'false',
    });

    expect(env).toMatchObject({
      CLOUDFLARE_ENV: 'preview',
      STORYFORGE_CLOUDFLARE: 'true',
      VITE_DEPLOYMENT_MODE: 'production',
      VITE_ENABLE_CLOUD_SYNC: 'true',
      VITE_CLOUD_AUTO_SYNC_ENABLED: 'true',
      VITE_ENABLE_STORY_MIRROR: 'true',
    });
    expect(env).not.toHaveProperty('VITE_CLOUD_SYNC_BASE_URL');

    const previewVars = read('wrangler.toml').split('[env.preview.vars]')[1];
    expect(previewVars).toContain('DEPLOYMENT_MODE = "production"');
    expect(previewVars).toContain('USAGE_LOGGING_ENABLED = "true"');
  });

  it('always targets the isolated preview Worker for preview dry-runs and deploys', () => {
    expect(resolveWranglerArgs('dry-run', 'preview')).toEqual([
      'deploy',
      '--env',
      'preview',
      '--dry-run',
    ]);
    expect(resolveWranglerArgs('deploy', 'preview')).toEqual([
      'deploy',
      '--env',
      'preview',
    ]);
    expect(resolveWranglerArgs('deploy', 'production')).toEqual(['deploy']);
  });

  it('previews the generated Cloudflare artifact without re-selecting an environment', () => {
    const env = resolveCloudflarePreviewEnv({
      CLOUDFLARE_ENV: 'preview',
      STORYFORGE_CLOUDFLARE: 'true',
      VITE_DEPLOYMENT_MODE: 'production',
    });

    expect(env).not.toHaveProperty('CLOUDFLARE_ENV');
    expect(env).toMatchObject({
      STORYFORGE_CLOUDFLARE: 'true',
      VITE_DEPLOYMENT_MODE: 'production',
    });
  });

  it('keeps production feature values while removing the retired cloud API override', () => {
    const env = resolveCloudflareBuildEnv('production', {
      VITE_ENABLE_CLOUD_SYNC: 'true',
      VITE_ENABLE_STORY_MIRROR: 'false',
      VITE_CLOUD_SYNC_BASE_URL: 'https://legacy.example/api/cloud',
    });

    expect(env.VITE_DEPLOYMENT_MODE).toBe('production');
    expect(env.VITE_ENABLE_CLOUD_SYNC).toBe('true');
    expect(env.VITE_ENABLE_STORY_MIRROR).toBe('false');
    expect(env).not.toHaveProperty('VITE_CLOUD_SYNC_BASE_URL');
  });

  it('keeps Vercel Analytics on Vercel only', () => {
    expect(shouldInjectVercelAnalytics('story-forge-virid.vercel.app', 'production')).toBe(true);
    expect(shouldInjectVercelAnalytics('storyforge.canhettg113.workers.dev', 'production')).toBe(false);
    expect(shouldInjectVercelAnalytics('storyforge-web.canhettg113.workers.dev', 'production')).toBe(false);
    expect(shouldInjectVercelAnalytics('localhost', 'preview')).toBe(false);
  });

  it('shows an explicit read-only notice only in Cloudflare preview builds', () => {
    const layout = read('src/components/common/AppLayout.jsx');
    const layoutCss = read('src/components/common/AppLayout.css');
    expect(layout).toContain('CloudflarePreviewBanner');
    expect(layout.indexOf('<main')).toBeLessThan(layout.indexOf('<CloudflarePreviewBanner />'));
    expect(layout.indexOf('<CloudflarePreviewBanner />')).toBeLessThan(layout.indexOf('<Outlet />'));
    const banner = read('src/components/common/CloudflarePreviewBanner.jsx');
    const bannerCss = read('src/components/common/CloudflarePreviewBanner.css');
    expect(banner).toContain("VITE_DEPLOYMENT_MODE !== 'preview'");
    expect(banner).toContain('API key và dữ liệu local thuộc riêng URL preview');
    expect(banner).toContain('Cloud Sync và Story Mirror đang tạm khóa');
    expect(bannerCss).toContain('position: sticky');
    expect(bannerCss).not.toContain('position: fixed');
    expect(layoutCss).toContain('.app-layout--mobile .app-main--translator-active .translator-shell.is-active');
  });

  it('preserves security and cache headers for Cloudflare static assets', () => {
    const headers = read('public/_headers');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('/assets/*');
    expect(headers).toContain('! Cache-Control');
    expect(headers).toContain('Cache-Control: public, max-age=31536000, immutable');
  });

  it('documents rollback and keeps local Cloudflare secrets out of Git', () => {
    const gitignore = read('.gitignore');
    const devVarsExample = read('.dev.vars.example');
    const previewExample = read('.env.cloudflare.preview.example');
    const productionExample = read('.env.cloudflare.production.example');
    const handoff = read('docs/cloudflare-migration-handoff.md');

    expect(gitignore).toContain('.dev.vars*');
    expect(gitignore).toContain('!.dev.vars.example');
    expect(gitignore).toContain('.env.cloudflare.*.local');
    expect(devVarsExample).toContain('SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key');
    expect(previewExample).toContain('VITE_DEPLOYMENT_MODE=production');
    expect(previewExample).toContain('VITE_ENABLE_CLOUD_SYNC=true');
    expect(previewExample).toContain('VITE_CLOUD_AUTO_SYNC_ENABLED=true');
    expect(previewExample).toContain('VITE_ENABLE_STORY_MIRROR=true');
    expect(productionExample).toContain('VITE_DEPLOYMENT_MODE=production');
    expect(productionExample).not.toContain('VITE_CLOUD_SYNC_BASE_URL');
    expect(handoff).toContain('05b6a64c0ac55348b7fccf67803aee3fbdfed221');
    expect(handoff).toContain('codex/cloudflare-migration');
  });

  it('limits every Translator parallel and relay batch entry point to 30', () => {
    expect(read('public/translator-runtime/js/app.js')).toContain('const TRANSLATOR_MAX_PARALLEL = 30;');
    expect(read('public/translator-runtime/js/gemini/api.js')).toContain('const PROXY_RELAY_CHAT_BATCH_MAX_SIZE = 30;');
    expect(read('public/translator-runtime/index.html')).toContain('id="parallelCount" value="2" min="1" max="30"');
  });

  it('uses platform-neutral StoryForge relay wording in user-facing setup screens', () => {
    const settings = read('src/pages/Settings/Settings.jsx');
    const proxyGuide = read('src/pages/Guide/GeminiProxyGuide.jsx');
    const analysisConfig = read('src/pages/Lab/CorpusLab/components/AnalysisConfig.jsx');

    expect(settings).toContain('StoryForge relay');
    expect(settings).not.toContain('Vercel relay');
    expect(settings).not.toContain('Vercel rewrite');
    expect(settings).not.toContain('/api/proxy');
    expect(proxyGuide).not.toContain('/api/proxy');
    expect(analysisConfig).not.toContain('/api/proxy');
  });

  it('allows both Vercel origins and the Cloudflare production origin during transition', () => {
    const mirror = read('apps/story-mirror-worker/wrangler.toml');
    const relay = read('relay-worker/wrangler.toml');
    const origins = [
      'https://story-forge-virid.vercel.app',
      'https://story-forge-kohl.vercel.app',
      'https://storyforge.canhettg113.workers.dev',
      'https://storyforge-web.canhettg113.workers.dev',
    ];
    origins.forEach((origin) => {
      expect(mirror).toContain(origin);
      expect(relay).toContain(origin);
    });
    expect(relay).toContain('https://storyforge-web-preview.canhettg113.workers.dev');
    expect(mirror).toContain('https://storyforge-web-preview.canhettg113.workers.dev');
  });
});
