import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChapterReader from '../../components/editor/ChapterReader.jsx';
import { buildChapterReaderModel } from '../../components/editor/chapterReaderModel.js';
import SceneEditor from '../../pages/SceneEditor/SceneEditor.jsx';
import MobileProjectShell, { EDITOR_PANEL_EVENT } from '../../components/mobile/MobileProjectShell.jsx';
import useUIStore from '../../stores/uiStore.js';

const mocks = vi.hoisted(() => ({
  viewportWidth: 800,
  clearOutput: vi.fn(),
  projectState: {
    currentProject: { id: 1, title: 'Mùa Hạ Cuối Cùng' },
    chapters: [
      { id: 10, title: 'Chương 1: Cơn mưa đầu mùa', order_index: 0 },
    ],
    scenes: [
      { id: 101, chapter_id: 10, order_index: 0, title: 'Cảnh mở đầu', draft_text: '<p>Trời đổ mưa.</p>' },
      { id: 102, chapter_id: 10, order_index: 1, title: 'Cuộc gặp', draft_text: '<p>Họ gặp nhau.</p>' },
    ],
    activeChapterId: 10,
    activeSceneId: 101,
  },
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: (breakpoint = 900) => mocks.viewportWidth <= breakpoint,
}));

vi.mock('../../stores/projectStore', () => ({
  default: (selector = (state) => state) => selector(mocks.projectState),
}));

vi.mock('../../stores/aiStore', () => ({
  default: (selector) => selector({ clearOutput: mocks.clearOutput }),
}));

vi.mock('../../components/common/ChapterList', () => ({
  default: () => <div>Danh sách chương</div>,
}));

vi.mock('../../components/ai/AISidebar', () => ({
  default: () => <div>AI Sidebar</div>,
}));

vi.mock('../../components/editor/StoryEditor', () => ({
  default: ({ viewMode }) => <div data-testid="story-editor-mode">{viewMode}</div>,
}));

function createScene(overrides = {}) {
  return {
    id: 1,
    chapter_id: 10,
    order_index: 0,
    title: 'Cảnh',
    draft_text: '<p>Nội dung</p>',
    ...overrides,
  };
}

describe('phase10 chapter reader model', () => {
  it('filters the active chapter, sorts scenes, skips empty drafts, and preserves Vietnamese', () => {
    const scenes = [
      createScene({ id: 4, chapter_id: 20, order_index: 0, draft_text: '<p>Chương khác</p>' }),
      createScene({ id: 2, order_index: 2, draft_text: '<p><strong>Cuộc gặp trong mưa</strong></p>' }),
      createScene({ id: 3, order_index: 1, draft_text: '<p>&nbsp;</p>' }),
      createScene({ id: 1, order_index: 0, draft_text: '<p>Khởi đầu mùa hạ.</p>' }),
    ];

    const model = buildChapterReaderModel(scenes, 10);

    expect(model.readableScenes.map((scene) => scene.id)).toEqual([1, 2]);
    expect(model.totalSceneCount).toBe(3);
    expect(model.html).toBe('<p>Khởi đầu mùa hạ.</p><hr><p><strong>Cuộc gặp trong mưa</strong></p>');
    expect(model.wordCount).toBe(8);
    expect(scenes.map((scene) => scene.id)).toEqual([4, 2, 3, 1]);
  });

  it('does not add a divider before or after readable content', () => {
    const model = buildChapterReaderModel([
      createScene({ id: 1, draft_text: '<p></p>' }),
      createScene({ id: 2, order_index: 1, draft_text: '<p>Một cảnh duy nhất.</p>' }),
    ], 10);

    expect(model.html).toBe('<p>Một cảnh duy nhất.</p>');
    expect(model.html).not.toContain('===================');
  });
});

describe('phase10 ChapterReader', () => {
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
  });

  it('renders formatted chapter content as read-only with visual scene dividers', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChapterReader
          chapterId={10}
          scenes={[
            createScene({ id: 1, draft_text: '<p>Trời đổ mưa.</p>' }),
            createScene({ id: 2, order_index: 1, draft_text: '<p><em>Cô bước vào hiên.</em></p>' }),
          ]}
        />,
      );
    });

    const reader = container.querySelector('.chapter-reader-content');
    expect(reader).not.toBeNull();
    expect(reader.getAttribute('contenteditable')).toBe('false');
    expect(container.querySelectorAll('.chapter-reader-content hr')).toHaveLength(1);
    expect(container.querySelectorAll('.chapter-reader-divider')).toHaveLength(1);
    expect(container.textContent).toContain('Trời đổ mưa.');
    expect(container.textContent).toContain('Cô bước vào hiên.');
    expect(container.textContent).toContain('Hết chương · 2 cảnh · 7 từ');
    expect(container.textContent).not.toContain('===================');
  });

  it('shows a Vietnamese empty state when every scene is blank', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChapterReader
          chapterId={10}
          scenes={[createScene({ draft_text: '<p>&nbsp;</p>' })]}
        />,
      );
    });

    expect(container.textContent).toContain('Chương này chưa có nội dung để đọc.');
  });

  it('scrolls back to the top when the active chapter changes', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChapterReader
          chapterId={10}
          scenes={[createScene({ chapter_id: 10 })]}
        />,
      );
    });

    const reader = container.querySelector('.chapter-reader');
    reader.scrollTop = 320;

    await act(async () => {
      root.render(
        <ChapterReader
          chapterId={20}
          scenes={[createScene({ chapter_id: 20 })]}
        />,
      );
    });

    expect(reader.scrollTop).toBe(0);
  });
});

describe('phase10 responsive chapter reader controls', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useUIStore.getState().setStoryEditorViewMode('scene');
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    mocks.projectState.activeChapterId = 10;
    useUIStore.getState().setStoryEditorViewMode('scene');
  });

  async function renderSceneEditor(width) {
    mocks.viewportWidth = width;
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project/1/editor']}>
          <SceneEditor />
        </MemoryRouter>,
      );
    });
  }

  it('uses the compact two-action layout on phones and hides AI in reader mode', async () => {
    await renderSceneEditor(800);

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((button) => button.textContent.includes('Đọc liền'))).toBe(true);
    expect(buttons.some((button) => button.textContent.trim() === 'Chương')).toBe(false);
    expect(container.textContent).toContain('AI viết');

    const readButton = buttons.find((button) => button.textContent.includes('Đọc liền'));
    await act(async () => readButton.click());

    expect(container.querySelector('[data-testid="story-editor-mode"]')?.textContent).toBe('reader');
    expect(container.textContent).not.toContain('AI Sidebar');
  });

  it('keeps chapter access beside reader and AI actions on tablet widths', async () => {
    await renderSceneEditor(1000);

    const text = container.textContent;
    expect(text).toContain('Chương');
    expect(text).toContain('Đọc liền');
    expect(text).toContain('AI viết');
  });

  it('initializes a heavy mobile panel on first open and keeps its state mounted afterward', async () => {
    await renderSceneEditor(800);

    expect(container.textContent).not.toContain('AI Sidebar');

    const aiButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('AI viết'));
    await act(async () => aiButton.click());

    expect(container.textContent).toContain('AI Sidebar');
    const aiPanel = container.querySelector('.scene-editor-side--ai');
    expect(aiPanel?.classList.contains('is-open')).toBe(true);

    const closeButton = aiPanel.querySelector('button[title="Đóng AI"]');
    await act(async () => closeButton.click());

    expect(container.textContent).toContain('AI Sidebar');
    expect(aiPanel.classList.contains('is-open')).toBe(false);
    expect(aiPanel.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps reader mode active when the chapter changes', async () => {
    await renderSceneEditor(1000);

    const readButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Đọc liền'));
    await act(async () => readButton.click());

    mocks.projectState.activeChapterId = 20;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project/1/editor']}>
          <SceneEditor />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="story-editor-mode"]')?.textContent).toBe('reader');
  });

  it('shows the chapter-only mobile title while reader mode is active', async () => {
    mocks.viewportWidth = 800;
    useUIStore.getState().setStoryEditorViewMode('reader');
    const panelEventHandler = vi.fn();
    window.addEventListener(EDITOR_PANEL_EVENT, panelEventHandler);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project/1/editor']}>
          <MobileProjectShell><div>Nội dung</div></MobileProjectShell>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('Đọc liền · 2 cảnh');
    expect(container.textContent).toContain('Chương 1: Cơn mưa đầu mùa');
    expect(container.textContent).not.toContain('Cảnh mở đầu');
    expect(container.querySelector('.project-mobile-title__disclosure')).not.toBeNull();

    await act(async () => container.querySelector('.project-mobile-title--button').click());

    expect(panelEventHandler).toHaveBeenCalledTimes(1);
    expect(panelEventHandler.mock.calls[0][0].detail).toEqual({ panel: 'chapters' });
    window.removeEventListener(EDITOR_PANEL_EVENT, panelEventHandler);
  });
});
