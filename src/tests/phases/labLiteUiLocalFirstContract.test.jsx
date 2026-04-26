import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LabLite from '../../pages/Lab/LabLite/LabLite.jsx';
import useLabLiteStore from '../../stores/labLiteStore.js';
import {
  bulkSaveChapterCoverage,
  getLabLiteCorpusBundle,
  labLiteDb,
  saveParsedCorpus,
  saveScoutResult,
} from '../../services/labLite/labLiteDb.js';
import {
  flushPromises,
  makeLabLiteChapters,
  makeParsedCorpus,
  resetLabLiteDb,
} from '../helpers/labLiteTestUtils.js';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }) => {
    const size = Number(estimateSize?.() || 88);
    const visibleCount = Math.min(Number(count || 0), 12);
    return {
      getTotalSize: () => Number(count || 0) * size,
      getVirtualItems: () => Array.from({ length: visibleCount }, (_item, index) => ({
        index,
        key: index,
        start: index * size,
        size,
      })),
    };
  },
}));

vi.mock('../../stores/projectStore.js', () => ({
  default: (selector) => selector({
    currentProject: null,
    updateProjectSettings: vi.fn(),
    createProject: vi.fn(),
  }),
}));

function installElementSizing() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const height = this.classList?.contains('lab-lite-virtual-list') ? 720 : 800;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: height,
      width: 1000,
      height,
      toJSON: () => {},
    };
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 720 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

async function renderLabLite({ route = '/', path = '*' } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={<LabLite />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await flushPromises();
  await flushPromises();
  return { container, root };
}

describe('Lab Lite UI local-first contract', () => {
  let restoreSizing = null;

  beforeEach(async () => {
    restoreSizing = installElementSizing();
    await resetLabLiteDb(labLiteDb);
    useLabLiteStore.setState(useLabLiteStore.getInitialState(), true);
  });

  afterEach(async () => {
    restoreSizing?.();
    document.body.innerHTML = '';
    useLabLiteStore.setState(useLabLiteStore.getInitialState(), true);
    await labLiteDb.delete();
    vi.clearAllMocks();
  });

  it('renders a 2000 chapter corpus with virtualized chapter DOM and visible coverage/mode controls', async () => {
    await saveParsedCorpus(makeParsedCorpus({
      id: 'corpus_ui_large',
      chapterCount: 2000,
      chapters: makeLabLiteChapters(2000, { corpusId: 'corpus_ui_large' }),
    }));
    await saveScoutResult({
      corpusId: 'corpus_ui_large',
      goal: 'story_bible',
      chapterIndex: 1,
      status: 'complete',
      recommendation: 'deep_load',
      priority: 'high',
      reason: 'Có reveal quan trọng.',
      detectedSignals: ['reveal'],
    });
    await bulkSaveChapterCoverage([
      { corpusId: 'corpus_ui_large', chapterIndex: 1, localDone: true, scoutDone: true, digestDone: true, deepDone: true },
      { corpusId: 'corpus_ui_large', chapterIndex: 2, localDone: true, scoutSynthetic: true },
      { corpusId: 'corpus_ui_large', chapterIndex: 3, localDone: true, status: 'error', failedReason: 'Bad JSON' },
    ]);

    const { container, root } = await renderLabLite();
    const text = container.textContent;
    const renderedChapterButtons = container.querySelectorAll('.lab-lite-chapter-item');

    expect(container.querySelector('.lab-lite-virtual-list')).toBeTruthy();
    expect(container.querySelector('.lab-lite-virtual-row')).toBeTruthy();
    expect(renderedChapterButtons.length).toBeGreaterThan(0);
    expect(renderedChapterButtons.length).toBeLessThan(2000);
    expect(text).toContain('Phân tích nhanh');
    expect(text).toContain('Phân tích đầy đủ');
    expect(text).toContain('Phân tích sâu');
    expect(text).toContain('Preset đang chọn: Phân tích nhanh');
    expect(text).toContain('Kiểm tra sau khi nạp');
    expect(text).toContain('Scout thật1/2,000');
    expect(text).toContain('Fallback1');
    expect(text).toContain('Digest1');
    expect(text).toContain('Deep1');
    expect(text).toContain('Thiếu1,998');
    expect(text).toContain('Lỗi1');
    expect(text).toContain('Tìm chương');
    expect(text).toContain('Nhảy tới');
    expect(text).toContain('Nạp sâu');
    expect(text).not.toContain('deep_load');

    await act(async () => root.unmount());
  });

  it('does not show a different project corpus on a new project route', async () => {
    await saveParsedCorpus({
      ...makeParsedCorpus({
        id: 'corpus_project_a_ui',
        title: 'Dữ liệu của dự án A',
        chapterCount: 2,
      }),
      projectId: 'project_a',
    });

    const { container, root } = await renderLabLite({
      route: '/project/project_b/lab-lite',
      path: '/project/:projectId/lab-lite',
    });

    expect(container.textContent).toContain('Chưa có dữ liệu Lab Lite cho dự án này.');
    expect(container.textContent).not.toContain('Dữ liệu của dự án A');
    expect(container.querySelectorAll('.lab-lite-chapter-item')).toHaveLength(0);
    expect(useLabLiteStore.getState()).toEqual(expect.objectContaining({
      activeProjectId: 'project_b',
      currentCorpusId: null,
      chapters: [],
    }));

    await act(async () => root.unmount());
  });

  it('lazy-loads selected chapter content from Dexie even when chapter metadata has no content', async () => {
    await saveParsedCorpus(makeParsedCorpus({
      id: 'corpus_ui_lazy',
      chapters: [
        {
          title: 'Chương 1: Mở',
          content: 'Nội dung chương một có nhân vật Linh.',
          wordCount: 8,
          estimatedTokens: 20,
        },
        {
          title: 'Chương 2: Chuyển',
          content: 'Nội dung chương hai có Minh và chiếc ấn cổ.',
          wordCount: 10,
          estimatedTokens: 24,
        },
      ],
    }));

    const { container, root } = await renderLabLite();
    expect(container.textContent).toContain('Nội dung chương một có nhân vật Linh.');
    expect(useLabLiteStore.getState().chapters.every((chapter) => !Object.hasOwn(chapter, 'content'))).toBe(true);

    const secondButton = [...container.querySelectorAll('.lab-lite-chapter-item')]
      .find((button) => button.textContent.includes('Chương 2'));
    await act(async () => {
      secondButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(container.textContent).toContain('Nội dung chương hai có Minh và chiếc ấn cổ.');
    await act(async () => root.unmount());
  });

  it('shows a destructive delete action for imported Lab Lite data and removes it after confirmation', async () => {
    await saveParsedCorpus(makeParsedCorpus({
      id: 'corpus_ui_delete',
      title: 'Bộ dữ liệu cần xóa',
      chapterCount: 2,
    }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { container, root } = await renderLabLite();
    const deleteButton = container.querySelector('[aria-label="Xóa dữ liệu Lab Lite Bộ dữ liệu cần xóa"]');

    expect(deleteButton).toBeTruthy();
    expect(container.textContent).toContain('Bộ dữ liệu cần xóa');

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });
    for (let index = 0; index < 8 && container.textContent.includes('Bộ dữ liệu cần xóa'); index += 1) {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    }

    const bundle = await getLabLiteCorpusBundle('corpus_ui_delete');
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Xóa vĩnh viễn dữ liệu Lab Lite'));
    expect(bundle.corpus).toBeNull();
    expect(container.textContent).toContain('Chưa có bộ dữ liệu nào.');
    expect(container.textContent).not.toContain('Bộ dữ liệu cần xóa');

    confirmSpy.mockRestore();
    await act(async () => root.unmount());
  });

  it('truncates long preview content until the user explicitly expands it', async () => {
    const longContent = [
      'Mở đầu chương dài với tiếng Việt có dấu.',
      'x'.repeat(13_000),
      'KẾT THÚC ĐẦY ĐỦ SAU KHI MỞ RỘNG.',
    ].join('\n');
    await saveParsedCorpus(makeParsedCorpus({
      id: 'corpus_ui_long',
      chapters: [{
        title: 'Chương dài',
        content: longContent,
        wordCount: 2000,
        estimatedTokens: 3000,
      }],
    }));

    const { container, root } = await renderLabLite();

    expect(container.textContent).toContain('Đã rút gọn phần xem trước');
    expect(container.textContent).toContain('Hiện toàn bộ');
    expect(container.textContent).not.toContain('KẾT THÚC ĐẦY ĐỦ SAU KHI MỞ RỘNG.');

    const toggle = container.querySelector('.lab-lite-preview-toggle');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(container.textContent).toContain('KẾT THÚC ĐẦY ĐỦ SAU KHI MỞ RỘNG.');
    expect(container.textContent).toContain('Thu gọn xem trước');
    await act(async () => root.unmount());
  });
});
