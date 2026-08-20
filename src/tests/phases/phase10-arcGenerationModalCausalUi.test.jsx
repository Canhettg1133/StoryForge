import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  arcStoreState,
  useArcGenStoreMock,
  validateGeneratedOutlineMock,
} = vi.hoisted(() => {
  const arcStoreState = {};
  const useArcGenStoreMock = vi.fn(() => arcStoreState);
  useArcGenStoreMock.getState = vi.fn(() => arcStoreState);
  return {
    arcStoreState,
    useArcGenStoreMock,
    validateGeneratedOutlineMock: vi.fn(),
  };
});

vi.mock('../../stores/arcGenerationStore', () => ({
  default: useArcGenStoreMock,
  validateGeneratedOutline: validateGeneratedOutlineMock,
}));

import ArcGenerationModal from '../../pages/OutlineBoard/ArcGenerationModal.jsx';

function setTextareaValue(textarea, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(textarea, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function resetArcStoreState() {
  Object.keys(arcStoreState).forEach((key) => delete arcStoreState[key]);
  Object.assign(arcStoreState, {
    initializeArcGeneration: vi.fn(async () => {}),
    setArcConfig: vi.fn(),
    generateOutline: vi.fn(async () => {}),
    reviseGeneratedOutline: vi.fn(async () => ({ ok: true })),
    startBatchDraft: vi.fn(async () => false),
    regenerateFromIndex: vi.fn(async () => false),
    commitOutlineOnly: vi.fn(async () => ({ ok: true })),
    commitDraftsToProject: vi.fn(async () => true),
    toggleDraftIndex: vi.fn(),
    updateOutlineChapter: vi.fn(),
    removeOutlineChapter: vi.fn(),
    flagChapter: vi.fn(),
    arcMode: 'guided',
    arcGoal: 'Tao chuong co nhan qua.',
    arcChapterCount: 1,
    arcPacing: 'medium',
    recommendedBatchCount: 1,
    projectTargetLength: 120,
    availableMacroArcs: [],
    selectedMacroArcId: null,
    currentMacroArcId: null,
    projectMilestones: [],
    storyProgressBudget: null,
    macroArcContract: null,
    batchChapterAnchors: [],
    outlineValidation: { issues: [], hasBlockingIssues: false },
    outlineRevisionPrompt: '',
    outlineRevisionAssessment: null,
    outlineSaveFeedback: null,
    outputMode: 'outline_review',
    selectedDraftIndexes: [0],
    outlineStatus: 'ready',
    draftStatus: 'idle',
    draftProgress: { current: 0, total: 0 },
    draftResults: [],
    generatedOutline: {
      arc_title: 'Arc nhân quả',
      chapters: [
        {
          title: 'Chương 11: Sương độc',
          purpose: 'Ép nhân vật trả giá cho lựa chọn trước.',
          summary: 'Lam Mạc bị kẹt trong sương độc và phải chọn cứu đồng đội hay giữ bí mật.',
          opening_state: 'Lam Mạc đang bị thương.',
          continuity_in: { response: 'Hậu quả từ chương trước khiến Lam Mạc không thể rút lui.' },
          conflict: 'Lam Mạc muốn giấu thân phận nhưng đồng đội bị bao vây.',
          key_events: ['Tìm lối thoát', 'Cứu đồng đội'],
          decision_or_consequence: 'Lam Mạc để lộ dấu vết linh lực.',
          state_changes: [{ subject: 'Lam Mạc', change: 'Bị kẻ địch nghi ngờ còn sống.' }],
          ending_state: 'Kẻ địch biết Lam Mạc còn sống.',
          continuity_out: { text: 'Sự nghi ngờ của kẻ địch kéo sang chương sau.' },
          pacing: 'fast',
        },
      ],
    },
  });
  validateGeneratedOutlineMock.mockReturnValue({
    hasBlockingIssues: false,
    issues: [
      { chapterIndex: 0, code: 'chapter-missing-continuity-in', severity: 'warning', message: 'Thiếu móc nối.' },
      { chapterIndex: 0, code: 'chapter-missing-conflict', severity: 'warning', message: 'Thiếu xung đột.' },
      { chapterIndex: 0, code: 'chapter-missing-continuity-out', severity: 'warning', message: 'Thiếu hệ quả.' },
    ],
  });
}

describe('phase10 arc generation modal causal outline UI', () => {
  let container;
  let root;

  beforeEach(() => {
    resetArcStoreState();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders causal outline sections and edits structured fields in Vietnamese', async () => {
    await act(async () => {
      root.render(
        <ArcGenerationModal
          projectId={1}
          genre="fantasy"
          currentChapterCount={10}
          onClose={vi.fn()}
        />,
      );
    });

    const generateButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Tạo dàn ý'));
    expect(generateButton).toBeTruthy();

    await act(async () => {
      generateButton.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Nhân quả');
    expect(container.textContent).toContain('Xung đột & sự kiện');
    expect(container.textContent).toContain('Thay đổi trạng thái');
    expect(container.textContent).toContain('Kết chương');
    expect(container.textContent).toContain('Thiếu móc nối');
    expect(container.textContent).toContain('Thiếu xung đột');
    expect(container.textContent).toContain('Thiếu hệ quả');
    expect(container.textContent).toContain('Nhịp nhanh');

    const conflictField = container.querySelector('textarea[aria-label="Xung đột chính chương 1"]');
    expect(conflictField).toBeTruthy();

    await act(async () => {
      setTextareaValue(conflictField, 'Lam Mạc muốn thoát thân nhưng phải cứu đồng đội trước.');
    });

    expect(arcStoreState.updateOutlineChapter).toHaveBeenCalledWith(0, {
      conflict: 'Lam Mạc muốn thoát thân nhưng phải cứu đồng đội trước.',
    });
  });

  it('expands generated chapter text to its full height without internal scrolling', async () => {
    arcStoreState.generatedOutline.chapters[0].purpose = 'Mục tiêu dài '.repeat(12);
    arcStoreState.generatedOutline.chapters[0].summary = 'Tóm tắt dài '.repeat(30);

    await act(async () => {
      root.render(
        <ArcGenerationModal
          projectId={1}
          genre="fantasy"
          currentChapterCount={10}
          onClose={vi.fn()}
        />,
      );
    });

    const generateButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Tạo dàn ý'));

    await act(async () => {
      generateButton.click();
      await Promise.resolve();
    });

    const purposeField = container.querySelector('textarea[aria-label="Mục tiêu chương 1"]');
    const summaryField = container.querySelector('textarea[aria-label="Tóm tắt chương 1"]');

    expect(purposeField).toBeTruthy();
    expect(summaryField).toBeTruthy();
    expect(purposeField.classList).toContain('auto-resize-textarea');
    expect(summaryField.classList).toContain('auto-resize-textarea');

    Object.defineProperty(summaryField, 'scrollHeight', {
      configurable: true,
      value: 264,
    });

    await act(async () => {
      setTextareaValue(summaryField, `${summaryField.value} Nội dung bổ sung.`);
    });

    expect(summaryField.style.height).toBe('264px');
    expect(summaryField.style.overflowY).toBe('hidden');
  });

  it('lets chapter-count input be cleared before committing a new arc batch size', async () => {
    await act(async () => {
      root.render(
        <ArcGenerationModal
          projectId={1}
          genre="fantasy"
          currentChapterCount={10}
          onClose={vi.fn()}
        />,
      );
    });

    const chapterCountInput = container.querySelector('input[aria-label="Số chương muốn tạo"]')
      || container.querySelector('input[type="number"]');
    expect(chapterCountInput).toBeTruthy();

    arcStoreState.setArcConfig.mockClear();
    chapterCountInput.focus();
    await act(async () => {
      setInputValue(chapterCountInput, '');
    });

    expect(chapterCountInput.value).toBe('');
    expect(arcStoreState.setArcConfig).not.toHaveBeenCalledWith({ arcChapterCount: 1 });

    await act(async () => {
      setInputValue(chapterCountInput, '5');
    });
    expect(chapterCountInput.value).toBe('5');
    expect(arcStoreState.setArcConfig).not.toHaveBeenCalledWith({ arcChapterCount: 5 });

    await act(async () => {
      chapterCountInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(arcStoreState.setArcConfig).toHaveBeenCalledWith({ arcChapterCount: 5 });
  });
});
