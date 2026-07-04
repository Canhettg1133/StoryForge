import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEXT_FILES = [
  'apps/admin/src/features/storyMirror/StoryMirrorPage.jsx',
  'apps/admin/src/features/storyMirror/storyMirror.css',
  'apps/admin/src/adminApi.js',
  'apps/story-mirror-worker/src/index.js',
  'apps/admin-api-worker/src/storyMirror/index.js',
  'src/features/storyMirrorBackfill/StoryMirrorBackfillSection.jsx',
  'src/features/storyMirrorBackfill/StoryMirrorBackfillSection.css',
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
      'src/features/storyMirrorBackfill/StoryMirrorBackfillSection.jsx',
      'src/features/storyMirrorBackfill/StoryMirrorBackfillSection.css',
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

  it('keeps the old-story backfill controls in Vietnamese with the expected labels', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/storyMirrorBackfill/StoryMirrorBackfillSection.jsx'), 'utf8');
    expect(source).toContain('Đồng bộ truyện cũ');
    expect(source).toContain('Đang quét');
    expect(source).toContain('Đã xếp hàng');
    expect(source).toContain('Hoàn tất');
    expect(source).toContain('Tạm dừng');
    expect(source).toContain('Chạy đồng bộ truyện cũ');
    expect(source).toContain('Thử lại');
  });
});
