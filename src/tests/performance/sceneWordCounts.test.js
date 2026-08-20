import { describe, expect, it } from 'vitest';
import {
  WORD_COUNT_CACHE_VERSION,
  getStoredSceneWordCount,
  normalizeProjectWordCounts,
  normalizeProjectWordCountsInSlices,
} from '../../services/projects/sceneWordCounts.js';

describe('scene word-count cache', () => {
  it('recounts unversioned legacy prose instead of trusting a stale positive cache', () => {
    expect(getStoredSceneWordCount({
      draft_text: 'một hai',
      word_count: 99,
    })).toBe(2);
  });

  it('uses a verified cache without touching scene prose', () => {
    expect(getStoredSceneWordCount({
      draft_text: { replace: null },
      word_count: 42,
      word_count_version: WORD_COUNT_CACHE_VERSION,
    })).toBe(42);
  });

  it('recounts prose when a versioned cache contains null instead of a number', () => {
    expect(getStoredSceneWordCount({
      draft_text: 'một hai',
      word_count: null,
      word_count_version: WORD_COUNT_CACHE_VERSION,
    })).toBe(2);
  });

  it('normalizes legacy rows once and repairs chapter totals before render', () => {
    const result = normalizeProjectWordCounts(
      [{ id: 10, actual_word_count: 0 }],
      [
        { id: 1, chapter_id: 10, draft_text: 'một hai', word_count: 0 },
        { id: 2, chapter_id: 10, draft_text: 'ba bốn năm', word_count: 77 },
      ],
    );

    expect(result.needsPersistence).toBe(true);
    expect(result.chapters[0]).toMatchObject({
      actual_word_count: 5,
      word_count_version: WORD_COUNT_CACHE_VERSION,
    });
    expect(result.scenes.map((scene) => scene.word_count)).toEqual([2, 3]);
    expect(result.scenes.every(
      (scene) => scene.word_count_version === WORD_COUNT_CACHE_VERSION,
    )).toBe(true);
  });

  it('preserves arrays and skips prose scans when every cache is verified', () => {
    const chapters = [{
      id: 10,
      actual_word_count: 5,
      word_count_version: WORD_COUNT_CACHE_VERSION,
    }];
    const scenes = [
      {
        id: 1,
        chapter_id: 10,
        draft_text: { replace: null },
        word_count: 2,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      },
      {
        id: 2,
        chapter_id: 10,
        draft_text: { replace: null },
        word_count: 3,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      },
    ];

    const result = normalizeProjectWordCounts(chapters, scenes);

    expect(result.needsPersistence).toBe(false);
    expect(result.chapters).toBe(chapters);
    expect(result.scenes).toBe(scenes);
  });

  it('yields between bounded slices while migrating legacy prose', async () => {
    let clock = 0;
    let yieldCount = 0;
    const result = await normalizeProjectWordCountsInSlices(
      [{ id: 10, actual_word_count: 0 }],
      Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        chapter_id: 10,
        draft_text: 'một hai ba',
        word_count: 0,
      })),
      {
        timeBudgetMs: 2,
        now: () => {
          clock += 1;
          return clock;
        },
        yieldToMain: async () => {
          yieldCount += 1;
        },
      },
    );

    expect(yieldCount).toBeGreaterThan(0);
    expect(result.chapters[0].actual_word_count).toBe(24);
    expect(result.scenes.every(
      (scene) => scene.word_count_version === WORD_COUNT_CACHE_VERSION,
    )).toBe(true);
  });
});
