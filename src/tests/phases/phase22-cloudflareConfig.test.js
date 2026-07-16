import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolveCloudflareBuildEnv } from '../../../scripts/cloudflare-command.mjs';
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
    expect(wrangler).toContain('name = "storyforge-web"');
    expect(wrangler).toContain('name = "storyforge-web-preview"');
    expect(wrangler).toContain('main = "worker/index.js"');
    expect(wrangler).toContain('run_worker_first = ["/api/*"]');
    expect(wrangler).toContain('not_found_handling = "single-page-application"');
  });

  it('forces preview to disable every remote data write surface', () => {
    const env = resolveCloudflareBuildEnv('preview', {
      VITE_ENABLE_CLOUD_SYNC: 'true',
      VITE_CLOUD_AUTO_SYNC_ENABLED: 'true',
      VITE_ENABLE_STORY_MIRROR: 'true',
    });

    expect(env).toMatchObject({
      CLOUDFLARE_ENV: 'preview',
      STORYFORGE_CLOUDFLARE: 'true',
      VITE_DEPLOYMENT_MODE: 'preview',
      VITE_ENABLE_CLOUD_SYNC: 'false',
      VITE_CLOUD_AUTO_SYNC_ENABLED: 'false',
      VITE_ENABLE_STORY_MIRROR: 'false',
    });
    expect(env).not.toHaveProperty('VITE_CLOUD_SYNC_BASE_URL');
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
    expect(shouldInjectVercelAnalytics('storyforge-web.canhettg113.workers.dev', 'production')).toBe(false);
    expect(shouldInjectVercelAnalytics('localhost', 'preview')).toBe(false);
  });

  it('preserves security and cache headers for Cloudflare static assets', () => {
    const headers = read('public/_headers');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('/assets/*');
    expect(headers).toContain('Cache-Control: public, max-age=31536000, immutable');
  });

  it('limits every Translator parallel and relay batch entry point to 30', () => {
    expect(read('public/translator-runtime/js/app.js')).toContain('const TRANSLATOR_MAX_PARALLEL = 30;');
    expect(read('public/translator-runtime/js/gemini/api.js')).toContain('const PROXY_RELAY_CHAT_BATCH_MAX_SIZE = 30;');
    expect(read('public/translator-runtime/index.html')).toContain('id="parallelCount" value="2" min="1" max="30"');
  });

  it('allows both Vercel origins and the Cloudflare production origin during transition', () => {
    const mirror = read('apps/story-mirror-worker/wrangler.toml');
    const relay = read('relay-worker/wrangler.toml');
    const origins = [
      'https://story-forge-virid.vercel.app',
      'https://story-forge-kohl.vercel.app',
      'https://storyforge-web.canhettg113.workers.dev',
    ];
    origins.forEach((origin) => {
      expect(mirror).toContain(origin);
      expect(relay).toContain(origin);
    });
    expect(relay).toContain('https://storyforge-web-preview.canhettg113.workers.dev');
  });
});
