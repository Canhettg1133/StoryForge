import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockedProjectStoreState = {};

vi.mock('../../stores/projectStore', () => ({
  default: () => mockedProjectStoreState,
}));

async function loadChapterList() {
  vi.resetModules();
  const [chapterModule, dialogModule] = await Promise.all([
    import('../../components/common/ChapterList.jsx'),
    import('../../components/common/ConfirmDialogProvider.jsx'),
  ]);
  return {
    ChapterList: chapterModule.default,
    ConfirmDialogProvider: dialogModule.ConfirmDialogProvider,
  };
}

function buildChapters(count = 18) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    project_id: 1,
    title: `Chuong ${index + 1}`,
    order_index: index,
    status: 'draft',
    actual_word_count: 0,
  }));
}

function buildScenes(chapters) {
  return chapters.map((chapter) => ({
    id: chapter.id * 100,
    project_id: 1,
    chapter_id: chapter.id,
    title: `Canh ${chapter.id}`,
    order_index: 0,
    draft_text: '',
    final_text: '',
  }));
}

describe('phase10 chapter list scroll persistence', () => {
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

  it('keeps the chapter panel scroll position after deleting a chapter', async () => {
    const { ChapterList, ConfirmDialogProvider } = await loadChapterList();
    const initialChapters = buildChapters();
    const initialScenes = buildScenes(initialChapters);

    function Harness() {
      const [chapters, setChapters] = useState(initialChapters);
      const [scenes, setScenes] = useState(initialScenes);

      mockedProjectStoreState = {
        chapters,
        scenes,
        activeChapterId: 12,
        activeSceneId: 1200,
        createChapter: vi.fn(),
        createScene: vi.fn(),
        deleteChapter: async (id) => {
          setChapters((current) => current.filter((chapter) => chapter.id !== id));
          setScenes((current) => current.filter((scene) => scene.chapter_id !== id));
        },
        deleteScene: vi.fn(),
        updateChapter: vi.fn(),
        updateScene: vi.fn(),
        setActiveChapter: vi.fn(),
        setActiveScene: vi.fn(),
        refreshChapterWordCount: vi.fn(),
        completingChapterId: null,
        chapterCompletionById: {},
        runChapterCompletion: vi.fn(),
      };

      return (
        <ConfirmDialogProvider>
          <ChapterList />
        </ConfirmDialogProvider>
      );
    }

    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const scrollContainer = container.querySelector('.chapter-list-tree');
    expect(scrollContainer).not.toBeNull();
    scrollContainer.scrollTop = 240;

    const chapterItems = container.querySelectorAll('.chapter-item');
    expect(chapterItems.length).toBeGreaterThan(10);

    await act(async () => {
      chapterItems[10].dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 120,
      }));
    });

    const deleteButton = container.querySelector('.context-menu-item.danger');
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton.click();
    });

    const confirmDialog = container.querySelector('.confirm-dialog');
    expect(confirmDialog).not.toBeNull();
    await act(async () => {
      Array.from(confirmDialog.querySelectorAll('button')).at(-1).click();
    });

    expect(scrollContainer.scrollTop).toBe(240);
    expect(mockedProjectStoreState.chapters).toHaveLength(initialChapters.length - 1);
    expect(mockedProjectStoreState.chapters.some((chapter) => chapter.id === 11)).toBe(false);
  });
});
