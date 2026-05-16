import { buildPrompt } from './promptBuilder';
import { TASK_TYPES } from './router';
import { gatherContext } from './contextEngine';
import { detectChapterPromptMismatch } from './chapterPromptGuard';

export const WRITING_DEBUG_TASKS = [
  {
    id: 'free_prompt',
    taskType: TASK_TYPES.FREE_PROMPT,
    label: 'Yêu cầu tự do',
    description: 'Giống ô nhập yêu cầu tự do trong panel viết truyện.',
    requiresUserPrompt: true,
    requiresSceneText: false,
    requiresSelection: false,
  },
  {
    id: 'continue',
    taskType: TASK_TYPES.CONTINUE,
    label: 'Viết tiếp',
    description: 'Giống nút Viết tiếp, dùng đoạn hiện tại làm điểm nối.',
    requiresUserPrompt: false,
    requiresSceneText: true,
    requiresSelection: false,
  },
  {
    id: 'rewrite',
    taskType: TASK_TYPES.REWRITE,
    label: 'Viết lại',
    description: 'Giống nút Viết lại. Nếu không có đoạn chọn, dùng toàn bộ cảnh.',
    requiresUserPrompt: false,
    requiresSceneText: false,
    requiresSelection: true,
  },
  {
    id: 'expand',
    taskType: TASK_TYPES.EXPAND,
    label: 'Mở rộng',
    description: 'Giống nút Mở rộng. Nếu không có đoạn chọn, dùng toàn bộ cảnh.',
    requiresUserPrompt: false,
    requiresSceneText: false,
    requiresSelection: true,
  },
];

export function getWritingDebugTaskConfig(taskId = 'free_prompt') {
  return WRITING_DEBUG_TASKS.find((task) => task.id === taskId || task.taskType === taskId)
    || WRITING_DEBUG_TASKS[0];
}

export function stripHtmlToPlainText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractTextTail(rawText, wordLimit = 150) {
  const plainText = stripHtmlToPlainText(rawText).replace(/\s+/g, ' ').trim();
  if (!plainText) return '';
  const words = plainText.split(' ').filter(Boolean);
  return words.slice(-wordLimit).join(' ');
}

function findById(items = [], id) {
  if (!id) return null;
  return items.find((item) => String(item?.id) === String(id)) || null;
}

export function buildWritingDebugBaseContext({
  project = null,
  chapters = [],
  scenes = [],
  chapterId = null,
  sceneId = null,
  selectedText = '',
  userPrompt = '',
} = {}) {
  const activeChapter = findById(chapters, chapterId) || chapters[0] || null;
  const activeScene = findById(scenes, sceneId)
    || scenes.find((scene) => String(scene?.chapter_id) === String(activeChapter?.id))
    || null;
  const activeChapterId = activeChapter?.id || null;
  const activeSceneId = activeScene?.id || null;
  const chapterScenes = scenes
    .filter((scene) => String(scene?.chapter_id) === String(activeChapterId))
    .slice()
    .sort((left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0));
  const chapterText = chapterScenes
    .map((scene) => scene?.draft_text || scene?.final_text || '')
    .map(stripHtmlToPlainText)
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const chapterIndex = Math.max(0, chapters.findIndex((chapter) => String(chapter?.id) === String(activeChapterId)));

  return {
    selectedText: stripHtmlToPlainText(selectedText),
    sceneText: stripHtmlToPlainText(activeScene?.draft_text || activeScene?.final_text || ''),
    sceneTitle: activeScene?.title || '',
    chapterTitle: activeChapter?.title || '',
    projectTitle: project?.title || '',
    genre: project?.genre_primary || '',
    projectId: project?.id || null,
    chapterId: activeChapterId,
    sceneId: activeSceneId,
    chapterIndex,
    chapterText,
    chapterSceneCount: chapterScenes.length,
    userPrompt: String(userPrompt || '').trim(),
  };
}

export function prepareWritingDebugContext(taskType, baseContext = {}) {
  const context = { ...baseContext };

  if ([TASK_TYPES.REWRITE, TASK_TYPES.EXPAND].includes(taskType) && !context.selectedText) {
    context.selectedText = context.sceneText;
  }

  if (taskType === TASK_TYPES.CONTINUE) {
    const liveSceneTail = extractTextTail(context.sceneText || '', 150);
    if (liveSceneTail) {
      context.bridgeBuffer = liveSceneTail;
    }
  }

  return context;
}

export async function buildWritingDebugPayload({
  taskId = 'free_prompt',
  project = null,
  chapters = [],
  scenes = [],
  chapterId = null,
  sceneId = null,
  selectedText = '',
  userPrompt = '',
  retrievalMode = '',
} = {}) {
  const taskConfig = getWritingDebugTaskConfig(taskId);
  const baseContext = buildWritingDebugBaseContext({
    project,
    chapters,
    scenes,
    chapterId,
    sceneId,
    selectedText,
    userPrompt,
  });
  let enrichedContext = { ...baseContext };
  const warnings = [];

  if (taskConfig.requiresUserPrompt && !baseContext.userPrompt) {
    warnings.push('Yêu cầu tự do đang trống.');
  }
  if (taskConfig.requiresSceneText && !baseContext.sceneText) {
    warnings.push('Cảnh hiện tại chưa có nội dung để viết tiếp.');
  }
  if (taskConfig.requiresSelection && !baseContext.selectedText && !baseContext.sceneText) {
    warnings.push('Chưa có đoạn chọn hoặc nội dung cảnh để viết lại/mở rộng.');
  }

  if (baseContext.projectId) {
    const memoryContext = await gatherContext({
      projectId: baseContext.projectId,
      chapterId: baseContext.chapterId,
      chapterIndex: baseContext.chapterIndex || 0,
      sceneId: baseContext.sceneId || null,
      sceneText: baseContext.sceneText || '',
      genre: baseContext.genre || '',
      taskType: taskConfig.taskType,
      retrievalMode,
      userPrompt: baseContext.userPrompt || '',
    });
    enrichedContext = {
      ...memoryContext,
      ...baseContext,
    };
  }

  enrichedContext = prepareWritingDebugContext(taskConfig.taskType, enrichedContext);
  const blockingIssues = [];
  const chapterMismatch = detectChapterPromptMismatch(enrichedContext, { chapters });
  if (chapterMismatch) {
    blockingIssues.push(chapterMismatch);
    warnings.push(chapterMismatch.message);
  }
  const messages = buildPrompt(taskConfig.taskType, enrichedContext);
  const systemPrompt = messages.find((message) => message.role === 'system')?.content || '';
  const userContent = messages.find((message) => message.role === 'user')?.content || '';

  return {
    taskConfig,
    taskType: taskConfig.taskType,
    baseContext,
    enrichedContext,
    messages,
    systemPrompt,
    userContent,
    warnings,
    blockingIssues,
    summary: {
      messageCount: messages.length,
      systemChars: systemPrompt.length,
      userChars: userContent.length,
      contextKeys: Object.keys(enrichedContext).sort(),
      hasProjectStyleRuntime: systemPrompt.includes('[PROJECT STYLE - BẮT BUỘC]'),
      hasPromptTask: systemPrompt.includes('[NHIEM VU]'),
      hasCanonEngine: systemPrompt.includes('[CANON ENGINE]'),
      hasBridgeMemory: systemPrompt.includes('[BO NHO') || systemPrompt.includes('[BRIDGE MEMORY'),
      hasBlockingIssues: blockingIssues.length > 0,
    },
  };
}
