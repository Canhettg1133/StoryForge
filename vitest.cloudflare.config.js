import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './worker/index.js',
      miniflare: {
        compatibilityDate: '2026-07-16',
        bindings: {
          DEPLOYMENT_MODE: 'preview',
          SUPABASE_URL: 'https://storyforge-test.invalid',
          USAGE_LOGGING_ENABLED: 'false',
        },
        serviceBindings: {
          ASSETS(request) {
            const pathname = new URL(request.url).pathname;
            return new Response(`<!doctype html><title>StoryForge test asset</title><main>${pathname}</main>`, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          },
        },
      },
    }),
  ],
  test: {
    include: ['worker/**/*.workerd.test.js'],
    reporters: ['verbose'],
    testTimeout: 10000,
  },
});
