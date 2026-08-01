import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockedProjectStoreState = {};
let mockedCodexStoreState = {};
let mockedCanonStoreState = {};

vi.mock('../../stores/projectStore', () => ({
  default: () => mockedProjectStoreState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => mockedCodexStoreState,
}));

vi.mock('../../stores/canonStore', () => ({
  default: () => mockedCanonStoreState,
}));

async function loadContinuityBar() {
  vi.resetModules();
  const module = await import('../../components/editor/ContinuityBar.jsx');
  return module.default;
}

function setStoreState({
  chapterStatus = 'draft',
  canonStatus = 'draft',
  canonIsFresh = false,
  committedCount = 0,
  filteredCount = 0,
  runChapterCompletion = vi.fn().mockResolvedValue({ ok: true, kind: 'success' }),
} = {}) {
  mockedProjectStoreState = {
    chapters: [
      {
        id: 11,
        project_id: 1,
        title: 'Chương 1',
        status: chapterStatus,
      },
    ],
    scenes: [],
    activeChapterId: 11,
    activeSceneId: 101,
    currentProject: { id: 1, title: 'Truyện test' },
    completingChapterId: null,
    chapterCompletionById: {},
    runChapterCompletion,
    updateScene: vi.fn(),
  };
  mockedCodexStoreState = {
    chapterMetas: [],
    loadCodex: vi.fn(),
  };
  mockedCanonStoreState = {
    chapterCanon: {
      status: canonStatus,
      isFresh: canonIsFresh,
      isStale: false,
      reports: [],
      errorCount: 0,
      warningCount: 0,
      committedCount,
      filteredCount,
    },
    loadChapterCanon: vi.fn(),
    canonicalizeChapter: vi.fn(),
    rebuildCanonFromChapter: vi.fn(),
    canonicalizing: false,
    rebuilding: false,
    repairPreview: null,
    repairChapterRevision: vi.fn(),
    saveRepairDraftRevision: vi.fn(),
    savingRepairDraft: false,
    lastActionOutcome: null,
    clearRepairText: vi.fn(),
    clearActionOutcome: vi.fn(),
  };

  return {
    runChapterCompletion,
    loadCodex: mockedCodexStoreState.loadCodex,
    loadChapterCanon: mockedCanonStoreState.loadChapterCanon,
  };
}

describe('phase10 continuity bar completion shortcut', () => {
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

  it('shows the desktop completion action next to the unanalyzed canon state', async () => {
    const ContinuityBar = await loadContinuityBar();
    const { runChapterCompletion, loadCodex, loadChapterCanon } = setStoreState({
      runChapterCompletion: vi.fn().mockResolvedValue({
        ok: true,
        kind: 'success',
        message: 'Đã hoàn thành chương và áp dụng 2 thay đổi canon.',
      }),
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    expect(container.textContent).toContain('Hoàn thành chương');
    expect(container.textContent).toContain('Chưa phân tích');

    const completeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Hoàn thành chương'));

    expect(completeButton).toBeTruthy();
    expect(completeButton.classList.contains('continuity-bar-status--completion')).toBe(true);
    expect(completeButton.classList.contains('continuity-bar-btn--success')).toBe(false);

    await act(async () => {
      completeButton.click();
    });

    expect(runChapterCompletion).toHaveBeenCalledWith(11, { mode: 'manual' });
    expect(loadChapterCanon).toHaveBeenCalledWith(1, 11, 101);
    expect(loadCodex).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('áp dụng 2 thay đổi canon');
  });

  it('does not render the desktop rebuild button', async () => {
    const ContinuityBar = await loadContinuityBar();
    setStoreState({ canonStatus: 'canonical', canonIsFresh: true });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    expect(container.textContent).not.toContain('Rebuild');
    expect(container.querySelector('.continuity-bar-btn--rebuild')).toBeNull();
  });

  it('keeps the desktop completion action visible after canon analysis when the chapter is not done', async () => {
    const ContinuityBar = await loadContinuityBar();
    setStoreState({ canonStatus: 'canonical', canonIsFresh: true });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    expect(container.textContent).toContain('Hoàn thành chương');
    expect(container.textContent).toContain('Đã phân tích');

    const completeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Hoàn thành chương'));

    expect(completeButton).toBeTruthy();
    expect(completeButton.classList.contains('continuity-bar-btn--success')).toBe(false);
  });

  it('shows completed chapter state separately from analyzed canon state', async () => {
    const ContinuityBar = await loadContinuityBar();
    setStoreState({
      chapterStatus: 'done',
      canonStatus: 'canonical',
      canonIsFresh: true,
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    expect(container.textContent).toContain('Đã hoàn thành');
    expect(container.textContent).toContain('Đã phân tích');
    expect(container.textContent).not.toContain('Hoàn thành chương');
    expect(container.querySelector('.continuity-bar-status--completed')).not.toBeNull();
  });

  it('keeps detailed canon counts in change history instead of the crowded status row', async () => {
    const ContinuityBar = await loadContinuityBar();
    setStoreState({
      chapterStatus: 'done',
      canonStatus: 'canonical',
      canonIsFresh: true,
      committedCount: 1,
      filteredCount: 6,
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    expect(container.textContent).toContain('Đã phân tích');
    expect(container.textContent).not.toContain('1 thay đổi');
    expect(container.textContent).not.toContain('6 lọc');
  });

  it('uses the chapter title as the desktop row label without redundant leading content', async () => {
    const ContinuityBar = await loadContinuityBar();
    setStoreState({
      chapterStatus: 'done',
      canonStatus: 'canonical',
      canonIsFresh: true,
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<ContinuityBar isMobileLayout={false} />);
    });

    const currentRow = container.querySelector('.continuity-bar-current');
    const title = currentRow?.querySelector('.continuity-bar-title');

    expect(currentRow?.getAttribute('aria-label')).toBe('Chương hiện tại');
    expect(currentRow?.querySelector('.continuity-bar-label')).toBeNull();
    expect(currentRow?.firstElementChild).toBe(title);
    expect(title?.textContent).toBe(mockedProjectStoreState.chapters[0].title);
  });

  it('styles the desktop completion shortcut as an action instead of success state', () => {
    const css = readFileSync('src/components/editor/ContinuityBar.css', 'utf8');
    const completionRule = css.match(/\.continuity-bar-status--completion\s*\{[^}]+\}/)?.[0] || '';

    expect(completionRule).toContain('var(--color-accent)');
    expect(completionRule).not.toContain('var(--color-success)');
  });

  it('keeps the desktop chapter status row on one line and truncates only the title', () => {
    const css = readFileSync('src/components/editor/ContinuityBar.css', 'utf8');
    const currentRowRule = css.match(/\.continuity-bar-current\s*\{[^}]+\}/)?.[0] || '';
    const currentTitleRule = css.match(/\.continuity-bar-current \.continuity-bar-title\s*\{[^}]+\}/)?.[0] || '';

    expect(currentRowRule).toContain('flex-wrap: nowrap');
    expect(currentRowRule).toContain('overflow: hidden');
    expect(currentTitleRule).toContain('flex: 1 1 auto');
    expect(currentTitleRule).toContain('min-width: 0');
  });
});
