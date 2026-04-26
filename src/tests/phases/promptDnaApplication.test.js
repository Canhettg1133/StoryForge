import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';

describe('Project prompt DNA application', () => {
  it('injects project Constitution, Style DNA, blacklist, and tone into writing prompts', () => {
    const messages = buildPrompt(TASK_TYPES.SCENE_DRAFT, {
      projectTitle: 'Kiem Tam',
      genre: 'tien_hiep',
      tone: 'dark',
      userPrompt: 'Viet canh mo dau.',
      promptTemplates: {
        constitution: ['Canh gioi khong duoc dot pha vo ly'],
        style_dna: ['Giu nhip van co phong, tram va sac'],
        anti_ai_blacklist: ['anh mat sau tham'],
      },
    });

    const system = messages[0].content;

    expect(system).toContain('Tone: dark');
    expect(system).toContain('[LUAT COT LOI CUA TRUYEN - BAT BUOC TUAN THU]');
    expect(system).toContain('Canh gioi khong duoc dot pha vo ly');
    expect(system).toContain('[DNA VAN PHONG CUA TRUYEN - PROJECT OVERRIDE]');
    expect(system).toContain('Giu nhip van co phong, tram va sac');
    expect(system).toContain('[TU/CUM CAN TRANH CUA TRUYEN - PROJECT BLACKLIST]');
    expect(system).toContain('anh mat sau tham');
  });
});
