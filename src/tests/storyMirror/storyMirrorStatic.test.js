import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEXT_FILES = [
  'apps/admin/src/features/storyMirror/StoryMirrorPage.jsx',
  'apps/admin/src/features/storyMirror/storyMirror.css',
  'apps/admin/src/adminApi.js',
  'apps/story-mirror-worker/src/index.js',
  'apps/admin-api-worker/src/storyMirror/index.js',
  'src/services/storyMirror/backfill.js',
  'src/services/storyMirror/identity.js',
  'src/services/storyMirror/outbox.js',
  'src/services/storyMirror/payloadBuilder.js',
];

describe('story mirror static safety', () => {
  it('keeps R2 and Supabase service secrets out of frontend story mirror code', () => {
    const frontendFiles = [
      'apps/admin/src/features/storyMirror/StoryMirrorPage.jsx',
      'apps/admin/src/features/storyMirror/storyMirror.css',
      'src/services/storyMirror/backfill.js',
      'src/services/storyMirror/identity.js',
      'src/services/storyMirror/outbox.js',
      'src/services/storyMirror/payloadBuilder.js',
      'src/services/storyMirror/apiClient.js',
    ];

    for (const file of frontendFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(source).not.toContain('R2_ACCESS_KEY_ID');
      expect(source).not.toContain('R2_SECRET_ACCESS_KEY');
      expect(source).not.toContain('STORY_MIRROR_BUCKET');
    }
  });

  it('keeps new story mirror UI text as valid UTF-8 Vietnamese, not mojibake', () => {
    for (const file of TEXT_FILES) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/Ã|Â|áº|á»|Ä|Æ/u);
    }
  });

  it('keeps old-story backfill automatic instead of rendering Settings test controls', () => {
    const settingsSource = readFileSync(resolve(process.cwd(), 'src/pages/Settings/Settings.jsx'), 'utf8');
    const runtimeSource = readFileSync(resolve(process.cwd(), 'src/services/storyMirror/runtime.js'), 'utf8');

    expect(settingsSource).not.toContain('StoryMirrorBackfillSection');
    expect(settingsSource).not.toContain('Đồng bộ truyện cũ');
    expect(settingsSource).not.toContain('Chạy đồng bộ truyện cũ');
    expect(runtimeSource).toContain('scheduleStoryMirrorBackfill');
  });
  it('keeps sensitive worker responses non-cacheable and non-sniffable', () => {
    const workerFiles = [
      'apps/story-mirror-worker/src/index.js',
      'apps/admin-api-worker/src/index.js',
    ];

    for (const file of workerFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain("'Cache-Control': 'no-store'");
      expect(source).toContain("'X-Content-Type-Options': 'nosniff'");
      expect(source).toContain("'Referrer-Policy': 'no-referrer'");
    }
  });
});
