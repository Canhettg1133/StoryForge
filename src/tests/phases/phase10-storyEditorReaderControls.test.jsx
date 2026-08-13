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
      'Dàn ý chương',
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
