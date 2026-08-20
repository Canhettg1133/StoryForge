import { describe, expect, it } from 'vitest';
import { createProjectTreeSelector } from '../../stores/selectors/projectTreeSelectors.js';

describe('project tree selector', () => {
  it('keeps chapter and scene projections stable for draft-only autosave updates', () => {
    const select = createProjectTreeSelector();
    const base = {
      chapters: [{ id: 1, project_id: 9, title: 'Chương 1', status: 'draft', actual_word_count: 10 }],
      scenes: [{ id: 2, project_id: 9, chapter_id: 1, title: 'Cảnh 1', order_index: 0, draft_text: 'cũ', word_count: 10 }],
      activeChapterId: 1,
      activeSceneId: 2,
      completingChapterId: null,
      chapterCompletionById: {},
    };
    const first = select(base);
    const draftOnly = select({
      ...base,
      scenes: [{ ...base.scenes[0], draft_text: 'nội dung mới', word_count: 12 }],
    });

    expect(draftOnly.scenes).toBe(first.scenes);
    expect(draftOnly.chapters).toBe(first.chapters);
  });

  it('publishes a new projection when visible tree metadata changes', () => {
    const select = createProjectTreeSelector();
    const base = {
      chapters: [{ id: 1, project_id: 9, title: 'Chương 1', status: 'draft', actual_word_count: 10 }],
      scenes: [{ id: 2, project_id: 9, chapter_id: 1, title: 'Cảnh 1', order_index: 0, draft_text: '' }],
      activeChapterId: 1,
      activeSceneId: 2,
      completingChapterId: null,
      chapterCompletionById: {},
    };
    const first = select(base);
    const renamed = select({
      ...base,
      scenes: [{ ...base.scenes[0], title: 'Cảnh đã đổi tên' }],
    });
    const recounted = select({
      ...base,
      chapters: [{ ...base.chapters[0], actual_word_count: 12 }],
      scenes: renamed.scenes,
    });

    expect(renamed.scenes).not.toBe(first.scenes);
    expect(renamed.scenes[0].title).toBe('Cảnh đã đổi tên');
    expect(recounted.chapters).not.toBe(first.chapters);
    expect(recounted.chapters[0].actual_word_count).toBe(12);
  });
});
