import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let suggestionState;
let aiState;
let projectState;
let codexState;

vi.mock('../../stores/suggestionStore', () => ({
  default: () => suggestionState,
}));

vi.mock('../../stores/aiStore', () => ({
  default: () => aiState,
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
    aiState = {
      generateSuggestions: vi.fn(async () => ({ status: 'no_suggestions' })),
      isSuggesting: false,
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
});
