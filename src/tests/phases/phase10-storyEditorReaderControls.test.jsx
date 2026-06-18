import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StoryEditor from '../../components/editor/StoryEditor.jsx';

const mocks = vi.hoisted(() => ({
  projectState: {
    currentProject: { id: 1, title: 'Mùa hạ cuối cùng' },
    chapters: [
      {
        id: 10,
        title: 'Chương 1: Cơn mưa đầu mùa',
        order_index: 0,
        summary: 'Tóm tắt chương',
        purpose: '',
      },
    ],
    scenes: [
      {
        id: 101,
        chapter_id: 10,
        order_index: 0,
        title: 'Cảnh mở đầu',
        draft_text: '<p>Trời đổ mưa.</p>',
      },
      {
        id: 102,
        chapter_id: 10,
        order_index: 1,
        title: 'Cuộc gặp',
        draft_text: '<p>Họ gặp nhau.</p>',
      },
    ],
    activeChapterId: 10,
    activeSceneId: 101,
    updateScene: vi.fn(async () => {}),
    updateChapter: vi.fn(async () => {}),
    updateProjectTimestamp: vi.fn(async () => {}),
  },
}));

vi.mock('../../stores/projectStore', () => ({
  default: () => mocks.projectState,
}));

vi.mock('../../services/db/database', () => ({
  default: {
    characters: {
      where: () => ({
        equals: () => ({ toArray: async () => [] }),
      }),
    },
  },
}));

vi.mock('../../components/editor/ContinuityBar', () => ({
  default: () => <div data-testid="continuity-bar">Continuity Bar</div>,
}));

vi.mock('../../components/editor/SceneDetailPanel', () => ({
  default: () => <div data-testid="scene-detail-panel">Chi tiết cảnh</div>,
}));

vi.mock('../../components/editor/ChapterReader', () => ({
  default: ({ chapterId }) => <div data-testid="chapter-reader">Reader {chapterId}</div>,
}));

describe('phase10 StoryEditor reader controls', () => {
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

  async function renderEditor(props) {
    root = createRoot(container);
    await act(async () => {
      root.render(<StoryEditor {...props} />);
    });
  }

  it('uses a separate desktop row for the chapter heading above editor actions', async () => {
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
    });

    const headerMain = container.querySelector('.story-editor-header-main');
    expect(headerMain.classList.contains('story-editor-header-main--desktop')).toBe(true);
    expect(headerMain.firstElementChild.classList.contains('story-editor-heading')).toBe(true);
    expect(headerMain.lastElementChild.classList.contains('story-editor-header-actions')).toBe(true);
  });

  it('renders the desktop segmented control and removes writing-only panels in reader mode', async () => {
    const onViewModeChange = vi.fn();

    await renderEditor({
      isMobileLayout: false,
      viewMode: 'reader',
      onViewModeChange,
    });

    const switchButtons = Array.from(
      container.querySelectorAll('.story-editor-view-switch__btn'),
    );
    expect(switchButtons.map((button) => button.textContent.trim())).toEqual([
      'Từng cảnh',
      'Đọc liền',
    ]);
    expect(switchButtons[1].getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Đọc liền · 2 cảnh');
    expect(container.textContent).toContain('Chương 1: Cơn mưa đầu mùa');
    expect(container.querySelector('[data-testid="chapter-reader"]')).not.toBeNull();
    expect(container.querySelector('.story-editor-detail-trigger')).toBeNull();
    expect(container.querySelector('.chapter-outline-panel')).toBeNull();
    expect(container.querySelector('[data-testid="continuity-bar"]')).toBeNull();
    expect(mocks.projectState.updateScene).not.toHaveBeenCalled();

    await act(async () => switchButtons[0].click());

    expect(onViewModeChange).toHaveBeenCalledWith('scene');
    expect(mocks.projectState.activeSceneId).toBe(101);
  });

  it('renders only scene and font actions in the phone reader header', async () => {
    const onViewModeChange = vi.fn();

    await renderEditor({
      isMobileLayout: true,
      hasMobileProjectShell: true,
      viewMode: 'reader',
      onViewModeChange,
    });

    const readerActions = Array.from(
      container.querySelectorAll('.story-editor-reader-action'),
    );
    expect(readerActions.map((button) => button.textContent.trim())).toEqual(['Từng cảnh']);
    expect(container.querySelector('.story-editor-font-trigger')?.textContent.trim()).toBe('Cỡ chữ');
    expect(container.querySelector('.story-editor-view-switch')).toBeNull();
    expect(container.textContent).not.toContain('Chương 1: Cơn mưa đầu mùa');

    await act(async () => readerActions[0].click());

    expect(onViewModeChange).toHaveBeenCalledWith('scene');
  });

  it('renders chapter, scene, and font actions in the tablet reader header', async () => {
    const onOpenChapters = vi.fn();

    await renderEditor({
      isMobileLayout: true,
      hasMobileProjectShell: false,
      viewMode: 'reader',
      onOpenChapters,
    });

    const readerActions = Array.from(
      container.querySelectorAll('.story-editor-reader-action'),
    );
    expect(readerActions.map((button) => button.textContent.trim())).toEqual([
      'Chương',
      'Từng cảnh',
    ]);
    expect(container.querySelector('.story-editor-font-trigger')?.textContent.trim()).toBe('Cỡ chữ');

    await act(async () => readerActions[0].click());

    expect(onOpenChapters).toHaveBeenCalledTimes(1);
  });
});
