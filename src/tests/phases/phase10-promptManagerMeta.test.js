import { describe, expect, it } from 'vitest';

import { PROJECT_PROMPT_GROUPS } from '../../services/ai/promptManagerMeta';

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
});
