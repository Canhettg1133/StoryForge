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
