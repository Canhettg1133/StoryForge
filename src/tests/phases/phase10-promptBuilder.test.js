import { describe, it, expect } from 'vitest';
import { buildPrompt, TASK_INSTRUCTIONS } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';

describe('phase10 prompt builder coverage', () => {
  it('provides default prompts for story configuration tasks that were previously missing', () => {
    expect(TASK_INSTRUCTIONS[TASK_TYPES.AI_GENERATE_ENTITY]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.GENERATE_MACRO_MILESTONES]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.AUDIT_ARC_ALIGNMENT]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.CONTINUITY_CHECK]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.STYLE_ANALYZE]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.STYLE_WRITE]).toBeTruthy();
    expect(TASK_INSTRUCTIONS[TASK_TYPES.QA_CHECK]).toBeTruthy();
  });

  it('builds entity generation prompts with explicit schema and context', () => {
    const messages = buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
      projectTitle: 'Du An Thu',
      genre: 'fantasy',
      userPrompt: 'Tao mot nhan vat sat thu nu.',
      entityType: 'character',
      batchCount: 3,
      entityContextText: 'Nhan vat da co: A, B',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('[NHIEM VU]');
    expect(messages[1].content).toContain('[LOAI THUC THE]');
    expect(messages[1].content).toContain('nhan vat');
    expect(messages[1].content).toContain('"items"');
    expect(messages[1].content).toContain('Nhan vat da co: A, B');
  });

  it('builds macro milestone and audit prompts with dedicated user blocks', () => {
    const milestoneMessages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Dai Truyen',
      genre: 'xianxia',
      authorIdea: 'Main tu pham nhan tro thanh ton chu.',
      targetLength: 500,
      ultimateGoal: 'Pha vo loi nguyen.',
    });
    expect(milestoneMessages[1].content).toContain('[Y TUONG TAC GIA]');
    expect(milestoneMessages[1].content).toContain('500 chuong');

    const auditMessages = buildPrompt(TASK_TYPES.AUDIT_ARC_ALIGNMENT, {
      projectTitle: 'Dai Truyen',
      currentChapterIndex: 12,
      ultimateGoal: 'Pha vo loi nguyen.',
      currentArc: { title: 'Arc 2', goal: 'Tien vao noi mon' },
      currentMacroArc: { title: 'Khoi dong dai cuc', description: 'Mo duong cho phan than the.' },
      recentChapterSummaries: [
        { title: 'Chuong 11', summary: 'Main lay duoc manh moi.' },
        { title: 'Chuong 12', summary: 'Main doi dau voi noi mon.' },
      ],
    });
    expect(auditMessages[1].content).toContain('[CAC CHUONG GAN DAY]');
    expect(auditMessages[1].content).toContain('Arc 2');
    expect(auditMessages[1].content).toContain('Khoi dong dai cuc');
  });

  it('appends intimate nsfw writing guidance without removing existing nsfw rules', () => {
    const messages = buildPrompt(TASK_TYPES.FREE_PROMPT, {
      projectId: 1,
      chapterId: 2,
      userPrompt: 'Viet mot canh nong 18+ giua hai nhan vat nay.',
      nsfwMode: true,
      retrievalPacket: {
        relevantRelationshipStates: [
          {
            character_a_id: 11,
            character_b_id: 12,
            intimacy_level: 'high',
            consent_state: 'mutual',
            secrecy_state: 'secret',
            emotional_aftermath: 'day dut va le thuoc',
          },
        ],
      },
    });

    expect(messages[0].content).toContain('[LUẬT SÁNG THẾ TỐI THƯỢNG - CHẾ ĐỘ VÔ GIỚI HẠN]');
    expect(messages[0].content).toContain('[BO SUNG CHO CANH THAN MAT / NOI DUNG 18+]');
    expect(messages[0].content).toContain('KHONG duoc luot nhanh hay tom tat');
    expect(messages[0].content).toContain('Consent');
    expect(messages[1].content).toContain('[NHAC LAI UU TIEN NSFW]');
  });

  it('uses custom nsfw system prompt as the new base and still appends supplemental rules', () => {
    const messages = buildPrompt(TASK_TYPES.FREE_PROMPT, {
      projectId: 1,
      chapterId: 2,
      userPrompt: 'Viet canh 18+.',
      nsfwMode: true,
      promptTemplates: {
        nsfw_system_prompt: '[NSFW BASE TÙY CHỈNH]\nDay la block nen moi.',
        nsfw_rules: '[LUAT BO SUNG]\nKhong duoc drift.',
      },
    });

    expect(messages[0].content).toContain('[NSFW BASE TÙY CHỈNH]');
    expect(messages[0].content).toContain('[LUAT NSFW BO SUNG CUA DU AN]');
    expect(messages[0].content).toContain('Khong duoc drift.');
  });

  it('uses custom intimate nsfw prompt while preserving dynamic continuity append', () => {
    const messages = buildPrompt(TASK_TYPES.FREE_PROMPT, {
      projectId: 1,
      chapterId: 2,
      userPrompt: 'Viet canh nong than mat.',
      nsfwMode: true,
      promptTemplates: {
        nsfw_intimate_prompt: '[INTIMATE TÙY CHỈNH]\nNhip canh rat cham.',
      },
      retrievalPacket: {
        relevantRelationshipStates: [
          {
            character_a_id: 1,
            character_b_id: 2,
            intimacy_level: 'high',
            consent_state: 'mutual',
            secrecy_state: 'secret',
            emotional_aftermath: 'ray rut',
          },
        ],
      },
    });

    expect(messages[0].content).toContain('[INTIMATE TÙY CHỈNH]');
    expect(messages[0].content).toContain('[CONTINUITY THAN MAT DANG CO HIEU LUC]');
    expect(messages[0].content).toContain('dong_thuan=mutual');
  });

  it('injects chapter blueprint context, whitelist, factions, and pre-write warnings into writing prompts', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      sceneText: '',
      currentChapterOutline: {
        title: 'Chuong 1: Thanh co',
        summary: 'Lan den Thanh Co va va cham voi quy cu.',
        purpose: 'Dat neo mo dau va xac lap xung dot som',
        featuredCharacters: ['Lan', 'Kha'],
        primaryLocation: 'Thanh Co',
        threadTitles: ['Bi mat hoang toc'],
        requiredFactions: ['Thanh Van Tong'],
        requiredObjects: ['Ngoc boi'],
        keyEvents: ['Lan gap Kha'],
      },
      chapterBlueprintContext: {
        featured_characters: ['Lan', 'Kha'],
        primary_location: 'Thanh Co',
        required_factions: ['Thanh Van Tong'],
        required_objects: ['Ngoc boi'],
        required_terms: ['Linh can'],
      },
      preWriteValidation: {
        blockingIssues: [],
        warnings: [{ message: 'Scene moi dang trong va chua du setup POV/location/characters_present, AI de bi bia.' }],
      },
      upcomingChapters: [{ title: 'Chuong 2', summary: 'Lan vao tong mon.' }],
    });

    expect(messages[0].content).toContain('[NHIEM VU CHUONG NAY - BAM SAT, KHONG LAC SANG CHUONG KHAC]');
    expect(messages[0].content).toContain('Purpose: Dat neo mo dau va xac lap xung dot som');
    expect(messages[0].content).toContain('Nhan vat bat buoc bam sat: Lan, Kha');
    expect(messages[0].content).toContain('Dia diem chinh: Thanh Co');
    expect(messages[0].content).toContain('Tuyen truyen phai day: Bi mat hoang toc');
    expect(messages[0].content).toContain('The luc can xuat hien: Thanh Van Tong');
    expect(messages[0].content).toContain('[WHITELIST CHO CHUONG NAY - UU TIEN DUNG DUNG ENTITY DA DUOC CHI DINH]');
    expect(messages[0].content).toContain('Vat pham duoc phep/nen su dung: Ngoc boi');
    expect(messages[0].content).toContain('Thuat ngu nen bam sat: Linh can');
    expect(messages[0].content).toContain('Chi duoc dung entity ngoai danh sach neu summary chuong hoac canon dang co bat buoc phai goi toi.');
    expect(messages[0].content).toContain('[KIEM TRA TRUOC KHI VIET]');
    expect(messages[0].content).toContain('Canh bao anti-hallucination');
  });
});
