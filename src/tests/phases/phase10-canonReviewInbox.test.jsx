import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let suggestionState;
let aiState;
let projectState;
let codexState;
const previewStoryBibleEntityMerge = vi.fn(async () => ({
  survivor: { id: 1, name: 'Lan', appearance: '' },
  duplicate: { id: 2, name: 'A Lan', appearance: 'Ao xanh' },
  merged: { id: 1, name: 'Lan', appearance: 'Ao xanh' },
  reference_count: 2,
  reference_counts: { relationships: 1, scenes: 1 },
  protected_conflicts: [],
  field_changes: [{ field: 'appearance', before: '', after: 'Ao xanh' }],
}));

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

vi.mock('../../services/codex/storyBibleMergeService.js', () => ({
  previewStoryBibleEntityMerge,
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
      quickApproveSafe: vi.fn(async () => ({ acceptedCount: 0, heldCount: 0 })),
      runDuplicateAudit: vi.fn(async () => ({ status: 'awaiting_review', shortlist_count: 0, suggestion_count: 0 })),
      duplicateAuditing: false,
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
    expect(text).toContain('Duyệt nhanh an toàn');
    expect(text).toContain('Bỏ');
  });

  it('shows evidence, critic conclusion, and risk flags for entity resolution', async () => {
    suggestionState.suggestions = [{
      id: 2,
      project_id: 1,
      type: 'entity_resolution',
      status: 'pending',
      source_chapter_id: 11,
      target_name: 'A Lan',
      reasoning: 'Tên có thể là bí danh của Lan.',
      candidate_op: JSON.stringify({
        raw_name: 'A Lan',
        canonical_name: 'Lan',
        aliases: ['A Lan'],
        role_hint: 'protagonist',
        proposed_changes: [{ field: 'appearance', value: 'Áo xanh' }],
        resolution_options: [{ entity_id: 1, name: 'Lan', score: 0.9 }],
        evidence: [{ paragraph_id: 'scene-1:p-2', quote: 'A Lan đứng dậy.' }],
        critic: { decision: 'review', reasoning: 'Thiếu bằng chứng phân biệt hai người.' },
        risk_flags: ['possible_alias'],
        protected_field_changes: ['role:protagonist'],
      }),
      created_at: 2,
    }];

    await act(async () => {
      root.render(<SuggestionInbox projectId={1} />);
    });

    expect(container.textContent).toContain('A Lan đứng dậy.');
    expect(container.textContent).toContain('Cần xem lại');
    expect(container.textContent).toContain('possible_alias');
    expect(container.textContent).toContain('role:protagonist');
    expect(container.textContent).toContain('Tên chuẩn đề xuất: Lan');
    expect(container.textContent).toContain('Bí danh: A Lan');
    expect(container.textContent).toContain('Vai trò gợi ý: protagonist');
    expect(container.textContent).toContain('appearance: Áo xanh');

    const resolutionSelect = container.querySelector('.si-card--entity_resolution select');
    const roleCheckbox = container.querySelector('input[type="checkbox"]');
    expect(roleCheckbox).toBeTruthy();
    await act(async () => {
      resolutionSelect.value = '__create_new__';
      resolutionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      roleCheckbox.click();
    });
    const acceptButton = container.querySelector('.si-card--entity_resolution .si-btn-accept');
    await act(async () => acceptButton.click());
    expect(suggestionState.acceptSuggestion).toHaveBeenCalledWith(2, 1, expect.objectContaining({
      resolutionAction: 'create_new',
      confirmedRole: 'protagonist',
    }));
  });

  it('shows duplicate-audit evidence, critic decision, survivor choice, and merge preview', async () => {
    suggestionState.suggestions = [{
      id: 3,
      project_id: 1,
      type: 'entity_duplicate_review',
      status: 'pending',
      target_name: 'Lan / A Lan',
      reasoning: 'Hai bản ghi có thể là cùng một nhân vật.',
      candidate_op: JSON.stringify({
        pair_key: 'character:1:2',
        entity_kind: 'character',
        entity_ids: [1, 2],
        entity_options: [{ id: 1, name: 'Lan' }, { id: 2, name: 'A Lan' }],
        recommended_survivor_id: 1,
        evidence: [{ paragraph_id: 'audit:character:1:2', quote: 'Entity A Lan. Entity B A Lan.' }],
        critic: { decision: 'agree', reasoning: 'Bằng chứng phù hợp.' },
        risk_flags: ['existing_data_merge'],
      }),
      created_at: 3,
    }];

    await act(async () => {
      root.render(<SuggestionInbox projectId={1} />);
    });

    expect(container.textContent).toContain('Entity A Lan. Entity B A Lan.');
    expect(container.textContent).toContain('Đồng ý');
    expect(container.textContent).toContain('existing_data_merge');

    const previewButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Xem trước gộp'));
    expect(previewButton).toBeTruthy();
    await act(async () => previewButton.click());

    expect(previewStoryBibleEntityMerge).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
    }));
    expect(container.textContent).toContain('appearance');
    expect(container.textContent).toContain('relationships: 1');
  });
});
