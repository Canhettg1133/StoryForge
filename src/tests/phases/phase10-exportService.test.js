import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveAs: vi.fn(),
  projectGet: vi.fn(),
  chapters: [],
  scenesByChapter: new Map(),
}));

vi.mock('file-saver', () => ({
  saveAs: mocks.saveAs,
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: {
      get: mocks.projectGet,
    },
    chapters: {
      where: () => ({
        equals: () => ({
          sortBy: async () => mocks.chapters,
        }),
      }),
    },
    scenes: {
      where: () => ({
        equals: (chapterId) => ({
          sortBy: async () => mocks.scenesByChapter.get(chapterId) || [],
        }),
      }),
    },
  },
}));

describe('phase10 story export service', () => {
  beforeEach(() => {
    mocks.saveAs.mockReset();
    mocks.projectGet.mockReset();
    mocks.chapters = [];
    mocks.scenesByChapter = new Map();
  });

  it('exports TXT chapter headings without duplicated chapter labels or leading markdown headings', async () => {
    const { exportToTxt } = await import('../../utils/exportService.js');

    mocks.projectGet.mockResolvedValue({ id: 1, title: 'Truyen thu' });
    mocks.chapters = [
      { id: 10, project_id: 1, order_index: 0, title: 'Chương 1' },
      { id: 11, project_id: 1, order_index: 1, title: 'Chương 2: Những gì còn lại' },
    ];
    mocks.scenesByChapter.set(10, [
      { draft_text: '<p># Chương 1: Mùi của quỷ dữ</p><p>Mở đầu.</p>' },
    ]);
    mocks.scenesByChapter.set(11, [
      { draft_text: '<p># Chương 2: Những gì còn lại</p><p>Sau cơn mưa.</p>' },
    ]);

    await exportToTxt(1);

    const [blob, filename] = mocks.saveAs.mock.calls[0];
    const text = await blob.text();

    expect(filename).toBe('Truyen thu-storyforge.txt');
    expect(text).toContain('Chương 1: Mùi của quỷ dữ\n-\n\nMở đầu.');
    expect(text).toContain('Chương 2: Những gì còn lại\n-\n\nSau cơn mưa.');
    expect(text).not.toContain('Chương 1: Chương 1');
    expect(text).not.toContain('Chương 2: Chương 2');
    expect(text).not.toContain('# Chương 2: Những gì còn lại');
  });

  it('builds cleaned chapter export data shared by TXT and DOCX exports', async () => {
    const { buildChapterExportSection } = await import('../../utils/exportService.js');

    expect(buildChapterExportSection({
      chapterTitle: 'Chương 2: Chương 2: Những gì còn lại',
      scenes: ['<p># Chương 2: Những gì còn lại</p><p>Phần thân.</p>'],
    }, 1)).toEqual({
      chapterHeading: 'Chương 2: Những gì còn lại',
      sceneTexts: ['Phần thân.'],
    });
  });
});
