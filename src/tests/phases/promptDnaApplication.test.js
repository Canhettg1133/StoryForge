import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';
import { TASK_INSTRUCTIONS } from '../../services/ai/promptBuilder/taskInstructions';
import { AUTHOR_ROLE_TABLE, GENRES, MOOD_BOARD_DEFAULTS } from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';

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
    expect(system).toContain('[LUẬT CỐT LÕI CỦA TRUYỆN - BẮT BUỘC TUÂN THỦ]');
    expect(system).toContain('Canh gioi khong duoc dot pha vo ly');
    expect(system).toContain('[DNA VĂN PHONG CỦA TRUYỆN - PROJECT OVERRIDE]');
    expect(system).toContain('Giu nhip van co phong, tram va sac');
    expect(system).toContain('[TỪ/CỤM CẦN TRÁNH CỦA TRUYỆN - PROJECT BLACKLIST]');
    expect(system).toContain('anh mat sau tham');
  });

  it('has genre DNA templates for every selectable genre', () => {
    const missing = GENRES
      .map((item) => item.value)
      .filter((genreKey) => {
        const template = GENRE_TEMPLATES[genreKey];
        return !template
          || !Array.isArray(template.constitution)
          || !Array.isArray(template.style_dna)
          || !Array.isArray(template.anti_ai_blacklist);
      });

    expect(missing).toEqual([]);
  });

  it('uses project tags as soft direction in writing prompts', () => {
    const messages = buildPrompt(TASK_TYPES.SCENE_DRAFT, {
      projectTitle: 'Quan Tra Nua Dem',
      genre: 'slice_of_life',
      tone: 'humorous',
      projectTags: ['hài hước', 'đời thường', 'slow burn'],
      userPrompt: 'Viết một cảnh ở quán trà.',
    });

    const system = messages[0].content;

    expect(system).toContain('[TAG / TROPE CỦA TRUYỆN]');
    expect(system).toContain('- hài hước');
    expect(system).toContain('- đời thường');
    expect(system).toContain('- slow burn');
    expect(system).toContain('Tags là định hướng mềm');
  });

  it('does not force xianxia prompts into formulaic public reversals, breakthroughs, or cliffhangers', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      projectTitle: 'Tieu Dao Tong',
      genre: 'tien_hiep',
      tone: 'humorous',
      userPrompt: 'Viết tiếp một cảnh hài nhẹ trong tông môn.',
    });

    const system = messages[0].content;
    const user = messages[1].content;

    expect(system).not.toContain('Vả mặt (humiliation');
    expect(system).not.toContain('vả mặt');
    expect(system).not.toContain('Đột phá cảnh giới:');
    expect(system).not.toContain('Cao trào CÔNG THỨC');
    expect(system).not.toContain('thiên hạ vô địch');
    expect(system).not.toContain('Đẩy lên mức cảm xúc cao nhất có thể');
    expect(user).not.toContain('Cuối cảnh để lại tình huống mở hoặc câu hỏi khiến độc giả muốn sang chương tiếp');
    expect(system).toContain('không ép đối đầu công khai, tăng cấp hoặc xung đột lớn');
    expect(user).toContain('không ép điểm bỏ lửng căng giả');
  });

  it('keeps genre DNA flexible instead of hard-coding cultivation math or social ladders', () => {
    const tienHiepDna = [
      ...GENRE_TEMPLATES.tien_hiep.constitution,
      ...GENRE_TEMPLATES.tien_hiep.worldRules,
    ].join('\n');

    expect(tienHiepDna).not.toContain('bất di bất dịch');
    expect(tienHiepDna).not.toMatch(/~\d+/);
    expect(tienHiepDna).not.toContain('chưởng môn > trưởng lão > nội môn đệ tử > ngoại môn');
    expect(tienHiepDna).toContain('khung tham chiếu');
    expect(tienHiepDna).toContain('do tác giả/canon dự án xác định');
  });

  it('keeps built-in author role and mood prompt text in accented Vietnamese', () => {
    expect(AUTHOR_ROLE_TABLE.han_viet.join('\n')).toContain('kiến trúc sư');
    expect(AUTHOR_ROLE_TABLE.thuan_viet.join('\n')).toContain('tác giả Việt Nam');
    expect(MOOD_BOARD_DEFAULTS.tien_hiep.join('\n')).toContain('Linh khí');
    expect(MOOD_BOARD_DEFAULTS.do_thi.join('\n')).toContain('Tin nhắn');
  });

  it('does not hard-code prose length multipliers or romance formulas into writing prompts', () => {
    const writingInstructionText = [
      TASK_INSTRUCTIONS[TASK_TYPES.CONTINUE],
      TASK_INSTRUCTIONS[TASK_TYPES.REWRITE],
      TASK_INSTRUCTIONS[TASK_TYPES.EXPAND],
      TASK_INSTRUCTIONS[TASK_TYPES.SCENE_DRAFT],
      TASK_INSTRUCTIONS[TASK_TYPES.FREE_PROMPT],
    ].join('\n');

    expect(writingInstructionText).not.toMatch(/800-1800|20-50%|GẤP 3-5/);
    expect(writingInstructionText).toContain('không áp mốc nhân độ dài cứng');
    expect(writingInstructionText).toContain('thay vì cố đạt mốc số từ cứng');

    const romanceDna = [
      ...GENRE_TEMPLATES.romance.constitution,
      ...GENRE_TEMPLATES.romance.worldRules,
    ].join('\n');

    expect(romanceDna).toContain('không ép công thức');
    expect(romanceDna).not.toContain('giải quyết sớm = mất động lực đọc');
  });
});
