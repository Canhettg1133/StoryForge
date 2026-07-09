import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';

describe('scratch same-chapter scene continuity repro', () => {
  it('prints whether writing prompts include previous scene prose from chapterText', () => {
    const context = {
      projectId: 1,
      chapterId: 10,
      sceneId: 102,
      sceneTitle: 'Scene 2',
      chapterTitle: 'Chapter 1',
      sceneText: 'SCENE_2_CURRENT: Minh wakes up in the archive.',
      chapterText: [
        'SCENE_1_PREVIOUS: Lan hides the silver key.',
        'SCENE_2_CURRENT: Minh wakes up in the archive.',
      ].join('\n\n'),
      chapterSceneCount: 2,
      userPrompt: 'Continue the next beat without forgetting prior scene.',
    };

    for (const taskType of [
      TASK_TYPES.CONTINUE,
      TASK_TYPES.FREE_PROMPT,
      TASK_TYPES.PLOT_SUGGEST,
      TASK_TYPES.OUTLINE,
    ]) {
      const messages = buildPrompt(taskType, context);
      const combined = messages.map((message) => message.content).join('\n---MSG---\n');
      console.log(JSON.stringify({
        taskType,
        hasPreviousSceneText: combined.includes('SCENE_1_PREVIOUS'),
        hasCurrentSceneText: combined.includes('SCENE_2_CURRENT'),
        userContentStart: messages[1].content.slice(0, 180),
      }));
    }

    expect(true).toBe(true);
  });
});
