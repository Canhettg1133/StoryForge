import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aiService from '../../services/ai/client';

let projectState;
let codexState;
let plotState;

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../stores/plotStore', () => ({
  default: () => plotState,
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../../pages/OutlineBoard/ArcGenerationModal', () => ({
  default: () => null,
}));

function buildChapters(count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    project_id: 1,
    title: `Chương ${index + 1}`,
    order_index: index,
    status: 'draft',
    purpose: index === 0 ? 'Mục tiêu cũ' : '',
    summary: index === 0 ? 'Tóm tắt cũ' : '',
    state_delta: index === 0 ? 'Biến đổi cũ' : '',
    arc_id: index === 0 ? 1 : null,
    featured_characters: index === 0 ? ['Lan'] : [],
    primary_location: index === 0 ? 'Thành Cổ' : '',
    thread_titles: index === 0 ? ['Bí mật bản đồ'] : [],
    key_events: index === 0 ? ['Lan giữ bản đồ'] : [],
    required_factions: index === 0 ? ['Thần Vũ Tông'] : [],
    required_objects: index === 0 ? ['Ngọc bội'] : [],
    required_terms: index === 0 ? ['Linh căn'] : [],
    opening_state: index === 0 ? 'Lan vừa tới Thành Cổ.' : '',
    handoff_from_previous: index === 0 ? 'Nối tiếp chương trước.' : '',
    ending_state: index === 0 ? 'Lan bị theo dõi.' : '',
  }));
}

function buildScenes(chapters) {
  return chapters.map((chapter) => ({
    id: chapter.id * 100,
    project_id: 1,
    chapter_id: chapter.id,
    title: `Cảnh ${chapter.id}`,
    order_index: 0,
    draft_text: chapter.id === 1
      ? 'Lan là nhân vật chính nữ của Thần Vũ Tông. Cô giữ ngọc bội và không hề gia nhập Vô Ảnh Tông.'
      : '',
    final_text: '',
  }));
}

function buildAiChapters(count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Chương ${index + 1}`,
    purpose: index === 0 ? 'Mục tiêu mới' : `Mục tiêu ${index + 1}`,
    summary: index === 0 ? 'Tóm tắt mới dựa trên nội dung đã viết' : `Tóm tắt ${index + 1}`,
    state_delta: index === 0 ? '' : `Biến đổi ${index + 1}`,
    act: index < 6 ? 1 : index < 12 ? 2 : 3,
    featured_characters: index === 0 ? ['Lan'] : [],
    primary_location: index === 0 ? 'Thành Cổ' : '',
    key_events: index === 0 ? ['Lan giữ ngọc bội'] : [],
  }));
}

async function loadOutlineBoard() {
  vi.resetModules();
  const module = await import('../../pages/OutlineBoard/OutlineBoard.jsx');
  return module.default;
}

async function renderBoard(container, root) {
  const OutlineBoard = await loadOutlineBoard();
  await act(async () => {
    root.render(<OutlineBoard />);
  });
}

function clickByText(container, text) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent.includes(text));
  expect(button, `Không tìm thấy nút "${text}"`).toBeTruthy();
  button.click();
}

function clickByAriaLabel(container, label) {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  expect(button, `Không tìm thấy nút có aria-label "${label}"`).toBeTruthy();
  button.click();
}

describe('phase10 outline board AI analysis safety', () => {
  let container;
  let root;
  let chapters;
  let updateChapter;
  let createPlotThread;
  let confirmSpy;

  beforeEach(() => {
    chapters = buildChapters();
    updateChapter = vi.fn(async () => {});
    createPlotThread = vi.fn(async () => 99);
    projectState = {
      currentProject: {
        id: 1,
        title: 'Dự án thử',
        description: 'Một truyện thử.',
        genre_primary: 'fantasy',
      },
      chapters,
      scenes: buildScenes(chapters),
      createChapter: vi.fn(async () => ({ chapterId: 999 })),
      updateChapter,
      setActiveChapter: vi.fn(),
      setActiveScene: vi.fn(),
    };
    codexState = {
      characters: [
        {
          id: 1,
          name: 'Lan',
          role: 'protagonist',
          specific_role: 'nhân vật chính nữ của Thần Vũ Tông',
          current_status: 'Đang giữ ngọc bội.',
        },
      ],
      locations: [{ id: 1, name: 'Thành Cổ' }],
      loadCodex: vi.fn(),
    };
    plotState = {
      plotThreads: [],
      loadPlotThreads: vi.fn(),
      loadThreadBeatsForProject: vi.fn(),
      createPlotThread,
      deletePlotThread: vi.fn(),
      threadBeats: [],
    };
    aiService.send.mockImplementation(({ onComplete }) => {
      onComplete(JSON.stringify({
        chapters: buildAiChapters(),
        plot_threads: [{
          title: 'Tuyến AI không được tự lưu',
          type: 'mystery',
          description: 'Chỉ hiển thị như gợi ý.',
        }],
      }));
    });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    document.body.innerHTML = '';
    confirmSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('previews AI analysis for existing chapters without updating chapters immediately', async () => {
    await renderBoard(container, root);

    await act(async () => {
      clickByText(container, 'AI Phân tích');
      await Promise.resolve();
    });

    expect(aiService.send).toHaveBeenCalledTimes(1);
    const sentMessages = aiService.send.mock.calls[0][0].messages
      .map((message) => message.content)
      .join('\n');
    expect(sentMessages).toContain('Nội dung đã viết');
    expect(sentMessages).toContain('Lan là nhân vật chính nữ của Thần Vũ Tông');
    expect(sentMessages).toContain('không được bịa entity ngoài Codex');
    expect(updateChapter).not.toHaveBeenCalled();
    expect(createPlotThread).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Đề xuất phân tích dàn ý');
    expect(container.textContent).toContain('Chưa áp dụng');
    expect(container.textContent).toContain('Mục tiêu mới');
  });

  it('applies previewed analysis only after the user confirms applying all suggestions', async () => {
    await renderBoard(container, root);

    await act(async () => {
      clickByText(container, 'AI Phân tích');
      await Promise.resolve();
    });
    expect(updateChapter).not.toHaveBeenCalled();

    await act(async () => {
      clickByText(container, 'Áp dụng tất cả');
      await Promise.resolve();
    });

    expect(updateChapter).toHaveBeenCalledTimes(18);
    expect(updateChapter).toHaveBeenCalledWith(1, expect.objectContaining({
      purpose: 'Mục tiêu mới',
      summary: 'Tóm tắt mới dựa trên nội dung đã viết',
      arc_id: 1,
      featured_characters: ['Lan'],
      primary_location: 'Thành Cổ',
      key_events: ['Lan giữ ngọc bội'],
    }));
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('state_delta');
    expect(createPlotThread).not.toHaveBeenCalled();
  });

  it('dismisses the preview without writing data', async () => {
    await renderBoard(container, root);

    await act(async () => {
      clickByText(container, 'AI Phân tích');
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Đề xuất phân tích dàn ý');

    await act(async () => {
      clickByText(container, 'Bỏ qua');
      await Promise.resolve();
    });

    expect(updateChapter).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Đề xuất phân tích dàn ý');
  });

  it('shows a visible notice after manually adding a chapter', async () => {
    await renderBoard(container, root);

    await act(async () => {
      clickByText(container, 'Thêm chương');
      await Promise.resolve();
    });

    expect(projectState.createChapter).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Đã thêm chương mới và Cảnh 1.');
  });

  it('clears outline AI metadata without touching title, status, scenes, or written text', async () => {
    await renderBoard(container, root);

    expect(container.textContent).toContain('Xóa toàn bộ dàn ý AI');

    await act(async () => {
      clickByText(container, 'Xóa toàn bộ dàn ý AI');
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(updateChapter).toHaveBeenCalledTimes(18);
    expect(updateChapter).toHaveBeenCalledWith(1, expect.objectContaining({
      purpose: '',
      summary: '',
      state_delta: '',
      featured_characters: [],
      primary_location: '',
      thread_titles: [],
      key_events: [],
      required_factions: [],
      required_objects: [],
      required_terms: [],
      opening_state: '',
      handoff_from_previous: '',
      ending_state: '',
      conflict: '',
      decision_or_consequence: '',
      continuity_in: { response: '' },
      continuity_out: { text: '' },
      state_changes: [],
      pacing: '',
      arc_id: null,
    }));
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('title');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('status');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('scenes');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('draft_text');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('final_text');
  });

  it('exposes single-chapter outline clearing directly on chapter cards', async () => {
    await renderBoard(container, root);

    await act(async () => {
      clickByAriaLabel(container, 'Xóa dàn ý AI của Chương 1');
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('"Chương 1"'));
    expect(updateChapter).toHaveBeenCalledTimes(1);
    expect(updateChapter).toHaveBeenCalledWith(1, expect.objectContaining({
      purpose: '',
      summary: '',
      arc_id: null,
      featured_characters: [],
      key_events: [],
      required_terms: [],
    }));
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('title');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('status');
  });

  it('clears outline AI metadata for a single chapter from the detail modal', async () => {
    await renderBoard(container, root);

    await act(async () => {
      const chapterOneCard = Array.from(container.querySelectorAll('.outline-card'))
        .find((item) => item.querySelector('.outline-card-title')?.textContent.trim() === 'Chương 1');
      expect(chapterOneCard, 'Không tìm thấy card Chương 1').toBeTruthy();
      chapterOneCard.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Xóa dàn ý chương này');

    await act(async () => {
      clickByText(container, 'Xóa dàn ý chương này');
      await Promise.resolve();
    });

    expect(updateChapter).toHaveBeenCalledTimes(1);
    expect(updateChapter).toHaveBeenCalledWith(1, expect.objectContaining({
      purpose: '',
      summary: '',
      arc_id: null,
      featured_characters: [],
      key_events: [],
      required_terms: [],
    }));
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('title');
    expect(updateChapter.mock.calls[0][1]).not.toHaveProperty('status');
  });
});
