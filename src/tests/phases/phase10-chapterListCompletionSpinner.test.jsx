import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockedProjectStoreState = {};

vi.mock('../../stores/projectStore', () => ({
  default: () => mockedProjectStoreState,
}));

async function loadChapterList() {
  vi.resetModules();
  const module = await import('../../components/common/ChapterList.jsx');
  return module.default;
}

function buildStoreState(overrides = {}) {
  return {
    chapters: [
      {
        id: 6,
        project_id: 1,
        title: 'Chương 6: Nghịch cảnh',
        order_index: 5,
        status: 'draft',
        actual_word_count: 2057,
      },
    ],
    scenes: [
      {
        id: 61,
        project_id: 1,
        chapter_id: 6,
        title: 'Cảnh 1',
        order_index: 0,
        draft_text: 'Nội dung cảnh.',
        final_text: '',
      },
    ],
    activeChapterId: 6,
    activeSceneId: 61,
    createChapter: vi.fn(),
    createScene: vi.fn(),
    deleteChapter: vi.fn(),
    deleteScene: vi.fn(),
    updateChapter: vi.fn(),
    updateScene: vi.fn(),
    setActiveChapter: vi.fn(),
    setActiveScene: vi.fn(),
    refreshChapterWordCount: vi.fn(),
    completingChapterId: null,
    chapterCompletionById: {},
    runChapterCompletion: vi.fn(),
    ...overrides,
  };
}

describe('phase10 chapter list completion spinner', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('shows the chapter spinner only while completion state is running', async () => {
    const ChapterList = await loadChapterList();

    mockedProjectStoreState = buildStoreState({
      completingChapterId: 6,
      chapterCompletionById: {
        6: { running: true, phase: 'canon' },
      },
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<ChapterList />);
    });

    expect(container.querySelector('.chapter-loading-icon')).not.toBeNull();

    mockedProjectStoreState = buildStoreState({
      completingChapterId: null,
      chapterCompletionById: {
        6: { running: false, phase: 'done' },
      },
    });

    await act(async () => {
      root.render(<ChapterList />);
    });

    expect(container.querySelector('.chapter-loading-icon')).toBeNull();
  });

  it('does not style the desktop completion action as success state', async () => {
    const ChapterList = await loadChapterList();

    mockedProjectStoreState = buildStoreState();

    root = createRoot(container);
    await act(async () => {
      root.render(<ChapterList />);
    });

    await act(async () => {
      container.querySelector('.chapter-item').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 32,
        clientY: 32,
      }));
    });

    const completionAction = container.querySelector('.context-menu-item--action');

    expect(completionAction).not.toBeNull();
    expect(completionAction.classList.contains('context-menu-item--success')).toBe(false);
  });

  it('does not style the mobile completion action as success state', async () => {
    const ChapterList = await loadChapterList();

    mockedProjectStoreState = buildStoreState();

    root = createRoot(container);
    await act(async () => {
      root.render(<ChapterList isMobileLayout />);
    });

    await act(async () => {
      container.querySelector('.chapter-mobile-actions').dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }));
    });

    const completionAction = container.querySelector('.chapter-mobile-sheet-btn--action');

    expect(completionAction).not.toBeNull();
    expect(completionAction.classList.contains('chapter-mobile-sheet-btn--success')).toBe(false);
  });
});
