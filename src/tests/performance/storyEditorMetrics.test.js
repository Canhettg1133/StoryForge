import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveChapterProgress } from '../../components/editor/storyEditorMetrics.js';

describe('story editor live metrics', () => {
  it('derives live chapter progress from persisted totals in O(1)', () => {
    expect(deriveChapterProgress({
      chapterWordCount: 1_200,
      persistedSceneWordCount: 200,
      liveSceneWordCount: 260,
      targetWordCount: 2_000,
    })).toEqual({ current: 1_260, target: 2_000, percent: 63 });
  });

  it('keeps the existing target fallback and clamps invalid totals', () => {
    expect(deriveChapterProgress({
      chapterWordCount: 20,
      persistedSceneWordCount: 100,
      liveSceneWordCount: 0,
      targetWordCount: 3_000,
    })).toEqual({ current: 0, target: 7_000, percent: 0 });
  });

  it('falls back to a positive target when imported chapter data contains a negative target', () => {
    expect(deriveChapterProgress({
      chapterWordCount: 100,
      persistedSceneWordCount: 0,
      liveSceneWordCount: 0,
      targetWordCount: -1,
    })).toEqual({ current: 100, target: 7_000, percent: 1 });
  });

  it('prevents editor transactions from reconciling the complete StoryEditor tree', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/editor/StoryEditor.jsx'),
      'utf8',
    );
    expect(source).toContain('shouldRerenderOnTransaction: false');
    expect(source).toContain('useEditorState');
    expect(source).not.toMatch(/const chapterScenes = scenes\.filter/);
  });
});
