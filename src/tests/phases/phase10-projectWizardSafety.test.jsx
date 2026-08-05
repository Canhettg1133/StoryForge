import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectWizard from '../../pages/Dashboard/ProjectWizard.jsx';
import aiService from '../../services/ai/client';
import db from '../../services/db/database';

let projectState;
let codexState;
let plotState;
let draftRecord;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../stores/plotStore', () => ({
  default: () => plotState,
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: {
      update: vi.fn(),
    },
    macro_arcs: {
      add: vi.fn(),
    },
    wizard_drafts: {
      get: vi.fn(async () => draftRecord || null),
      put: vi.fn(async (record) => {
        draftRecord = structuredClone(record);
      }),
      delete: vi.fn(async () => {
        draftRecord = null;
      }),
    },
  },
}));

const seedResult = {
  title: 'Bản Đồ Cổ',
  premise: 'Lan giữ một bản đồ cổ dẫn tới bí mật của thành.',
  world_profile: {
    world_name: 'Thành Cổ',
    world_type: 'fantasy',
    world_rules: [],
  },
  characters: [{
    name: 'Lan',
    role: 'protagonist',
    specific_role: 'người giữ bản đồ',
    age: '',
    appearance: 'Áo xanh',
    personality: 'Kiên định',
    flaws: 'Dễ tin người quen',
    goals: 'Bảo vệ bản đồ',
    current_status: 'Đang giữ bản đồ',
    story_function: 'neo mở đầu',
  }],
  locations: [{ name: 'Thành Cổ', description: 'Nơi mở đầu', story_function: 'xuất hiện ở chương 1' }],
  objects: [],
  factions: [],
  terms: [],
  plot_threads: [{
    title: 'Bí mật bản đồ',
    type: 'mystery',
    description: 'Truy tìm nguồn gốc bản đồ.',
    state: 'active',
    opening_window: 'Chương 1',
    anchor_chapters: ['Chương 1'],
  }],
};

const outlineResult = {
  chapters: [{
    title: 'Chương 1',
    purpose: 'Đặt neo bản đồ cổ.',
    summary: 'Lan xuất hiện tại Thành Cổ và bảo vệ bản đồ.',
    opening_state: 'Lan đang giữ bản đồ tại Thành Cổ.',
    handoff_from_previous: '',
    ending_state: 'Lan bảo vệ được bản đồ nhưng bị theo dõi.',
    featured_characters: ['Lan'],
    primary_location: 'Thành Cổ',
    thread_titles: ['Bí mật bản đồ'],
    key_events: ['Lan bảo vệ bản đồ'],
    state_delta: 'Lan giữ được bản đồ cổ.',
  }],
  plot_threads: seedResult.plot_threads,
  proposed_entities: {
    characters: [],
    locations: [],
    objects: [],
    factions: [],
    terms: [],
    plot_threads: [],
  },
};

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
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findButton(container, label) {
  return Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent.includes(label));
}

describe('phase10 project wizard safety', () => {
  let container;
  let root;
  let onClose;

  beforeEach(() => {
    projectState = {
      createProject: vi.fn(async () => 7),
      createChapter: vi.fn(async () => ({ chapterId: 70 })),
      projects: [],
      loadProjects: vi.fn(async () => undefined),
    };
    codexState = {
      createCharacter: vi.fn(async () => 101),
      createLocation: vi.fn(async () => 201),
      createObject: vi.fn(async () => 301),
      createWorldTerm: vi.fn(async () => 401),
      createFaction: vi.fn(async () => 501),
      saveChapterSummary: vi.fn(async () => undefined),
    };
    plotState = {
      createPlotThread: vi.fn(async () => 601),
    };
    onClose = vi.fn();
    draftRecord = null;
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderWizard({ onCreated = () => {} } = {}) {
    await act(async () => {
      root.render(<ProjectWizard onClose={onClose} onCreated={onCreated} />);
    });
  }

  async function enterIdea(value = 'Tạo truyện về bản đồ cổ.') {
    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], value);
    });
  }

  function useSuccessfulGeneration() {
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      onComplete(JSON.stringify(
        taskType === 'chapter_outline_pass' ? outlineResult : seedResult,
      ));
      return { abort: vi.fn() };
    });
  }

  async function generateSeedAndOutline() {
    await enterIdea();
    await act(async () => {
      findButton(container, 'Tạo nền truyện').click();
    });
    await act(async () => {
      findButton(container, 'Tạo dàn ý').click();
    });
  }

  it('does not dismiss a dirty wizard when Escape is pressed', async () => {
    await renderWizard();
    await enterIdea();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Thoát trình tạo truyện?');
  });

  it('does not dismiss a dirty wizard when its backdrop is clicked', async () => {
    await renderWizard();
    await enterIdea();

    await act(async () => {
      container.querySelector('.modal-overlay').click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Bản nháp của bạn vẫn được giữ lại');
  });

  it('returns to the existing outline without sending another AI request', async () => {
    useSuccessfulGeneration();
    await renderWizard();
    await generateSeedAndOutline();

    expect(findButton(container, 'Sửa nền truyện')).toBeTruthy();
    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });

    expect(findButton(container, 'Quay lại dàn ý hiện tại')).toBeTruthy();
    await act(async () => {
      findButton(container, 'Quay lại dàn ý hiện tại').click();
    });

    expect(container.textContent).toContain('Lan bảo vệ được bản đồ');
    expect(aiService.send).toHaveBeenCalledTimes(2);
  });

  it('marks the old outline stale only while the approved seed is actually different', async () => {
    useSuccessfulGeneration();
    await renderWizard();
    await generateSeedAndOutline();
    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });

    const titleInput = container.querySelector('.wizard-title-input');
    const originalTitle = titleInput.value;
    await act(async () => {
      setInputValue(titleInput, 'Bản Đồ Cổ Đã Sửa');
    });

    expect(container.textContent).toContain('Dàn ý cũ vẫn được giữ');
    expect(findButton(container, 'Xem dàn ý cũ')).toBeTruthy();
    await act(async () => {
      findButton(container, 'Xem dàn ý cũ').click();
    });
    const staleApproveButton = findButton(container, 'Duyệt & tạo dự án');
    expect(staleApproveButton.disabled).toBe(false);
    await act(async () => {
      staleApproveButton.click();
    });
    expect(container.textContent).toContain('Hãy cập nhật dàn ý trước khi tạo dự án');
    expect(projectState.createProject).not.toHaveBeenCalled();

    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });
    await act(async () => {
      setInputValue(container.querySelector('.wizard-title-input'), originalTitle);
    });
    expect(findButton(container, 'Quay lại dàn ý hiện tại')).toBeTruthy();
    expect(container.textContent).not.toContain('Dàn ý cũ vẫn được giữ');
  });

  it('keeps a freshly generated outline current when it enriches an approved plot thread', async () => {
    const outlineWithProposal = {
      ...outlineResult,
      chapters: [{
        ...outlineResult.chapters[0],
        primary_location: 'Tháp Canh',
      }],
      plot_threads: [{
        ...seedResult.plot_threads[0],
        description: 'Dàn ý làm rõ hướng truy tìm nguồn gốc bản đồ.',
        anchor_chapters: ['Chương 1'],
      }],
      proposed_entities: {
        ...outlineResult.proposed_entities,
        locations: [{
          name: 'Tháp Canh',
          description: 'Nơi Lan phát hiện mình bị theo dõi.',
          story_function: 'Địa điểm chính của Chương 1.',
          reason: 'Dàn ý dùng Tháp Canh nhưng nền truyện chưa có địa điểm này.',
        }],
      },
    };
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      onComplete(JSON.stringify(
        taskType === 'chapter_outline_pass' ? outlineWithProposal : seedResult,
      ));
      return { abort: vi.fn() };
    });

    await renderWizard();
    await generateSeedAndOutline();

    expect(container.textContent).not.toContain('Dàn ý này thuộc nền truyện trước khi chỉnh sửa');
    expect(container.querySelector('.wizard-create-readiness')?.textContent).toContain('Còn 1 đề xuất cần duyệt');
    const blockedApproveButton = findButton(container, 'Duyệt & tạo dự án');
    expect(blockedApproveButton.disabled).toBe(false);
    await act(async () => {
      blockedApproveButton.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('còn 1 đề xuất chưa duyệt');
    expect(document.activeElement?.textContent).toContain('Duyệt');
    expect(projectState.createProject).not.toHaveBeenCalled();
    await act(async () => {
      findButton(container, 'Duyệt').click();
    });
    expect(container.querySelector('.wizard-create-readiness')?.textContent).toContain('Sẵn sàng tạo dự án');
    expect(findButton(container, 'Duyệt & tạo dự án').disabled).toBe(false);
  });

  it('preserves plot-thread exclusions without shifting the approved thread index', async () => {
    const seedWithTwoThreads = {
      ...seedResult,
      plot_threads: [
        {
          title: 'Tuyến sẽ loại',
          type: 'subplot',
          description: 'Không đưa vào dự án.',
          state: 'active',
          opening_window: 'Chương 1',
          anchor_chapters: ['Chương 1'],
        },
        seedResult.plot_threads[0],
      ],
    };
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      onComplete(JSON.stringify(
        taskType === 'chapter_outline_pass' ? outlineResult : seedWithTwoThreads,
      ));
      return { abort: vi.fn() };
    });

    await renderWizard();
    await enterIdea();
    await act(async () => {
      findButton(container, 'Tạo nền truyện').click();
    });
    const plotThreadSection = Array.from(container.querySelectorAll('.wizard-section'))
      .find((section) => section.querySelector('h4')?.textContent.includes('Tuyến truyện'));
    await act(async () => {
      plotThreadSection.querySelector('button[title="Loại khỏi dự án"]').click();
    });
    await act(async () => {
      findButton(container, 'Tạo dàn ý').click();
    });

    expect(container.textContent).not.toContain('Dàn ý này thuộc nền truyện trước khi chỉnh sửa');
    const approveButton = findButton(container, 'Duyệt & tạo dự án');
    expect(approveButton.disabled).toBe(false);
    await act(async () => {
      approveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(plotState.createPlotThread).toHaveBeenCalledTimes(1);
    expect(plotState.createPlotThread).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Bí mật bản đồ',
    }));
    expect(projectState.createChapter).toHaveBeenCalledWith(
      7,
      'Chương 1',
      expect.objectContaining({ thread_titles: ['Bí mật bản đồ'] }),
    );
  });

  it('keeps the previous seed when regenerating the seed fails', async () => {
    let requestCount = 0;
    aiService.send.mockImplementation(({ onComplete, onError }) => {
      requestCount += 1;
      if (requestCount === 1) onComplete(JSON.stringify(seedResult));
      else onError(new Error('provider unavailable'));
      return { abort: vi.fn() };
    });
    await renderWizard();
    await enterIdea();
    await act(async () => {
      findButton(container, 'Tạo nền truyện').click();
    });

    expect(container.textContent).toContain('Bản Đồ Cổ');
    await act(async () => {
      findButton(container, 'Tạo lại nền truyện').click();
    });

    expect(container.textContent).toContain('Bản Đồ Cổ');
    expect(container.textContent).toContain('Lỗi kết nối AI');
  });

  it('keeps the previous outline as a stale fallback when regenerated seed succeeds', async () => {
    let seedCallCount = 0;
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      if (taskType === 'chapter_outline_pass') onComplete(JSON.stringify(outlineResult));
      else {
        seedCallCount += 1;
        onComplete(JSON.stringify(seedCallCount === 1
          ? seedResult
          : { ...seedResult, title: 'Bản Đồ Cổ Đã Làm Mới' }));
      }
      return { abort: vi.fn() };
    });
    await renderWizard();
    await generateSeedAndOutline();

    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });
    await act(async () => {
      findButton(container, 'Tạo lại nền truyện').click();
    });

    expect(container.querySelector('.wizard-title-input').value).toBe('Bản Đồ Cổ Đã Làm Mới');
    expect(container.textContent).toContain('Dàn ý cũ vẫn được giữ');
    expect(findButton(container, 'Xem dàn ý cũ')).toBeTruthy();
    await act(async () => {
      findButton(container, 'Xem dàn ý cũ').click();
    });
    expect(container.textContent).toContain('Lan bảo vệ được bản đồ');
  });

  it('does not carry old entity exclusions into automatic outline regeneration', async () => {
    useSuccessfulGeneration();
    await renderWizard();
    await generateSeedAndOutline();
    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });

    const removeButtons = container.querySelectorAll('button[title="Loại khỏi dự án"]');
    expect(removeButtons.length).toBeGreaterThan(0);
    await act(async () => {
      removeButtons[0].click();
      findButton(container, 'Quay lại').click();
    });
    await act(async () => {
      container.querySelector('.wizard-auto-toggle input').click();
      findButton(container, 'Tạo lại nền truyện').click();
    });

    expect(findButton(container, 'Duyệt & tạo dự án')).toBeTruthy();
    expect(findButton(container, 'Duyệt & tạo dự án').disabled).toBe(false);
    expect(container.textContent).not.toContain('Dàn ý này thuộc nền truyện trước khi chỉnh sửa');
  });

  it('applies an automatically regenerated outline to the latest seed result', async () => {
    let seedCallCount = 0;
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      if (taskType === 'chapter_outline_pass') {
        onComplete(JSON.stringify(outlineResult));
      } else {
        seedCallCount += 1;
        onComplete(JSON.stringify(seedCallCount === 1
          ? seedResult
          : { ...seedResult, title: 'Bản Đồ Mới' }));
      }
      return { abort: vi.fn() };
    });
    await renderWizard();
    await generateSeedAndOutline();
    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });
    await act(async () => {
      findButton(container, 'Quay lại').click();
    });
    await act(async () => {
      container.querySelector('.wizard-auto-toggle input').click();
      findButton(container, 'Tạo lại nền truyện').click();
    });

    expect(findButton(container, 'Duyệt & tạo dự án')).toBeTruthy();
    await act(async () => {
      findButton(container, 'Sửa nền truyện').click();
    });
    expect(container.querySelector('.wizard-title-input').value).toBe('Bản Đồ Mới');
  });

  it('updates the textarea immediately and writes only after the autosave delay', async () => {
    vi.useFakeTimers();
    await renderWizard();
    await enterIdea('Ý tưởng phải hiển thị ngay, không chờ autosave.');

    const ideaField = Array.from(container.querySelectorAll('.wizard-body textarea.textarea'))
      .find((textarea) => textarea.value.includes('hiển thị ngay'));
    expect(ideaField?.value).toBe('Ý tưởng phải hiển thị ngay, không chờ autosave.');
    expect(container.textContent).toContain('Đang chờ lưu thay đổi');
    expect(db.wizard_drafts.put).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(db.wizard_drafts.put).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(db.wizard_drafts.put).toHaveBeenCalledTimes(1);
    expect(draftRecord.payload.idea).toBe('Ý tưởng phải hiển thị ngay, không chờ autosave.');
  });

  it('protects browser unload while an IndexedDB write is still in progress', async () => {
    vi.useFakeTimers();
    let finishWrite;
    db.wizard_drafts.put.mockImplementationOnce(() => new Promise((resolve) => {
      finishWrite = resolve;
    }));
    await renderWizard();
    await enterIdea('Bản nháp đang được ghi nền.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const unloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    await act(async () => {
      finishWrite();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('restores a saved draft after the wizard is reopened', async () => {
    vi.useFakeTimers();
    await renderWizard();
    await enterIdea('Bản nháp cần được khôi phục.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectWizard onClose={onClose} onCreated={() => {}} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Tìm thấy bản nháp');
    await act(async () => {
      findButton(container, 'Tiếp tục bản nháp').click();
    });

    const restoredIdea = Array.from(container.querySelectorAll('.wizard-body textarea.textarea'))
      .find((textarea) => textarea.value === 'Bản nháp cần được khôi phục.');
    expect(restoredIdea).toBeTruthy();
  });

  it('requires confirmation before deleting a restored draft to start fresh', async () => {
    draftRecord = {
      id: 'ai-story-wizard',
      version: 1,
      updated_at: Date.now(),
      payload: { step: 0, idea: 'Bản nháp không được xóa bằng một lần bấm.' },
    };
    await renderWizard();

    await act(async () => {
      findButton(container, 'Bắt đầu lại').click();
    });
    expect(draftRecord).not.toBeNull();
    expect(container.textContent).toContain('Xóa bản nháp này?');

    await act(async () => {
      findButton(container, 'Xóa bản nháp, bắt đầu lại').click();
      await Promise.resolve();
    });
    expect(draftRecord).toBeNull();
    expect(container.textContent).not.toContain('Tìm thấy bản nháp');
  });

  it('flushes the latest snapshot when internal navigation unmounts before 400 ms', async () => {
    vi.useFakeTimers();
    await renderWizard();
    await enterIdea('Phải lưu cả khi Dashboard bị unmount sớm.');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    root = null;

    expect(db.wizard_drafts.put).toHaveBeenCalledTimes(1);
    expect(draftRecord.payload.idea).toBe('Phải lưu cả khi Dashboard bị unmount sớm.');
  });

  it('flushes the latest draft and aborts the active AI request before closing', async () => {
    const abort = vi.fn();
    let finishLate;
    aiService.send.mockImplementation(({ onComplete }) => {
      finishLate = onComplete;
      return { abort };
    });
    await renderWizard();
    await enterIdea('Bản nháp đang gửi AI.');
    await act(async () => {
      findButton(container, 'Tạo nền truyện').click();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Đóng trình tạo truyện"]').click();
    });
    await act(async () => {
      findButton(container, 'Dừng AI, lưu nháp và thoát').click();
      await Promise.resolve();
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(draftRecord.payload.idea).toBe('Bản nháp đang gửi AI.');
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishLate(JSON.stringify(seedResult));
    });
    expect(container.textContent).not.toContain('Bản Đồ Cổ');
  });

  it('clears pending autosave work after project creation so the completed draft cannot reappear', async () => {
    vi.useFakeTimers();
    useSuccessfulGeneration();
    const onCreated = vi.fn();
    await renderWizard({ onCreated });
    await generateSeedAndOutline();

    const approveButton = findButton(container, 'Duyệt & tạo dự án');
    expect(approveButton.disabled).toBe(false);
    await act(async () => {
      approveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onCreated).toHaveBeenCalledWith(7);
    expect(db.wizard_drafts.delete).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      root.unmount();
      await Promise.resolve();
    });
    root = null;
    expect(db.wizard_drafts.put).not.toHaveBeenCalled();
    expect(draftRecord).toBeNull();
  });

  it('does not close while the final project records are being created', async () => {
    let finishProjectCreation;
    projectState.createProject.mockImplementationOnce(() => new Promise((resolve) => {
      finishProjectCreation = resolve;
    }));
    useSuccessfulGeneration();
    const onCreated = vi.fn();
    await renderWizard({ onCreated });
    await generateSeedAndOutline();

    await act(async () => {
      findButton(container, 'Duyệt & tạo dự án').click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('button[aria-label="Đóng trình tạo truyện"]').click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Đang hoàn tất dữ liệu dự án');
    expect(container.textContent).not.toContain('Dừng AI, lưu nháp và thoát');

    await act(async () => {
      finishProjectCreation(7);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCreated).toHaveBeenCalledWith(7);
  });

  it('stays open and reports the error when an explicit save before closing fails', async () => {
    db.wizard_drafts.put.mockRejectedValueOnce(new Error('storage unavailable'));
    await renderWizard();
    await enterIdea('Bản nháp không được phép mất khi IndexedDB lỗi.');

    await act(async () => {
      container.querySelector('button[aria-label="Đóng trình tạo truyện"]').click();
    });
    await act(async () => {
      findButton(container, 'Lưu nháp và thoát').click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Không thể lưu bản nháp');
    expect(container.textContent).toContain('Thoát trình tạo truyện?');
  });

  it('stays open when deleting a draft fails instead of pretending it was discarded', async () => {
    await renderWizard();
    await enterIdea('Bản nháp chỉ được bỏ khi IndexedDB xác nhận đã xóa.');
    db.wizard_drafts.delete.mockRejectedValueOnce(new Error('delete unavailable'));

    await act(async () => {
      container.querySelector('button[aria-label="Đóng trình tạo truyện"]').click();
    });
    await act(async () => {
      findButton(container, 'Bỏ bản nháp và thoát').click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Không thể xóa bản nháp');
    expect(container.textContent).toContain('Thoát trình tạo truyện?');
  });
});
