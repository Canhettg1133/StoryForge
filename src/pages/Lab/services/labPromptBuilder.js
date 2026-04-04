/**
 * StoryForge — Lab Prompt Builder
 * Delegated wrapper around the main promptBuilder.
 * NarrativeLab is a sandbox that needs the core system prompt layers
 * (Author DNA, Style DNA, Grand Strategy, NSFW overrides) but injects
 * its own conversation history and ENI priming — keeping those concerns
 * isolated from the main writing-editor prompt builder.
 */
import { buildPrompt as buildMainPrompt } from '../../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../../services/ai/router';

// Lab task types — currently maps all to FREE_PROMPT (Lab is a sandbox)
export const LAB_TASK_TYPES = {
  CONTINUE: TASK_TYPES.CONTINUE,
  FREE_PROMPT: TASK_TYPES.FREE_PROMPT,
};

/**
 * Build a prompt for Narrative Lab.
 * Delegates to the main buildPrompt, then injects Lab-specific context:
 * - ENI priming history (if superNsfwMode + eniSessionHistory)
 * - Lab conversation history (last 10 messages)
 */
export function buildLabPrompt(taskType, context = {}) {
  const {
    userPrompt = 'Bắt đầu viết.',
    nsfwMode = false,
    superNsfwMode = false,
    genre = 'fantasy',
    writingStyle = 'thuan_viet',
    eniSessionHistory = [],
    labConversationHistory = [],  // array of {role, content} from labStore.messages
    ...rest
  } = context;

  // Delegate to main promptBuilder with Lab's context
  const messages = buildMainPrompt(taskType, {
    ...rest,
    userPrompt,
    nsfwMode,
    superNsfwMode,
    genre,
    writingStyle,
  });

  // Inject ENI priming history after system message
  if (superNsfwMode && eniSessionHistory.length > 0) {
    if (messages[0]?.role === 'system') {
      messages.splice(1, 0, ...eniSessionHistory);
    } else {
      messages.unshift(...eniSessionHistory);
    }
  }

  // Inject Lab conversation history: prepend last 10 turns before the current user prompt
  // Find the last user message in messages (usually the last entry)
  if (labConversationHistory.length > 0) {
    const lastIdx = messages.length - 1;
    messages.splice(lastIdx, 0, ...labConversationHistory.slice(-10));
  }

  return messages;
}

export default { buildLabPrompt };
