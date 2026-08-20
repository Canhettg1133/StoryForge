import { describe, expect, it } from 'vitest';
import { buildOutlineRuntimeIndex } from '../../pages/OutlineBoard/outlineRuntimeIndex.js';

describe('outline runtime index', () => {
  it('builds chapter card lookups in one pass and reuses persisted word totals', () => {
    const sceneWithGuardedText = {
      id: 10,
      chapter_id: 1,
      order_index: 0,
      pov_character_id: 7,
      location_id: 8,
      get draft_text() {
        throw new Error('persisted chapter totals must avoid scanning scene text');
      },
    };

    const index = buildOutlineRuntimeIndex({
      chapters: [
        { id: 1, actual_word_count: 1200 },
        { id: 2, actual_word_count: 0 },
      ],
      scenes: [
        sceneWithGuardedText,
        { id: 11, chapter_id: 1, order_index: 1 },
        { id: 20, chapter_id: 2, order_index: 0 },
      ],
      characters: [{ id: 7, name: 'Lan' }],
      locations: [{ id: 8, name: 'Trường An' }],
    });

    expect(index.sceneCountByChapterId.get(1)).toBe(2);
    expect(index.wordCountByChapterId.get(1)).toBe(1200);
    expect(index.firstSceneByChapterId.get(1)?.id).toBe(10);
    expect(index.povNameByChapterId.get(1)).toBe('Lan');
    expect(index.locationNameByChapterId.get(1)).toBe('Trường An');
    expect(index.sceneCountByChapterId.get(2)).toBe(1);
  });
});
