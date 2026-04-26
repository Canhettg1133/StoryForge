import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  TASK_INSTRUCTIONS,
  composeTaskInstruction,
  getTaskInstructionProtection,
  stripProtectedTaskInstruction,
} from '../../services/ai/promptBuilder';
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

  it('can make character batch generation treat inferred missing cast as an upper limit', () => {
    const messages = buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
      projectTitle: 'He He',
      genre: 'fantasy',
      userPrompt: 'Dan y co Kael, Lyra, Borg, Zeryn, Evelyn.',
      entityType: 'character',
      batchCount: 5,
      selectedBatchCount: 20,
      aiInferCharacterList: true,
      knownMissingCharacterNames: ['Kael', 'Lyra', 'Borg', 'Zeryn', 'Evelyn'],
      entityContextText: 'Nhan vat da co: Lyra aliases: Phap su ky uc',
    });

    expect(messages[1].content).toContain('[CHE DO TU PHAN TICH NHAN VAT CON THIEU]');
    expect(messages[1].content).toContain('Toi da 5 muc');
    expect(messages[1].content).toContain('name + aliases');
    expect(messages[1].content).toContain('[DANH SACH CON THIEU UI GOI Y - CAN KIEM TRA LAI]');
    expect(messages[1].content).toContain('So tac gia dang chon tren UI: 20');
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

  it('locks JSON contracts for protected task instructions', () => {
    const protection = getTaskInstructionProtection(TASK_TYPES.CONTINUITY_CHECK);

    expect(protection).toBeTruthy();
    expect(protection.lockedPrompt).toContain('"issues"');

    const editable = stripProtectedTaskInstruction(
      TASK_TYPES.CONTINUITY_CHECK,
      TASK_INSTRUCTIONS[TASK_TYPES.CONTINUITY_CHECK],
    );
    expect(editable).not.toContain('"issues"');

    const recomposed = composeTaskInstruction(TASK_TYPES.CONTINUITY_CHECK, editable);
    expect(recomposed).toContain('"issues"');
    expect(recomposed).toContain('Chi tra ve JSON.');
  });

  it('re-appends locked JSON output blocks even when project overrides omit them', () => {
    const messages = buildPrompt(TASK_TYPES.SUGGEST_UPDATES, {
      promptTemplates: {
        [TASK_TYPES.SUGGEST_UPDATES]: 'Phan tich noi dung chuong that ky. Chi de xuat thay doi khi co bang chung ro rang.',
      },
      sceneText: 'Nhan vat A bi thuong nang sau tran chien.',
    });

    expect(messages[0].content).toContain('[NHIEM VU]');
    expect(messages[0].content).toContain('"character_updates"');
    expect(messages[0].content).toContain('"new_canon_facts"');
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

  it('builds permissioned character blocks and prose discipline from the character context gate', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      projectTitle: 'Du An Thu',
      genre: 'fantasy',
      characters: [
        { id: 1, name: 'Lan', role: 'protagonist' },
        { id: 2, name: 'Kha', role: 'supporting' },
        { id: 3, name: 'Mai', role: 'supporting' },
      ],
      characterContextGate: {
        sceneCast: [{
          character: {
            id: 1,
            name: 'Lan',
            role: 'protagonist',
            aliases: ['A Lan'],
            pronouns_self: 'ta',
            personality: 'Kien dinh',
            flaws: 'Noi nong',
            speech_pattern: 'Ngan gon',
            current_status: 'Dang bi truy duoi',
            goals: 'Tim su that',
            secrets: 'La nguoi giu an tin',
            notes: 'Truc cam xuc cua canh',
            story_function: 'Dan mach chinh',
          },
          permission: 'direct_scene',
        }],
        chapterFocusCast: [{
          character: { id: 2, name: 'Kha', role: 'supporting', speech_pattern: 'Cham rai' },
          permission: 'chapter_focus_only',
        }],
        referencedCanonCast: [{
          character: { id: 3, name: 'Mai', role: 'supporting', current_status: 'Mat tich' },
          permission: 'canon_reference_only',
        }],
      },
    });

    const system = messages[0].content;
    expect(system).toContain('[NHAN VAT DUOC XUAT HIEN TRUC TIEP TRONG CANH]');
    expect(system).toContain('[NHAN VAT QUAN TRONG CUA CHUONG - KHONG TU DONG XUAT HIEN TRONG CANH]');
    expect(system).toContain('[CANON NHAN VAT LIEN QUAN / DUOC NHAC TOI]');
    expect(system).toContain('Muc tieu: Tim su that');
    expect(system).toContain('Bi mat canon (khong tu tiet lo neu chua den luc): La nguoi giu an tin');
    expect(system).toContain('Ghi chu: Truc cam xuc cua canh');
    expect(system).toContain('Vai tro truyen: Dan mach chinh');
    expect(system).toContain('[CAM BIA CANON NHAN VAT]');
    expect(system).toContain('[KY LUAT VAN XUOI VA THOAI - BO SUNG BAT BUOC]');
    expect(system.indexOf('[KY LUAT VAN XUOI VA THOAI - BO SUNG BAT BUOC]')).toBeGreaterThan(system.indexOf('[DNA VAN PHONG'));
    expect(system.indexOf('[KY LUAT VAN XUOI VA THOAI - BO SUNG BAT BUOC]')).toBeLessThan(system.indexOf('[DO DAI VA NHIP DO]'));
    expect(system).toContain('[NHIEM VU]');
    expect(system).toContain('[THE LOAI]');
  });

  it('forces OUTLINE to stay inside the current chapter and respect future chapter fences', () => {
    const messages = buildPrompt(TASK_TYPES.OUTLINE, {
      chapterText: 'Lam Phong dot pha Truc Co xong nhung van dang che giau. Tran Lao Quai da xuat hien o son coc.',
      chapterSceneCount: 2,
      currentChapterIndex: 9,
      targetLength: 100,
      milestones: [{ label: 'Midpoint', percent: 50 }],
      currentMacroArc: {
        title: 'Khoi dong tong mon',
        chapter_from: 8,
        chapter_to: 15,
      },
      currentChapterOutline: {
        title: 'Chuong 10: Truc Co',
        summary: 'Che giau vu dot pha va doi dau voi mot loi canh bao som.',
        purpose: 'Day thread Truc Co len mot nac nhung chua lo het bi mat.',
        threadTitles: ['Bi mat Truc Co', 'Tran Lao Quai tro lai'],
        keyEvents: [
          'Lam Phong dot pha Truc Co',
          'Tran Lao Quai xuat hien o son coc',
          'Thanh Van Tong bat dau nghi ngo',
        ],
      },
      upcomingChapters: [
        { title: 'Chuong 11: Che giau va song gio tro lai', summary: 'Thanh Van Tong dieu tra va bi mat bat dau ro dang.' },
      ],
    });

    expect(messages[0].content).toContain('[NHIEM VU CHUONG NAY - BAM SAT, KHONG LAC SANG CHUONG KHAC]');
    expect(messages[0].content).toContain('[CAC CHUONG TIEP THEO - TUYET DOI KHONG VIET TRUOC NOI DUNG NAY]');
    expect(messages[0].content).toContain('[OUTLINE GUARDRAILS]');
    expect(messages[0].content).toContain('[STORY PROGRESS BUDGET - CHUONG NAY]');
    expect(messages[0].content).toContain('[DOI CHIEU DAN Y VA NOI DUNG DA VIET - HEURISTIC, CHI DUNG DE DOI CHIEU]');
    expect(messages[0].content).toContain('"chapter_patch"');
    expect(messages[0].content).toContain('"next_beats"');
    expect(messages[1].content).toContain('[NOI DUNG DA CO CUA CHUONG HIEN TAI]');
    expect(messages[1].content).toContain('[GIOI HAN TIEN DO CHUONG NAY]');
    expect(messages[1].content).toContain('Tuyet doi khong viet thay noi dung cua chuong sau da co dan y.');
  });

  it('marks likely covered outline beats conservatively from existing chapter text', () => {
    const messages = buildPrompt(TASK_TYPES.OUTLINE, {
      chapterText: 'Lam Phong dot pha Truc Co ngay trong son coc. Sau do Tran Lao Quai xuat hien o son coc va ep han im lang.',
      currentChapterOutline: {
        title: 'Chuong 10: Truc Co',
        keyEvents: [
          'Lam Phong dot pha Truc Co',
          'Tran Lao Quai xuat hien o son coc',
          'Thanh Van Tong bat dau nghi ngo',
        ],
      },
    });

    expect(messages[0].content).toContain('co kha nang da viet: Lam Phong dot pha Truc Co');
    expect(messages[0].content).toContain('co kha nang da viet: Tran Lao Quai xuat hien o son coc');
    expect(messages[0].content).toContain('chua thay dau hieu ro: Thanh Van Tong bat dau nghi ngo');
  });

  it('locks the OUTLINE JSON contract so parser fields are not removed by prompt edits', () => {
    const protection = getTaskInstructionProtection(TASK_TYPES.OUTLINE);

    expect(protection).toBeTruthy();
    expect(protection.lockedPrompt).toContain('"mode"');
    expect(protection.lockedPrompt).toContain('"chapter_patch"');

    const editable = stripProtectedTaskInstruction(
      TASK_TYPES.OUTLINE,
      TASK_INSTRUCTIONS[TASK_TYPES.OUTLINE],
    );
    expect(editable).not.toContain('"chapter_patch"');

    const recomposed = composeTaskInstruction(TASK_TYPES.OUTLINE, editable);
    expect(recomposed).toContain('"completed_beats"');
    expect(recomposed).toContain('Chi tra ve JSON');
  });
});
