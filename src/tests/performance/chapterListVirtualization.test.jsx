import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockedProjectStoreState = {};

vi.mock('../../stores/projectStore', () => ({
  default: () => mockedProjectStoreState,
}));

function buildStoreState(chapters, scenes) {
  return {
    chapters,
    scenes,
    activeChapterId: chapters[0]?.id || null,
    activeSceneId: scenes[0]?.id || null,
    createChapter: vi.fn(),
    createScene: vi.fn(),
    deleteChapter: vi.fn(),
    deleteScene: vi.fn(),
    updateChapter: vi.fn(),
    updateScene: vi.fn(),
    setActiveChapter: vi.fn(),
    setActiveScene: vi.fn(),
    completingChapterId: null,
    chapterCompletionById: {},
    runChapterCompletion: vi.fn(),
  };
}

describe('chapter list virtualization and expansion state', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('keeps only a bounded chapter window mounted for a 1,000 chapter project', async () => {
    const ChapterList = (await import('../../components/common/ChapterList.jsx')).default;
    const chapters = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      order_index: index,
      title: `Chương ${index + 1}`,
      actual_word_count: 0,
    }));
    const scenes = chapters.map((chapter) => ({
      id: chapter.id * 10,
      project_id: 1,
      chapter_id: chapter.id,
      order_index: 0,
      title: 'Cảnh 1',
    }));
    mockedProjectStoreState = buildStoreState(chapters, scenes);

    root = createRoot(container);
    await act(async () => root.render(<ChapterList />));

    const mountedChapterCount = container.querySelectorAll('.chapter-node').length;
    expect(mountedChapterCount).toBeGreaterThan(0);
    expect(mountedChapterCount).toBeLessThan(30);
  });

  it('uses a tighter mobile overscan window on low-end phone layouts', async () => {
    const ChapterList = (await import('../../components/common/ChapterList.jsx')).default;
    const chapters = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      order_index: index,
      title: `Chương ${index + 1}`,
      actual_word_count: 0,
    }));
    const scenes = chapters.map((chapter) => ({
      id: chapter.id * 10,
      project_id: 1,
      chapter_id: chapter.id,
      order_index: 0,
      title: 'Cảnh 1',
    }));
    mockedProjectStoreState = buildStoreState(chapters, scenes);

    root = createRoot(container);
    await act(async () => root.render(<ChapterList isMobileLayout />));

    const mountedChapterCount = container.querySelectorAll('.chapter-mobile-group').length;
    expect(mountedChapterCount).toBeGreaterThan(0);
    expect(mountedChapterCount).toBeLessThanOrEqual(10);
  });

  it('does not reconcile an unchanged chapter row during virtual window updates', async () => {
    const { VirtualChapterRow } = await import('../../components/common/chapterList/VirtualChapterWindow.jsx');
    const chapter = { id: 1, title: 'Chương giữ nguyên' };
    const renderItem = vi.fn((item) => <span>{item.title}</span>);
    const measureElement = vi.fn();
    let updateWindow;

    function Harness() {
      const [, setWindowVersion] = useState(0);
      updateWindow = () => setWindowVersion((version) => version + 1);
      return (
        <VirtualChapterRow
          item={chapter}
          index={0}
          rowKey={chapter.id}
          start={0}
          rowClassName="chapter-virtual-row--mobile"
          measureElement={measureElement}
          renderItem={renderItem}
        />
      );
    }

    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    expect(renderItem).toHaveBeenCalledTimes(1);

    await act(async () => updateWindow());
    expect(renderItem).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a chapter the user collapsed when only its word count changes', async () => {
    const ChapterList = (await import('../../components/common/ChapterList.jsx')).default;
    const initialChapter = {
      id: 1,
      project_id: 1,
      order_index: 0,
      title: 'Chương 1',
      actual_word_count: 0,
    };
    const scenes = [{ id: 10, project_id: 1, chapter_id: 1, order_index: 0, title: 'Cảnh cần giữ đóng' }];
    let updateWordCount;

    function Harness() {
      const [chapters, setChapters] = useState([initialChapter]);
      updateWordCount = () => setChapters((current) => current.map((chapter) => ({
        ...chapter,
        actual_word_count: 42,
      })));
      mockedProjectStoreState = buildStoreState(chapters, scenes);
      return <ChapterList />;
    }

    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain('Cảnh cần giữ đóng');

    await act(async () => container.querySelector('.chapter-expand-icon').click());
    expect(container.textContent).not.toContain('Cảnh cần giữ đóng');

    await act(async () => updateWordCount());
    expect(container.textContent).not.toContain('Cảnh cần giữ đóng');
  });
});
