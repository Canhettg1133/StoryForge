import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let suggestionState;
let canonState;
let projectState;
let codexState;

vi.mock('../../stores/suggestionStore', () => ({
  default: () => suggestionState,
}));

vi.mock('../../stores/canonStore', () => ({
  default: () => canonState,
}));

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

const { default: SuggestionInbox } = await import('../../components/ai/SuggestionInbox');

describe('phase10 canon review inbox UI', () => {
  let root;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    suggestionState = {
      suggestions: [{
        id: 1,
        project_id: 1,
        type: 'canon_op_review',
        status: 'pending',
        source_chapter_id: 11,
        source_scene_id: 21,
        target_id: 10,
        target_name: 'Lan',
        suggested_value: 'Lan hy sinh ở cổng thành.',
        reasoning: 'Bằng chứng: Lan hy sinh ở cổng thành.',
        candidate_op: JSON.stringify({
          op_type: 'CHARACTER_DIED',
          chapter_id: 11,
          scene_id: 21,
          subject_id: 10,
          subject_name: 'Lan',
          summary: 'Lan hy sinh ở cổng thành.',
          evidence: 'Lan hy sinh ở cổng thành.',
          confidence: 0.92,
          payload: {},
        }),
        created_at: 1,
      }],
      loading: false,
      loadSuggestions: vi.fn(async () => {}),
      acceptSuggestion: vi.fn(async () => ({ revisionId: 777 })),
      rejectSuggestion: vi.fn(async () => {}),
      acceptAll: vi.fn(async () => {}),
      rejectAll: vi.fn(async () => {}),
      clearResolved: vi.fn(async () => {}),
    };
    canonState = {
      canonicalizeChapter: vi.fn(async () => ({
        ok: true,
        committedCount: 1,
        filteredCount: 0,
        invalidatedChapterCount: 0,
        message: 'Đã áp dụng 1 thay đổi canon.',
      })),
      canonicalizing: false,
    };
    projectState = {
      currentProject: { id: 1, genre_primary: 'fantasy' },
      chapters: [{ id: 11, title: 'Chương 1' }],
    };
    codexState = {
      loadCodex: vi.fn(async () => {}),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders canon_op_review with Vietnamese labels and review evidence', async () => {
    await act(async () => {
      root.render(<SuggestionInbox projectId={1} />);
    });

    const text = container.textContent;
    expect(text).toContain('Canon cần duyệt');
    expect(text).toContain('Nhân vật tử vong');
    expect(text).toContain('Lan');
    expect(text).toContain('Lan hy sinh ở cổng thành.');
    expect(text).toContain('Bằng chứng');
    expect(text).toContain('Duyệt');
    expect(text).toContain('Bỏ');
  });

  it('uses the typed canon pipeline for chapter reanalysis', async () => {
    suggestionState.suggestions = [];
    await act(async () => {
      root.render(<SuggestionInbox projectId={1} />);
    });

    const button = Array.from(container.querySelectorAll('button'))
      .find((item) => item.textContent.includes('Phân tích lại'));
    expect(button).toBeTruthy();

    await act(async () => {
      button.click();
    });

    expect(canonState.canonicalizeChapter).toHaveBeenCalledWith(1, 11);
    expect(container.textContent).toContain('Đã áp dụng 1 thay đổi canon.');
  });

  it('labels superseded suggestions as replaced instead of rejected', async () => {
    suggestionState.suggestions = [{
      id: 2,
      project_id: 1,
      type: 'character_status',
      status: 'superseded',
      source_chapter_id: 11,
      target_name: 'Lan',
      suggested_value: 'Trang thai cu',
    }];
    await act(async () => {
      root.render(<SuggestionInbox projectId={1} />);
    });

    const resolvedHeader = container.querySelector('.si-resolved-header');
    await act(async () => {
      resolvedHeader.click();
    });

    expect(container.textContent).toContain('Đã được thay thế');
  });
});
