/**
 * StoryForge - Prompt Builder v3 (Phase 4)
 *
 * Layer architecture:
 *   0.   Grand Strategy (Phase 9) - macro arc + current arc
 *        Only injected for writing tasks when arc data exists
 *   1.   System Identity
 *   2.   Task Instruction
 *   3.   Genre / AI Guidelines (editable, pre-filled from genre)
 *   4.   Canon Context (world profile, terms, locations, objects, canon facts)
 *   4.2  Chapter Outline (Phase 8) - current chapter brief + next chapter fence
 *        Only injected for writing tasks
 *   4.5  Pacing Control
 *   5.   Character State (characters + pronouns + relationships + taboos)
 *   5.5  Bridge Memory (Phase 7) - prose buffer + previous emotional state
 *        Only injected for writing tasks: CONTINUE, EXPAND, REWRITE, SCENE_DRAFT, ARC_CHAPTER_DRAFT
 *   6.   Scene Contract (goal, conflict, must/must-not, pacing)
 *   7.   Style Pack (placeholder - Phase 5)
 *   8.   Output Format
 */

import { TASK_INSTRUCTIONS } from './promptBuilder/taskInstructions';
import {
  composeTaskInstruction,
  getTaskInstructionProtection,
  stripProtectedTaskInstruction,
} from './promptBuilder/taskInstructionProtection';
import {
  DEFAULT_NSFW_RULES,
  DEFAULT_NSFW_INTIMATE_PROMPT,
  buildNsfwUserAnchor,
} from './promptBuilder/nsfwLayers';
import { DEFAULT_LAYER_1_IDENTITY } from './promptBuilder/systemIdentity';
import { GENRE_CONSTRAINTS } from './promptBuilder/genreConstraints';
import { buildPriorityAnchorLayer } from './promptBuilder/layers';
import { buildPromptSystemParts } from './promptBuilder/systemParts';
import { buildUserContent } from './promptBuilder/userContent';

export {
  TASK_INSTRUCTIONS,
  DEFAULT_NSFW_RULES,
  DEFAULT_NSFW_INTIMATE_PROMPT,
  DEFAULT_LAYER_1_IDENTITY,
  GENRE_CONSTRAINTS,
  composeTaskInstruction,
  getTaskInstructionProtection,
  stripProtectedTaskInstruction,
};

// =============================================
// Main: buildPrompt
// =============================================
export function buildPrompt(taskType, context = {}) {
  const {
    systemParts,
    effectiveMacroArcContract,
    userPrompt,
    skipWritingLayers,
    nsfwMode,
    superNsfwMode,
  } = buildPromptSystemParts(taskType, context);

  let userContent = buildUserContent(taskType, context, effectiveMacroArcContract);

  // -- Layer 9: Priority Anchor --
  // Append at the end of userContent, not systemParts.
  // Double sandwich: Grand Strategy first, Priority Anchor last.
  const priorityAnchor = buildPriorityAnchorLayer(taskType, userPrompt);
  if (priorityAnchor && !skipWritingLayers) {
    userContent += priorityAnchor;
  }

  if (nsfwMode || superNsfwMode) {
    userContent += '\n\n' + buildNsfwUserAnchor();
  }

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userContent },
  ];
}

export default { buildPrompt };
