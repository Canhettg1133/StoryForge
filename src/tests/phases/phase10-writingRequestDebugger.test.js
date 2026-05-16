import { describe, expect, it } from 'vitest';
import appSource from '../../App.jsx?raw';
import sidebarSource from '../../components/common/Sidebar.jsx?raw';
import dashboardSource from '../../pages/Dashboard/Dashboard.jsx?raw';
import sceneEditorSource from '../../pages/SceneEditor/SceneEditor.jsx?raw';
import {
  buildWritingDebugBaseContext,
  getWritingDebugTaskConfig,
  prepareWritingDebugContext,
  WRITING_DEBUG_TASKS,
} from '../../services/ai/writingRequestDebugger';
import { TASK_TYPES } from '../../services/ai/router';
import {
  detectChapterPromptMismatch,
  extractRequestedChapterNumbers,
} from '../../services/ai/chapterPromptGuard';

describe('phase10 Writing Request Debugger', () => {
  it('exposes the same core writer task modes as the editor AI panel', () => {
    expect(WRITING_DEBUG_TASKS.map((task) => task.id)).toEqual([
      'free_prompt',
      'continue',
      'rewrite',
      'expand',
    ]);
    expect(getWritingDebugTaskConfig('free_prompt').taskType).toBe(TASK_TYPES.FREE_PROMPT);
    expect(getWritingDebugTaskConfig('continue').taskType).toBe(TASK_TYPES.CONTINUE);
    expect(getWritingDebugTaskConfig('rewrite').taskType).toBe(TASK_TYPES.REWRITE);
    expect(getWritingDebugTaskConfig('expand').taskType).toBe(TASK_TYPES.EXPAND);
  });

  it('builds the same base context shape used by the editor free prompt flow', () => {
    const context = buildWritingDebugBaseContext({
      project: { id: 7, title: 'Dự án test', genre_primary: 'fantasy' },
      chapters: [
        { id: 1, title: 'Chương 1' },
        { id: 2, title: 'Chương 2' },
      ],
      scenes: [
        { id: 22, chapter_id: 2, order_index: 1, title: 'Cảnh B', draft_text: '<p>B sau</p>' },
        { id: 21, chapter_id: 2, order_index: 0, title: 'Cảnh A', draft_text: '<p>A&nbsp;trước</p>' },
      ],
      chapterId: 2,
      sceneId: 21,
      selectedText: '<strong>Đoạn chọn</strong>',
      userPrompt: 'Viết tiếp theo dàn ý.',
    });

    expect(context).toMatchObject({
      projectId: 7,
      chapterId: 2,
      sceneId: 21,
      chapterIndex: 1,
      projectTitle: 'Dự án test',
      genre: 'fantasy',
      chapterTitle: 'Chương 2',
      sceneTitle: 'Cảnh A',
      selectedText: 'Đoạn chọn',
      sceneText: 'A trước',
      userPrompt: 'Viết tiếp theo dàn ý.',
      chapterSceneCount: 2,
    });
    expect(context.chapterText).toBe('A trước\n\nB sau');
  });

  it('falls back to scene text for rewrite/expand and sets bridge tail for continue', () => {
    const rewriteContext = prepareWritingDebugContext(TASK_TYPES.REWRITE, {
      selectedText: '',
      sceneText: 'Toàn bộ cảnh cần viết lại.',
    });
    const expandContext = prepareWritingDebugContext(TASK_TYPES.EXPAND, {
      selectedText: '',
      sceneText: 'Toàn bộ cảnh cần mở rộng.',
    });
    const continueContext = prepareWritingDebugContext(TASK_TYPES.CONTINUE, {
      sceneText: Array.from({ length: 180 }, (_item, index) => `từ${index}`).join(' '),
    });

    expect(rewriteContext.selectedText).toBe('Toàn bộ cảnh cần viết lại.');
    expect(expandContext.selectedText).toBe('Toàn bộ cảnh cần mở rộng.');
    expect(continueContext.bridgeBuffer.split(' ')).toHaveLength(150);
    expect(continueContext.bridgeBuffer).toContain('từ179');
  });

  it('detects when a free writing prompt targets a different explicit chapter', () => {
    expect(extractRequestedChapterNumbers('Viet Chuong 10: Loi canh bao')).toEqual([10]);
    expect(extractRequestedChapterNumbers('Tang 5000 tu, khong nhac so chuong')).toEqual([]);

    const mismatch = detectChapterPromptMismatch({
      userPrompt: 'Viet chuong 10: Lam Phong dot pha Truc Co.',
      chapterTitle: 'Chuong 1: Thieu Nien Voi Co Ngoc',
      chapterIndex: 0,
    });

    expect(mismatch).toMatchObject({
      code: 'chapter_prompt_mismatch',
      requestedChapterNumber: 10,
      currentChapterNumber: 1,
    });
    expect(detectChapterPromptMismatch({
      userPrompt: 'Viet chuong 10: Lam Phong dot pha Truc Co.',
      chapterTitle: 'Chuong 10: Loi Canh Bao',
      chapterIndex: 9,
    })).toBeNull();
  });

  it('detects when a copied outline prompt matches another chapter without naming it', () => {
    const chapters = [
      {
        id: 342,
        order_index: 0,
        title: 'Chuong 1: Thieu Nien Voi Co Ngoc',
        summary: 'Lam Phong gap kho khan trong Luyen Khi va duoc Tran Lao Quai dua len Thanh Van Tong.',
        purpose: 'Gioi thieu Lam Phong va co ngoc.',
      },
      {
        id: 351,
        order_index: 9,
        title: 'Chuong 10: Loi Canh Bao',
        summary: 'Voi su tro giup cua Lieu Uyen va no luc cua ban than, Lam Phong cuoi cung cung dot pha len canh gioi Truc Co, gay chan dong nho trong Thanh Van Tong.',
        purpose: 'Lam Phong dot pha canh gioi, nhung cung doi mat voi mot loi canh bao truc tiep ve so phan.',
      },
    ];

    const mismatch = detectChapterPromptMismatch({
      userPrompt: 'Tom tat\nVoi su tro giup cua Lieu Uyen va no luc cua ban than, Lam Phong cuoi cung cung dot pha len canh gioi Truc Co, gay chan dong nho trong Thanh Van Tong.\n\nMuc tieu\nLam Phong dot pha canh gioi, nhung cung doi mat voi mot loi canh bao truc tiep ve so phan.',
      chapterId: 342,
      chapterTitle: 'Chuong 1: Thieu Nien Voi Co Ngoc',
      chapterIndex: 0,
    }, { chapters });

    expect(mismatch).toMatchObject({
      code: 'chapter_prompt_mismatch',
      requestedChapterNumber: 10,
      currentChapterNumber: 1,
      matchedBy: 'outline_content',
    });

    expect(detectChapterPromptMismatch({
      userPrompt: 'Tom tat\nVoi su tro giup cua Lieu Uyen va no luc cua ban than, Lam Phong cuoi cung cung dot pha len canh gioi Truc Co, gay chan dong nho trong Thanh Van Tong.',
      chapterId: 351,
      chapterTitle: 'Chuong 10: Loi Canh Bao',
      chapterIndex: 9,
    }, { chapters })).toBeNull();
  });

  it('registers the debugger route and navigation entries', () => {
    expect(appSource).toContain('WritingRequestDebugger');
    expect(appSource).toContain('path="writing-debug"');
    expect(sidebarSource).toContain("id: 'writing-debug'");
    expect(sidebarSource).toContain("label: 'Test prompt viết'");
    expect(dashboardSource).toContain("id: 'writing-debug'");
    expect(dashboardSource).toContain("title: 'Test prompt viết'");
    expect(sceneEditorSource).toContain("id: 'writing-debug'");
  });
});
