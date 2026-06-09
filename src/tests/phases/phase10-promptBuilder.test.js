import { describe, it, expect } from 'vitest';
import outlineBoardSource from '../../pages/OutlineBoard/OutlineBoard.jsx?raw';
import projectWizardSource from '../../pages/Dashboard/ProjectWizard.jsx?raw';
import {
  buildPrompt,
  TASK_INSTRUCTIONS,
  composeTaskInstruction,
  getTaskInstructionProtection,
  stripProtectedTaskInstruction,
} from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';
import { composeStoryCreationSystemPrompt } from '../../services/ai/storyCreationSettings';

function toAsciiUpper(text) {
  return String(text || '')
    .replace(/[Đđ]/g, (char) => (char === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

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
    expect(messages[0].content).toContain('[NHIỆM VỤ]');
    expect(messages[1].content).toContain('[LOẠI THỰC THỂ]');
    expect(messages[1].content).toContain('nhân vật');
    expect(messages[1].content).toContain('"items"');
    expect(messages[1].content).toContain('"age"');
    expect(messages[1].content).toContain('"current_status"');
    expect(messages[1].content).toContain('[HƯỚNG DẪN CURRENT_STATUS / CHARACTER LIVE CANON]');
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

    expect(messages[1].content).toContain('[CHẾ ĐỘ TỰ PHÂN TÍCH NHÂN VẬT CÒN THIẾU]');
    expect(messages[1].content).toContain('Tối đa 5 mục');
    expect(messages[1].content).toContain('name + aliases');
    expect(messages[1].content).toContain('[DANH SÁCH CÒN THIẾU UI GỢI Ý - CẦN KIỂM TRA LẠI]');
    expect(messages[1].content).toContain('Số tác giả đang chọn trên UI: 20');
  });

  it('builds macro milestone and audit prompts with dedicated user blocks', () => {
    const milestoneMessages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Dai Truyen',
      genre: 'xianxia',
      authorIdea: 'Main tu pham nhan tro thanh ton chu.',
      targetLength: 500,
      ultimateGoal: 'Pha vo loi nguyen.',
    });
    expect(milestoneMessages[1].content).toContain('[Ý TƯỞNG TÁC GIẢ]');
    expect(milestoneMessages[1].content).toContain('500 chương');

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
    expect(auditMessages[1].content).toContain('[CÁC CHƯƠNG GẦN ĐÂY]');
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
    expect(recomposed).toContain('Chỉ trả về JSON.');
  });

  it('still strips legacy non-accented JSON markers from saved prompt overrides', () => {
    const editable = stripProtectedTaskInstruction(
      TASK_TYPES.CONTINUITY_CHECK,
      [
        'Custom continuity rule.',
        'Tra ve CHINH XAC JSON format sau:',
        '{"issues":[]}',
      ].join('\n'),
    );

    expect(editable).toBe('Custom continuity rule.');

    const systemPrompt = composeStoryCreationSystemPrompt(
      'outlineGeneration',
      [
        'Custom outline rule.',
        'Tra ve CHINH XAC JSON:',
        '{"chapters":[]}',
      ].join('\n'),
    );

    expect(systemPrompt).toContain('Custom outline rule.');
    expect(systemPrompt).toContain('Trả về CHÍNH XÁC JSON:');
    expect(systemPrompt).not.toContain('Tra ve CHINH XAC JSON:\n{"chapters":[]}');
  });

  it('re-appends locked JSON output blocks even when project overrides omit them', () => {
    const messages = buildPrompt(TASK_TYPES.SUGGEST_UPDATES, {
      promptTemplates: {
        [TASK_TYPES.SUGGEST_UPDATES]: 'Phan tich noi dung chuong that ky. Chi de xuat thay doi khi co bang chung ro rang.',
      },
      sceneText: 'Nhan vat A bi thuong nang sau tran chien.',
    });

    expect(messages[0].content).toContain('[NHIỆM VỤ]');
    expect(messages[0].content).toContain('"character_updates"');
    expect(messages[0].content).toContain('"new_canon_facts"');
    expect(messages[0].content).toContain('"relationship_updates"');
  });

  it('builds a relationship-only batch analysis prompt with the required schema', () => {
    const messages = buildPrompt(TASK_TYPES.RELATIONSHIP_ANALYZE_BATCH, {
      projectTitle: 'Dự án thử',
      characters: [
        { id: 1, name: 'Lan', role: 'chính' },
        { id: 2, name: 'Kha', role: 'chính' },
      ],
      relationships: [
        { id: 10, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Bạn cũ.' },
      ],
      relationshipStates: [
        {
          character_a_id: 1,
          character_b_id: 2,
          relationship_type: 'friend',
          intimacy_level: 'medium',
          secrecy_state: 'secret',
          summary: 'Đang giấu một thỏa thuận.',
        },
      ],
      relationshipEvents: [
        {
          chapter_id: 6,
          op_type: 'RELATIONSHIP_SECRET_CHANGED',
          subject_id: 1,
          target_id: 2,
          summary: 'Lan biết Kha giấu thư.',
        },
      ],
      relationshipAnalysisChapters: [
        {
          chapterId: 7,
          chapterTitle: 'Chương 7',
          signature: 'abc',
          text: '[Cảnh 1]\nLan trao thư cho Kha.',
        },
      ],
    });

    const system = messages[0].content;
    const user = messages[1].content;
    expect(system).toContain('"chapters"');
    expect(system).toContain('"relationship_updates"');
    expect(system).toContain('"character_a_name"');
    expect(system).not.toContain('"character_updates"');
    expect(system).not.toContain('"new_canon_facts"');

    expect(user).toContain('[NHÂN VẬT ĐÃ BIẾT]');
    expect(user).toContain('[QUAN HỆ NỀN DO TÁC GIẢ NHẬP]');
    expect(user).toContain('[TRẠNG THÁI QUAN HỆ HIỆN TẠI TRƯỚC BATCH]');
    expect(user).toContain('[CÁC CHƯƠNG CẦN PHÂN TÍCH]');
    expect(user).toContain('[CHƯƠNG 7: Chương 7]');
    expect(user).toContain('Lan trao thư cho Kha');
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
    expect(messages[0].content).toContain('[BỔ SUNG CHO CẢNH THÂN MẬT / NỘI DUNG 18+]');
    expect(messages[0].content).toContain('KHÔNG được lướt nhanh hay tóm tắt');
    expect(messages[0].content).toContain('không tự động sẵn sàng');
    expect(messages[0].content).toContain('Không dùng phản ứng cơ thể như một công tắc');
    expect(messages[0].content).toContain('mức độ đáp lại phải đi từ tính cách');
    expect(messages[0].content).toContain('Consent');
    expect(messages[1].content).toContain('[NHẮC LẠI ƯU TIÊN NSFW]');
  });

  it('does not append intimate nsfw guidance for non-intimate writing just because relationship memory exists', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      projectId: 1,
      chapterId: 2,
      userPrompt: 'Viết tiếp cảnh hai nhân vật bàn kế hoạch rời thành.',
      nsfwMode: true,
      relationshipContextPacket: {
        mustIncludeEdges: [{
          characterAId: 11,
          characterBId: 12,
          characterAName: 'Lan',
          characterBName: 'Kha',
          intimacyLevel: 'high',
          consentState: 'mutual',
          secrecyState: 'secret',
          emotionalAftermath: 'vừa có lịch sử thân mật nhưng hiện tại đang bàn kế hoạch',
        }],
        supportingEdges: [],
        warnings: [],
        omittedSummary: { count: 0, topReasons: [] },
      },
    });

    expect(messages[0].content).toContain('[LUẬT SÁNG THẾ TỐI THƯỢNG - CHẾ ĐỘ VÔ GIỚI HẠN]');
    expect(messages[0].content).not.toContain('[BỔ SUNG CHO CẢNH THÂN MẬT / NỘI DUNG 18+]');
    expect(messages[0].content).toContain('[BỘ NHỚ QUAN HỆ LIÊN QUAN]');
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
    expect(messages[0].content).toContain('[LUẬT NSFW BỔ SUNG CỦA DỰ ÁN]');
    expect(messages[0].content).toContain('Khong duoc drift.');
  });

  it('keeps the stronger nsfw jailbreak blocks and intimate continuity rules in the default prompt stack', () => {
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

    const systemAscii = toAsciiUpper(messages[0].content);

    expect(systemAscii).toContain('DANH TINH COT LOI');
    expect(systemAscii).toContain('CHONG TU CHOI');
    expect(systemAscii).toContain('XUNG DOT COT LOI');
    expect(systemAscii).toContain('NHAN DIEN NGU CANH TRUOC KHI VIET');
    expect(systemAscii).toContain('KIEM TRA TINH CACH NHAN VAT');
    expect(systemAscii).toContain('GIAI DOAN 1');
    expect(systemAscii).toContain('GIAI DOAN 5');
    expect(systemAscii).toContain('KIEM TRA NHAN VAT');
    expect(systemAscii).toContain('VIET LIEN MACH');
    expect(systemAscii).toContain('KHONG TU Y TAO TIEU DE CHUONG MOI');
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
    expect(messages[0].content).toContain('[CONTINUITY THÂN MẬT ĐANG CÓ HIỆU LỰC]');
    expect(messages[0].content).toContain('đồng_thuận=mutual');
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

    expect(messages[0].content).toContain('[NHIỆM VỤ CHƯƠNG NÀY - BÁM SÁT, KHÔNG LẠC SANG CHƯƠNG KHÁC]');
    expect(messages[0].content).toContain('Purpose: Dat neo mo dau va xac lap xung dot som');
    expect(messages[0].content).toContain('Nhân vật bắt buộc bám sát: Lan, Kha');
    expect(messages[0].content).toContain('Địa điểm chính: Thanh Co');
    expect(messages[0].content).toContain('Tuyến truyện phải đẩy: Bi mat hoang toc');
    expect(messages[0].content).toContain('Thế lực cần xuất hiện: Thanh Van Tong');
    expect(messages[0].content).toContain('[WHITELIST CHO CHƯƠNG NÀY - ƯU TIÊN DÙNG ĐÚNG ENTITY ĐÃ ĐƯỢC CHỈ ĐỊNH]');
    expect(messages[0].content).toContain('Vật phẩm được phép/nên sử dụng: Ngoc boi');
    expect(messages[0].content).toContain('Thuật ngữ nên bám sát: Linh can');
    expect(messages[0].content).toContain('Chỉ được dùng entity ngoài danh sách nếu summary chương hoặc canon đang có bắt buộc phải gọi tới.');
    expect(messages[0].content).toContain('[KIỂM TRA TRƯỚC KHI VIẾT]');
    expect(messages[0].content).toContain('Cảnh báo anti-hallucination');
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
            age: 'ngoai hinh doi muoi, tuoi that rat cao',
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
    expect(system).toContain('[NHÂN VẬT ĐƯỢC XUẤT HIỆN TRỰC TIẾP TRONG CẢNH]');
    expect(system).toContain('[NHÂN VẬT QUAN TRỌNG CỦA CHƯƠNG - KHÔNG TỰ ĐỘNG XUẤT HIỆN TRONG CẢNH]');
    expect(system).toContain('[CANON NHÂN VẬT LIÊN QUAN / ĐƯỢC NHẮC TỚI]');
    expect(system).toContain('Mục tiêu: Tim su that');
    expect(system).toContain('Tuổi/độ tuổi: ngoai hinh doi muoi, tuoi that rat cao');
    expect(system).toContain('Không tự bịa tuổi/độ tuổi');
    expect(system).toContain('Age/tuổi chỉ là tín hiệu mềm');
    expect(system).toContain('Bí mật canon (không tự tiết lộ nếu chưa đến lúc): La nguoi giu an tin');
    expect(system).toContain('Ghi chú: Truc cam xuc cua canh');
    expect(system).toContain('Vai trò truyện: Dan mach chinh');
    expect(system).toContain('Character Live Canon / ràng buộc canon đang hiệu lực: Dang bi truy duoi');
    expect(system).toContain('[RÀNG BUỘC CURRENT_STATUS - CHARACTER LIVE CANON]');
    expect(system).toContain('current_status là ràng buộc canon hiện hành');
    expect(system).toContain('[CẤM BỊA CANON NHÂN VẬT]');
    expect(system).toContain('[KỶ LUẬT VĂN XUÔI VÀ THOẠI - BỔ SUNG BẮT BUỘC]');
    expect(system.indexOf('[KỶ LUẬT VĂN XUÔI VÀ THOẠI - BỔ SUNG BẮT BUỘC]')).toBeGreaterThan(system.indexOf('[DNA VĂN PHONG'));
    expect(system.indexOf('[KỶ LUẬT VĂN XUÔI VÀ THOẠI - BỔ SUNG BẮT BUỘC]')).toBeLessThan(system.indexOf('[ĐỘ DÀI VÀ NHỊP ĐỘ]'));
    expect(system).toContain('[NHIỆM VỤ]');
    expect(system).toContain('[THỂ LOẠI]');
  });

  it('injects generic canon role locks for writing, outline, chapter draft, and entity generation prompts', () => {
    const canonRoleLocks = [
      {
        characterId: 2,
        characterName: 'Lan',
        specificRole: 'nguoi giu ban do co',
        locked: true,
      },
      {
        characterId: 3,
        characterName: 'Minh',
        specificRole: 'nguoi tung phan boi hoi dong',
        locked: true,
      },
    ];

    const taskTypes = [
      TASK_TYPES.CONTINUE,
      TASK_TYPES.OUTLINE,
      TASK_TYPES.ARC_CHAPTER_DRAFT,
      TASK_TYPES.AI_GENERATE_ENTITY,
    ];

    for (const taskType of taskTypes) {
      const messages = buildPrompt(taskType, {
        projectTitle: 'Du An Thu',
        userPrompt: 'Tao noi dung tiep theo.',
        entityType: 'character',
        canonRoleLocks,
      });

      expect(messages[0].content).toContain('[CANON VAI TRÒ ĐÃ KHÓA - BẮT BUỘC]');
      expect(messages[0].content).toContain('- Lan: nguoi giu ban do co');
      expect(messages[0].content).toContain('- Minh: nguoi tung phan boi hoi dong');
      expect(messages[0].content).toContain('Không tạo, thay thế, gán lại, hoặc ám chỉ nhân vật khác');
      expect(messages[0].content).not.toContain('me cua main');
      expect(messages[0].content).not.toContain('nguoi yeu cua main');
      expect(messages[0].content).not.toContain('su phu cua main');
    }

    const noLockMessages = buildPrompt(TASK_TYPES.CONTINUE, {
      canonRoleLocks: [],
    });
    expect(noLockMessages[0].content).not.toContain('[CANON VAI TRÒ ĐÃ KHÓA - BẮT BUỘC]');
  });

  it('includes role lock guidance in character generation user schema', () => {
    const messages = buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
      projectTitle: 'Du An Thu',
      userPrompt: 'Tao mot nhan vat moi.',
      entityType: 'character',
      batchCount: 1,
      canonRoleLocks: [{
        characterId: 1,
        characterName: 'Ha',
        specificRole: 'nguoi duy nhat biet than phan that',
        locked: true,
      }],
    });

    expect(messages[1].content).toContain('"specific_role"');
    expect(messages[1].content).toContain('"specific_role_locked"');
    expect(messages[1].content).toContain('[HƯỚNG DẪN VAI TRÒ CỤ THỂ / CANON ROLE LOCK]');
    expect(messages[1].content).toContain('Không tạo nhân vật mới có vai trò cụ thể trùng');
  });

  it('keeps project wizard locked schema compatible with specific role locks', () => {
    const systemPrompt = composeStoryCreationSystemPrompt('projectWizard', 'Custom wizard prompt');

    expect(systemPrompt).toContain('"specific_role"');
    expect(systemPrompt).toContain('"specific_role_locked"');
    expect(systemPrompt).toContain('specific_role là vai trò canon cụ thể');
    expect(systemPrompt).not.toContain('me cua main');
    expect(systemPrompt).not.toContain('nguoi yeu cua main');
    expect(systemPrompt).not.toContain('su phu cua main');
  });

  it('omits character age context when the author did not provide it', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      characters: [
        { id: 1, name: 'Lan', role: 'protagonist', personality: 'Kien dinh' },
      ],
    });

    const system = messages[0].content;
    expect(system).not.toContain('Tuổi/độ tuổi:');
    expect(system).toContain('Không tự bịa tuổi/độ tuổi');
  });

  it('injects the Character page roster into OUTLINE prompts before a chapter has cast anchors', () => {
    const messages = buildPrompt(TASK_TYPES.OUTLINE, {
      allCharacters: [
        {
          id: 1,
          name: 'Lan',
          aliases: ['A Lan'],
          role: 'protagonist',
          current_status: 'Dang bi thuong va chua biet bi mat cua Kha.',
        },
        {
          id: 2,
          name: 'Kha',
          role: 'supporting',
          specific_role: 'nguoi giu chia khoa vao noi dien',
          specific_role_locked: true,
        },
      ],
      characters: [],
      characterContextGate: {
        sceneCast: [],
        chapterFocusCast: [],
        referencedCanonCast: [],
      },
      currentChapterOutline: {
        title: 'Chuong 2: Canh cong noi dien',
      },
    });

    const system = messages[0].content;
    expect(system).toContain('[DANH SÁCH NHÂN VẬT TRONG TRANG NHÂN VẬT');
    expect(system).toContain('Lan');
    expect(system).toContain('A Lan');
    expect(system).toContain('Kha');
    expect(system).toContain('nguoi giu chia khoa vao noi dien');
    expect(system).toContain('featured_characters');
    expect(system).toContain('không biến alias thành nhân vật mới');
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

    expect(messages[0].content).toContain('[NHIỆM VỤ CHƯƠNG NÀY - BÁM SÁT, KHÔNG LẠC SANG CHƯƠNG KHÁC]');
    expect(messages[0].content).toContain('[CÁC CHƯƠNG TIẾP THEO - TUYỆT ĐỐI KHÔNG VIẾT TRƯỚC NỘI DUNG NÀY]');
    expect(messages[0].content).toContain('[OUTLINE GUARDRAILS]');
    expect(messages[0].content).toContain('Character Live Canon');
    expect(messages[0].content).toContain('[STORY PROGRESS BUDGET - CHƯƠNG NÀY]');
    expect(messages[0].content).toContain('[ĐỐI CHIẾU DÀN Ý VÀ NỘI DUNG ĐÃ VIẾT - HEURISTIC, CHỈ DÙNG ĐỂ ĐỐI CHIẾU]');
    expect(messages[0].content).toContain('"chapter_patch"');
    expect(messages[0].content).toContain('"next_beats"');
    expect(messages[0].content).toContain('"state_delta"');
    expect(messages[0].content).toContain('"required_terms"');
    expect(messages[1].content).toContain('[NỘI DUNG ĐÃ CÓ CỦA CHƯƠNG HIỆN TẠI]');
    expect(messages[1].content).toContain('[GIỚI HẠN TIẾN ĐỘ CHƯƠNG NÀY]');
    expect(messages[1].content).toContain('Tuyệt đối không viết thay nội dung của chương sau đã có dàn ý.');
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

    expect(messages[0].content).toContain('có khả năng đã viết: Lam Phong dot pha Truc Co');
    expect(messages[0].content).toContain('có khả năng đã viết: Tran Lao Quai xuat hien o son coc');
    expect(messages[0].content).toContain('chưa thấy dấu hiệu rõ: Thanh Van Tong bat dau nghi ngo');
  });

  it('locks the OUTLINE JSON contract so parser fields are not removed by prompt edits', () => {
    const protection = getTaskInstructionProtection(TASK_TYPES.OUTLINE);

    expect(protection).toBeTruthy();
    expect(protection.lockedPrompt).toContain('"mode"');
    expect(protection.lockedPrompt).toContain('"chapter_patch"');
    expect(protection.lockedPrompt).toContain('"required_terms"');

    const editable = stripProtectedTaskInstruction(
      TASK_TYPES.OUTLINE,
      TASK_INSTRUCTIONS[TASK_TYPES.OUTLINE],
    );
    expect(editable).not.toContain('"chapter_patch"');

    const recomposed = composeTaskInstruction(TASK_TYPES.OUTLINE, editable);
    expect(recomposed).toContain('"completed_beats"');
    expect(recomposed).toContain('"required_terms"');
    expect(recomposed).toContain('Chỉ trả về JSON');
  });

  it('keeps Story Bible Seed locked schema free of chapter outline fields', () => {
    const systemPrompt = composeStoryCreationSystemPrompt('storyBibleSeed', 'Custom seed prompt');

    expect(systemPrompt).toContain('"title_options"');
    expect(systemPrompt).toContain('"world_profile"');
    expect(systemPrompt).toContain('"characters"');
    expect(systemPrompt).toContain('"plot_threads"');
    expect(systemPrompt).not.toContain('"chapters"');
    expect(systemPrompt).toContain('KHÔNG lập dàn ý chương');
  });

  it('keeps Chapter Outline Pass locked schema aligned with chapter blueprint fields consumed by the app', () => {
    const systemPrompt = composeStoryCreationSystemPrompt('chapterOutlinePass', 'Custom outline pass prompt');

    expect(systemPrompt).toContain('"required_factions"');
    expect(systemPrompt).toContain('"required_objects"');
    expect(systemPrompt).toContain('"required_terms"');
    expect(systemPrompt).toContain('"opening_state"');
    expect(systemPrompt).toContain('"handoff_from_previous"');
    expect(systemPrompt).toContain('"ending_state"');
    expect(systemPrompt).toContain('"proposed_entities"');
  });

  it('keeps OutlineBoard generation schema and persistence aligned with chapter anchors', () => {
    const systemPrompt = composeStoryCreationSystemPrompt('outlineGeneration', 'Custom outline prompt');

    expect(systemPrompt).toContain('"featured_characters"');
    expect(systemPrompt).toContain('"primary_location"');
    expect(systemPrompt).toContain('"thread_titles"');
    expect(systemPrompt).toContain('"key_events"');
    expect(systemPrompt).toContain('"required_factions"');
    expect(systemPrompt).toContain('"required_objects"');
    expect(systemPrompt).toContain('"required_terms"');
    expect(systemPrompt).toContain('Tên ngắn/biệt danh/alias không được biến thành nhân vật mới');

    expect(outlineBoardSource).toContain('function buildChapterAnchorPatch');
    expect(outlineBoardSource).toContain('function buildChapterAnalysisPatch');
    expect(outlineBoardSource).toContain('buildExistingOutlineContext(chapters, scenes)');
    expect(outlineBoardSource).toContain('Nội dung đã viết / trích đoạn scene');
    expect(outlineBoardSource).toContain('không được bịa entity ngoài Codex');
    expect(outlineBoardSource).toContain('setOutlineAnalysisPreview');
    expect(outlineBoardSource).toContain('handleApplyOutlineAnalysis');
    expect(outlineBoardSource).not.toContain('...buildChapterAnchorPatch(nextChapters[i], { preserveMissing: true })');
    expect(outlineBoardSource).toContain('...buildChapterAnchorPatch(ac)');
    expect(outlineBoardSource).toContain('formatCharacterForOutlinePrompt');
  });

  it('renders relationshipContextPacket without leaking routing debug or legacy relationship blocks', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      relationships: [
        { charA: 'Lan', charB: 'Kha', label: 'Bạn bè', description: 'Đường cũ không nên vào prompt khi đã có packet.' },
      ],
      relationshipRoutingDebug: [
        { pairKey: '1:2', selectedAs: 'mustInclude', omittedReason: 'debug-only' },
      ],
      relationshipContextPacket: {
        mustIncludeEdges: [{
          pairKey: '1:2',
          characterAId: 1,
          characterBId: 2,
          characterAName: 'Lan',
          characterBName: 'Kha',
          label: 'Người yêu',
          intimacyLevel: 'high',
          secrecyState: 'secret',
          consentState: 'mutual',
          emotionalAftermath: 'còn day dứt',
          summary: 'Vừa thừa nhận tình cảm nhưng chưa công khai.',
        }],
        supportingEdges: [],
        warnings: [],
        omittedSummary: {
          count: 2,
          topReasons: ['điểm thấp hoặc chỉ là quan hệ nền yếu: 2'],
        },
        budgetPressure: false,
      },
      retrievalPacket: {
        relevantEntityStates: [{ entity_id: 1, alive_status: 'alive' }],
        relevantRelationshipStates: [{
          character_a_id: 1,
          character_b_id: 2,
          relationship_type: 'friend',
          summary: 'Đường projection cũ không nên bơm song song.',
        }],
        criticalConstraints: {
          relationshipConstraints: [{
            pair_key: '1:2',
            intimacy_level: 'high',
          }],
        },
      },
    });

    const system = messages[0].content;
    expect(system).toContain('[BỘ NHỚ QUAN HỆ LIÊN QUAN]');
    expect(system).toContain('Quan hệ bắt buộc giữ đúng');
    expect(system).toContain('Lan ↔ Kha');
    expect(system).toContain('bí mật: secret');
    expect(system).toContain('Đã cắt 2 quan hệ ngoài trọng tâm');
    expect(system).not.toContain('debug-only');
    expect(system).not.toContain('Lan <-> Kha');
    expect(system).not.toContain('Quan hệ / độ thân mật liên quan');
    expect(system).not.toContain('Ràng buộc quan hệ gần đây');
  });

  it.each([
    ['continue direct scene', TASK_TYPES.CONTINUE, 'Lan', 'Kha', 'Quan hệ bắt buộc giữ đúng'],
    ['continue support secret', TASK_TYPES.CONTINUE, 'Mai', 'Nam', 'Quan hệ hỗ trợ liên quan'],
    ['scene draft direct scene', TASK_TYPES.SCENE_DRAFT, 'An', 'Bình', 'Quan hệ bắt buộc giữ đúng'],
    ['scene draft support intimacy', TASK_TYPES.SCENE_DRAFT, 'Chi', 'Dũng', 'Quan hệ hỗ trợ liên quan'],
    ['outline named pair', TASK_TYPES.OUTLINE, 'Hạ', 'Lâm', 'Quan hệ bắt buộc giữ đúng'],
    ['outline support reversal', TASK_TYPES.OUTLINE, 'Mộc', 'Nhi', 'Quan hệ hỗ trợ liên quan'],
    ['arc outline named pair', TASK_TYPES.ARC_OUTLINE, 'Sơn', 'Tú', 'Quan hệ bắt buộc giữ đúng'],
    ['arc outline support secret', TASK_TYPES.ARC_OUTLINE, 'Uyên', 'Việt', 'Quan hệ hỗ trợ liên quan'],
    ['arc chapter draft direct scene', TASK_TYPES.ARC_CHAPTER_DRAFT, 'Yến', 'Quân', 'Quan hệ bắt buộc giữ đúng'],
    ['arc chapter draft budget pressure', TASK_TYPES.ARC_CHAPTER_DRAFT, 'Giang', 'Hải', 'Quan hệ bắt buộc giữ đúng'],
  ])('uses relationshipContextPacket during migration fixture: %s', (_name, taskType, characterAName, characterBName, sectionLabel) => {
    const edge = {
      pairKey: `${characterAName}:${characterBName}`,
      characterAId: 1,
      characterBId: 2,
      characterAName,
      characterBName,
      label: 'Đối thủ',
      intimacyLevel: 'medium',
      secrecyState: 'secret',
      consentState: 'mutual',
      emotionalAftermath: 'còn căng',
      summary: 'Cần giữ đúng khi viết/dàn ý.',
    };
    const useMustInclude = sectionLabel.includes('bắt buộc');
    const messages = buildPrompt(taskType, {
      sceneText: 'Một cảnh kiểm thử quan hệ.',
      userPrompt: `${characterAName} và ${characterBName}`,
      relationships: [
        { charA: 'Đường', charB: 'Cũ', label: 'Không dùng', description: 'legacy relationship block' },
      ],
      relationshipRoutingDebug: [
        { pairKey: edge.pairKey, selectedAs: 'debug-only', omittedReason: 'debug-only' },
      ],
      relationshipContextPacket: {
        mustIncludeEdges: useMustInclude ? [edge] : [],
        supportingEdges: useMustInclude ? [] : [edge],
        warnings: _name.includes('budget') ? ['Ngân sách quan hệ đang căng.'] : [],
        omittedSummary: {
          count: 1,
          topReasons: ['điểm thấp hoặc chỉ là quan hệ nền yếu: 1'],
        },
        budgetPressure: _name.includes('budget'),
      },
    });

    const system = messages[0].content;
    expect(system).toContain('[BỘ NHỚ QUAN HỆ LIÊN QUAN]');
    expect(system).toContain(sectionLabel);
    expect(system).toContain(`${characterAName} ↔ ${characterBName}`);
    expect(system).not.toContain('legacy relationship block');
    expect(system).not.toContain('debug-only');
    expect(system).not.toContain('Quan hệ / độ thân mật liên quan');
  });

  it('uses the two-pass wizard prompt groups instead of the old one-call schema', () => {
    expect(projectWizardSource).toContain("groupKey: 'storyBibleSeed'");
    expect(projectWizardSource).toContain("groupKey: 'chapterOutlinePass'");
    expect(projectWizardSource).toContain('normalizeStoryBibleSeedResult');
    expect(projectWizardSource).toContain('normalizeChapterOutlinePassResult');
    expect(projectWizardSource).toContain('sendStoryCreationRequest');
    expect(projectWizardSource).not.toContain('composeStoryCreationSystemPrompt(\'projectWizard\'');
  });
});
