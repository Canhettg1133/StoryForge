import { describe, expect, it } from 'vitest';

import { TASK_TYPES } from '../../services/ai/router';
import { GLOBAL_PROMPT_META, PROJECT_PROMPT_GROUPS } from '../../services/ai/promptManagerMeta';

describe('phase10 prompt manager meta', () => {
  it('surfaces NSFW prompts as a dedicated toolbar group instead of hiding them inside writing DNA', () => {
    const nsfwGroup = PROJECT_PROMPT_GROUPS.find((group) => group.key === 'nsfw');
    expect(nsfwGroup).toBeTruthy();
    expect(nsfwGroup.title).toBe('NSFW và ENI');

    expect(nsfwGroup.items.map((item) => item.key)).toEqual([
      'nsfw_system_prompt',
      'nsfw_rules',
      'nsfw_intimate_prompt',
    ]);

    const writingDnaGroup = PROJECT_PROMPT_GROUPS.find((group) => group.key === 'writing-dna');
    expect(writingDnaGroup.items.map((item) => item.key)).not.toContain('nsfw_system_prompt');
    expect(writingDnaGroup.items.map((item) => item.key)).not.toContain('nsfw_rules');
    expect(writingDnaGroup.items.map((item) => item.key)).not.toContain('nsfw_intimate_prompt');
  });

  it('labels the legacy project wizard and separates continuity from conflict checks', () => {
    expect(GLOBAL_PROMPT_META.projectWizard.summary).toContain('Luồng cũ');
    expect(GLOBAL_PROMPT_META.storyBibleSeed.summary).toContain('AI Wizard mới');
    expect(GLOBAL_PROMPT_META.chapterOutlinePass.purpose).toContain('proposed_entities');

    const canonMemoryGroup = PROJECT_PROMPT_GROUPS.find((group) => group.key === 'canon-memory');
    const continuity = canonMemoryGroup.items.find((item) => item.key === TASK_TYPES.CONTINUITY_CHECK);
    const conflict = canonMemoryGroup.items.find((item) => item.key === TASK_TYPES.CHECK_CONFLICT);

    expect(continuity.purpose).toContain('rà rộng');
    expect(conflict.purpose).toContain('mâu thuẫn canon rõ ràng');
  });
});
