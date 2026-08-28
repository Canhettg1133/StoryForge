import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StoryEditor from '../../components/editor/StoryEditor.jsx';

const mocks = vi.hoisted(() => ({
  canonState: {
    chapterCanon: { revision: { id: 501 } },
  },
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
  },
}));

vi.mock('../../stores/projectStore', () => ({
  default: () => mocks.projectState,
}));

vi.mock('../../stores/canonStore', () => ({
  default: (selector) => (selector ? selector(mocks.canonState) : mocks.canonState),
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

vi.mock('../../components/editor/ChapterChangeHistory', () => ({
  default: ({ chapterId, refreshKey }) => (
    <div data-testid="chapter-change-history" data-refresh-key={refreshKey}>Lịch sử {chapterId}</div>
  ),
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

  it('centers a prominent chapter title above the story area without an editable scene title', async () => {
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
    });

    const headerMain = container.querySelector('.story-editor-header-main');
    const storyArea = container.querySelector('.story-editor-wrapper');
    const heading = headerMain.querySelector('.story-editor-heading');
    const chapterTitle = heading?.querySelector('.story-editor-chapter-title');
    const css = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
    const titleRule = css.match(/\.story-editor-chapter-title\s*\{[^}]+\}/)?.[0] || '';

    expect(headerMain.firstElementChild).toBe(heading);
    expect(headerMain.lastElementChild.classList.contains('story-editor-header-actions')).toBe(true);
    expect(chapterTitle?.textContent).toBe(mocks.projectState.chapters[0].title);
    expect(storyArea?.querySelector('.story-editor-chapter-title')).toBeNull();
    expect(container.querySelector('.story-editor-scene-title')).toBeNull();
    expect(container.querySelector('input[aria-label="Tên cảnh"]')).toBeNull();
    expect(titleRule).toContain('text-align: center');
    expect(titleRule).toContain('font-size: var(--text-2xl)');
    expect(titleRule).toContain('font-family: var(--font-prose)');
  });

  it('removes the dedicated scene-title autosave path', () => {
    const source = readFileSync('src/components/editor/StoryEditor.jsx', 'utf8');

    expect(source).not.toContain('titleAutosaveControllerRef');
    expect(source).not.toContain('titleAutosaveStatus');
    expect(source).not.toContain('sceneTitleDraft');
    expect(source).not.toContain('scheduleSceneTitle');
    expect(source).not.toContain('flushSceneTitle');
  });

  it('places change history beside the chapter outline and opens it inline', async () => {
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
    });

    const toggleRow = container.querySelector('.chapter-outline-toggle-row');
    const buttons = Array.from(toggleRow.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent.trim())).toEqual(expect.arrayContaining([
      'Dàn ý',
      'Lịch sử thay đổi',
    ]));

    const historyButton = buttons.find((button) => button.textContent.includes('Lịch sử thay đổi'));
    await act(async () => historyButton.click());

    expect(historyButton.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="chapter-change-history"]')?.textContent)
      .toBe('Lịch sử 10');
    expect(container.querySelector('[data-testid="chapter-change-history"]')?.dataset.refreshKey)
      .toContain('501');
    expect(container.querySelector('.chapter-outline-body')).toBeNull();
  });

  it('collapses the chapter outline as soon as the live editor receives prose', async () => {
    const originalScene = mocks.projectState.scenes[0];
    mocks.projectState.scenes[0] = { ...originalScene, draft_text: '' };
    let editorInstance = null;

    try {
      await renderEditor({
        isMobileLayout: false,
        viewMode: 'scene',
        onEditorReady: (editor) => {
          editorInstance = editor;
        },
      });

      const outlineButton = container.querySelector('.chapter-outline-toggle');
      expect(outlineButton?.getAttribute('aria-expanded')).toBe('true');

      await act(async () => {
        editorInstance.commands.insertContent('Nội dung vừa gõ');
        await Promise.resolve();
      });

      expect(outlineButton?.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('.chapter-outline-body')).toBeNull();
    } finally {
      mocks.projectState.scenes[0] = originalScene;
    }
  });

  it('drives live outline state from the editor update callback instead of autosave state', () => {
    const source = readFileSync('src/components/editor/StoryEditor.jsx', 'utf8');
    const onUpdateBlock = source.match(/onUpdate:\s*\(\{ editor \}\)\s*=>\s*\{[\s\S]*?autosaveControllerRef\.current\?\.schedule/iu)?.[0] || '';

    expect(onUpdateBlock).toContain('setLiveEditorIsEmpty');
    expect(source).not.toContain('const liveEditorIsEmpty = useEditorState');
  });

  it('keeps the full change-history label and a comfortable tap target on mobile', async () => {
    await renderEditor({
      isMobileLayout: true,
      viewMode: 'scene',
    });

    const historyButton = Array.from(container.querySelectorAll('.chapter-history-toggle'))
      .find((button) => button.textContent.includes('Lịch sử thay đổi'));
    const css = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
    const mobileRule = css.match(/\.story-editor--mobile \.chapter-history-toggle\s*\{[^}]+\}/)?.[0] || '';

    expect(historyButton).toBeTruthy();
    expect(css).not.toMatch(/\.chapter-history-toggle span\s*\{\s*display:\s*none/);
    expect(mobileRule).toContain('min-height: 34px');
  });

  it('places scoring beside outline and history at the original compact mobile height', async () => {
    const onOpenManuscriptReview = vi.fn();
    await renderEditor({
      isMobileLayout: true,
      viewMode: 'scene',
      onOpenManuscriptReview,
    });

    const toggleRow = container.querySelector('.chapter-outline-toggle-row');
    const reviewButton = toggleRow?.querySelector('.chapter-review-toggle');
    const css = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
    const mobileRule = css.match(/\.story-editor--mobile \.chapter-review-toggle\s*\{[^}]+\}/)?.[0] || '';

    expect(reviewButton?.textContent.trim()).toBe('Chấm điểm');
    expect(mobileRule).toContain('min-height: 34px');
    await act(async () => reviewButton.click());
    expect(onOpenManuscriptReview).toHaveBeenCalledTimes(1);
  });

  it('preserves the original Git toolbar spacing and typography while adding scoring', async () => {
    const onOpenManuscriptReview = vi.fn();
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
      onOpenManuscriptReview,
    });

    const labels = Array.from(container.querySelectorAll('.chapter-outline-toggle-row > button'))
      .map((button) => button.textContent.trim());
    const css = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
    const toolbarRule = css.match(/\.chapter-outline-toggle-row\s*\{[^}]+\}/)?.[0] || '';
    const outlineRule = css.match(/\.chapter-outline-toggle-row\s*>?\s*\.chapter-outline-toggle\s*\{[^}]+\}/)?.[0] || '';
    const originalOutlineRule = css.match(/\.chapter-outline-toggle\s*\{[^}]+\}/)?.[0] || '';
    const historyRule = css.match(/\.chapter-history-toggle\s*\{[^}]+\}/)?.[0] || '';
    const reviewRule = css.match(/\.chapter-review-toggle\s*\{[^}]+\}/)?.[0] || '';
    const mobileToolbarRule = css.match(/\.story-editor--mobile \.chapter-outline-toggle-row\s*\{[^}]+\}/)?.[0] || '';

    expect(labels).toEqual(['Dàn ý', 'Lịch sử thay đổi', 'Chấm điểm']);
    expect(toolbarRule).toContain('display: flex');
    expect(toolbarRule).toContain('justify-content: space-between');
    expect(toolbarRule).toContain('padding-right: var(--space-4)');
    expect(outlineRule).toContain('flex: 1;');
    expect(outlineRule).not.toContain('padding-inline');
    expect(originalOutlineRule).toContain('padding: var(--space-2) var(--space-8)');
    expect(originalOutlineRule).toContain('font-size: var(--text-sm)');
    expect(historyRule).toContain('min-height: 30px');
    expect(historyRule).toContain('padding: 5px 10px');
    expect(historyRule).toContain('font-size: var(--text-xs)');
    expect(reviewRule).toContain('min-height: 30px');
    expect(reviewRule).toContain('padding: 5px 10px');
    expect(reviewRule).toContain('font-size: var(--text-xs)');
    expect(mobileToolbarRule).toContain('padding-right: 8px');
  });

  it('shows an unmistakable live scoring state without enlarging the toolbar', async () => {
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
      onOpenManuscriptReview: vi.fn(),
      manuscriptReviewRunning: true,
    });

    const reviewButton = container.querySelector('.chapter-review-toggle');
    expect(reviewButton?.textContent.trim()).toBe('Đang chấm');
    expect(reviewButton?.getAttribute('aria-busy')).toBe('true');
    expect(reviewButton?.querySelector('.spin')).not.toBeNull();
    expect(reviewButton?.classList).toContain('chapter-review-toggle--running');
  });

  it('opens manuscript scoring in a large desktop dialog that becomes full-screen on phones', () => {
    const source = readFileSync('src/pages/SceneEditor/SceneEditor.jsx', 'utf8');
    const css = readFileSync('src/pages/SceneEditor/SceneEditor.css', 'utf8');
    const desktopRule = css.match(/\.scene-editor-review-dialog\s*\{[^}]+\}/)?.[0] || '';

    expect(source).toContain('scene-editor-review-modal');
    expect(source).toContain('mobileOpen={reviewOpened}');
    expect(desktopRule).toMatch(/min\(960px,\s*calc\(100vw - 48px\)\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.scene-editor-review-dialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/);
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
    expect(container.querySelector('.chapter-speech-trigger')?.getAttribute('aria-label'))
      .toBe('Mở điều khiển nghe chương');
    expect(container.querySelector('.story-editor-header-actions .chapter-speech-control')).toBeNull();
    expect(container.querySelector('.chapter-speech-control')?.classList)
      .toContain('chapter-speech-control--floating');
    expect(container.querySelector('.chapter-speech-control')?.classList)
      .toContain('chapter-speech-control--reader');
    const css = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
    expect(css).toMatch(/\.story-editor-header--reader[^{}]*\.story-editor-header-actions\s*\{[^}]*justify-content:\s*center/isu);
    expect(container.querySelector('.story-editor-detail-trigger')).toBeNull();
    expect(container.querySelector('.chapter-outline-panel')).toBeNull();
    expect(container.querySelector('[data-testid="continuity-bar"]')).toBeNull();
    expect(mocks.projectState.updateScene).not.toHaveBeenCalled();

    await act(async () => switchButtons[0].click());

    expect(onViewModeChange).toHaveBeenCalledWith('scene');
    expect(mocks.projectState.activeSceneId).toBe(101);
  });

  it('keeps the listening icon on the writing page and aligns it to the prose edge on desktop', async () => {
    await renderEditor({
      isMobileLayout: false,
      viewMode: 'scene',
    });

    const speechControl = container.querySelector('.chapter-speech-control');
    const css = readFileSync('src/components/editor/ChapterSpeechControl.css', 'utf8');
    expect(speechControl).not.toBeNull();
    expect(speechControl.classList).toContain('chapter-speech-control--writing');
    expect(css).toMatch(/\.chapter-speech-control--writing\s*\{[^}]*right:\s*max\(24px,\s*calc\(\(100% - 920px\) \/ 2 \+ 24px\)\)/isu);
  });

  it('keeps the phone header compact and renders listening as a separate floating control', async () => {
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
    expect(container.querySelector('.story-editor-header-actions .chapter-speech-control')).toBeNull();
    expect(container.querySelector('.chapter-speech-trigger')?.getAttribute('aria-label'))
      .toBe('Mở điều khiển nghe chương');
    expect(container.querySelector('.story-editor-font-trigger')?.textContent.trim()).toBe('Cỡ chữ');
    expect(container.querySelector('.story-editor-view-switch')).toBeNull();
    expect(container.textContent).not.toContain('Chương 1: Cơn mưa đầu mùa');

    await act(async () => readerActions[0].click());

    expect(onViewModeChange).toHaveBeenCalledWith('scene');
  });

  it('keeps the tablet header compact and renders listening as a separate floating control', async () => {
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
    expect(container.querySelector('.story-editor-header-actions .chapter-speech-control')).toBeNull();
    expect(container.querySelector('.chapter-speech-trigger')?.getAttribute('aria-label'))
      .toBe('Mở điều khiển nghe chương');
    expect(container.querySelector('.story-editor-font-trigger')?.textContent.trim()).toBe('Cỡ chữ');

    await act(async () => readerActions[0].click());

    expect(onOpenChapters).toHaveBeenCalledTimes(1);
  });
});
