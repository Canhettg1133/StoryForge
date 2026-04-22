import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';
import {
  recommendArcBatchCount,
  buildStoryProgressBudget,
  buildDraftQueue,
  collectBatchChapterAnchors,
  normalizeMacroMilestoneItem,
  resolveBatchChapterWindow,
  describeOutlineValidationIssue,
  summarizeOutlineRevisionAssessment,
  validateGeneratedOutline,
} from '../../stores/arcGenerationStore';
import {
  buildMacroArcPersistenceSnapshot,
  compileMacroArcContract,
  normalizeBoolean,
  parseStoredMacroArcContract,
  preserveChapterAnchorIds,
  serializeMacroArcContract,
  validateMacroArcChapterAnchors,
  validateDraftAgainstChapterAnchors,
} from '../../services/ai/macroArcContract';
import {
  cascadeSequentialMacroArcStarts,
  normalizePlanningScope,
  updateMilestoneChapterPlanSequence,
} from '../../pages/StoryBible/hooks/useStoryBibleMacroArcs';

describe('phase10 auto-gen planning upgrade', () => {
  it('recommends safer default batch counts from target_length', () => {
    expect(recommendArcBatchCount(100)).toBe(5);
    expect(recommendArcBatchCount(300)).toBe(3);
    expect(recommendArcBatchCount(1200)).toBe(2);
  });

  it('builds story progress budgets with bounded percent ranges', () => {
    const budget = buildStoryProgressBudget({
      targetLength: 1000,
      currentChapterCount: 10,
      batchCount: 3,
      selectedMacroArc: { title: 'Khoi dong', chapter_from: 11, chapter_to: 40 },
      milestones: [{ label: 'Midpoint', percent: 50 }],
    });

    expect(budget.fromPercent).toBe(1);
    expect(budget.toPercent).toBe(1.3);
    expect(budget.batchStartChapter).toBe(11);
    expect(budget.batchEndChapter).toBe(13);
    expect(budget.batchMacroOverlapCount).toBe(3);
    expect(budget.chaptersRemainingAfterBatchInMacro).toBe(27);
    expect(budget.batchReachesMacroEnd).toBe(false);
    expect(budget.mainPlotMaxStep).toBe(1);
    expect(budget.requiredBeatMix).toContain('setup');
  });

  it('clamps batch windows to the selected macro arc range', () => {
    const window = resolveBatchChapterWindow({
      currentChapterCount: 10,
      batchCount: 5,
      selectedMacroArc: { title: 'Arc ngan', chapter_from: 11, chapter_to: 12 },
    });
    const budget = buildStoryProgressBudget({
      targetLength: 100,
      currentChapterCount: 10,
      batchCount: 5,
      selectedMacroArc: { title: 'Arc ngan', chapter_from: 11, chapter_to: 12 },
      milestones: [],
    });

    expect(window.batchStartChapter).toBe(11);
    expect(window.batchEndChapter).toBe(12);
    expect(window.effectiveBatchCount).toBe(2);
    expect(window.isClampedToMacroRange).toBe(true);
    expect(budget.batchCount).toBe(2);
    expect(budget.requestedBatchCount).toBe(5);
    expect(budget.batchReachesMacroEnd).toBe(true);
  });

  it('builds draft queues from selected outline indexes only', () => {
    const queue = buildDraftQueue({
      chapters: [
        { title: 'Chuong 11: A' },
        { title: 'Chuong 12: B' },
        { title: 'Chuong 13: C' },
      ],
    }, [2, 0], 10);

    expect(queue).toHaveLength(2);
    expect(queue[0].outlineIndex).toBe(0);
    expect(queue[0].chapterIndex).toBe(10);
    expect(queue[1].outlineIndex).toBe(2);
    expect(queue[1].chapterIndex).toBe(12);
  });

  it('flags padding, repetition, too-fast and premature-resolution outlines', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 11: Lang thang',
          summary: 'Main di lang thang.',
          key_events: [],
        },
        {
          title: 'Chuong 12: Lang thang',
          summary: 'Main di lang thang.',
          key_events: [],
        },
        {
          title: 'Chuong 13: Giai quyet bi mat',
          summary: 'Main tiet lo bi mat lon va ket thuc thread chinh ngay lap tuc.',
          key_events: ['tiet lo bi mat lon', 'giai quyet thread chinh'],
        },
      ],
    }, {
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        currentChapterCount: 10,
        batchCount: 3,
        nextMilestone: { label: 'Midpoint', percent: 50 },
      },
      selectedMacroArc: {
        title: 'Khoi dong tong mon',
        chapter_to: 30,
      },
      milestones: [{ label: 'Midpoint', percent: 50 }],
    });

    expect(validation.hasBlockingIssues).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'padding')).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'repetitive')).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'too-fast')).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'premature-resolution')).toBe(true);
  });

  it('annotates outline validator issues with visible vs metadata sources', () => {
    expect(describeOutlineValidationIssue({ code: 'hard-anchor-missing-ref' })).toMatchObject({
      inputKind: 'metadata',
    });
    expect(describeOutlineValidationIssue({ code: 'too-fast' })).toMatchObject({
      inputKind: 'mixed',
    });
    expect(describeOutlineValidationIssue({ code: 'chapter-out-of-range' })).toMatchObject({
      inputKind: 'system',
    });
  });

  it('summarizes outline revision outcomes as improved, unchanged, or worse', () => {
    expect(summarizeOutlineRevisionAssessment({
      beforeValidation: {
        issues: [
          { code: 'too-fast', severity: 'error', chapterIndex: 0 },
          { code: 'padding', severity: 'warning', chapterIndex: 1 },
        ],
      },
      afterValidation: {
        issues: [
          { code: 'padding', severity: 'warning', chapterIndex: 1 },
        ],
      },
    }).status).toBe('improved');

    expect(summarizeOutlineRevisionAssessment({
      beforeValidation: {
        issues: [
          { code: 'too-fast', severity: 'error', chapterIndex: 0 },
        ],
      },
      afterValidation: {
        issues: [
          { code: 'too-fast', severity: 'error', chapterIndex: 0 },
        ],
      },
    }).status).toBe('unchanged');

    expect(summarizeOutlineRevisionAssessment({
      beforeValidation: {
        issues: [
          { code: 'padding', severity: 'warning', chapterIndex: 0 },
        ],
      },
      afterValidation: {
        issues: [
          { code: 'padding', severity: 'warning', chapterIndex: 0 },
          { code: 'too-fast', severity: 'error', chapterIndex: 1 },
        ],
      },
    }).status).toBe('worse');
  });

  it('blocks outlines whose generated chapters spill outside the selected macro arc range', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        { title: 'Chuong 11: A', summary: 'Mo man', key_events: ['mo man'] },
        { title: 'Chuong 12: B', summary: 'Buildup', key_events: ['buildup'] },
        { title: 'Chuong 13: C', summary: 'Lech range', key_events: ['lech'] },
      ],
    }, {
      startChapterNumber: 11,
      selectedMacroArc: {
        title: 'Arc ngan',
        chapter_from: 11,
        chapter_to: 12,
      },
      storyProgressBudget: {
        currentChapterCount: 10,
        fromPercent: 10,
        toPercent: 12,
      },
    });

    expect(validation.hasBlockingIssues).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'chapter-out-of-range' && issue.chapterIndex === 2)).toBe(true);
  });

  it('treats beat-mix heuristics as non-blocking even when setup signals are weak', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 11: Dau vet moi',
          purpose: 'Cho nhan vat nhan ra mot nguy co gan hon.',
          summary: 'Nhan vat chinh theo dau vet va gap mot nhan chung dang so hai.',
          key_events: ['gap nhan chung', 'tim thay dau vet'],
        },
        {
          title: 'Chuong 12: Loi moi',
          purpose: 'Day nhan vat vao mot lua chon kho hon.',
          summary: 'Nhan vat chinh bi ep lua chon giua bao ve dong doi va giu bi mat.',
          key_events: ['doi mat lua chon', 'giu bi mat'],
        },
      ],
    }, {
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        currentChapterCount: 10,
        batchCount: 2,
      },
    });

    expect(validation.hasBlockingIssues).toBe(false);
    const beatMixIssue = validation.issues.find((issue) => issue.code === 'too-fast' && issue.chapterIndex == null);
    if (beatMixIssue) {
      expect(beatMixIssue.severity).toBe('warning');
    }
  });

  it('downgrades late-batch reveal risks to warnings instead of hard blockers', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 11: Truy dau',
          purpose: 'Day nhan vat vao mot huong dieu tra moi.',
          summary: 'Nhan vat chinh theo duoi dau vet va mat them mot manh moi nho.',
          key_events: ['theo dau vet', 'mat manh moi'],
        },
        {
          title: 'Chuong 12: Len nui',
          purpose: 'Day nhan vat den sat cua vao bi mat.',
          summary: 'Nhan vat chinh vuot mot cua ai va nhan ra co nguoi dang che giau su that.',
          key_events: ['vuot cua ai', 'nghi co su that'],
        },
        {
          title: 'Chuong 13: Lo manh moi lon',
          purpose: 'Cho nhan vat thay mot goc nhin moi nhung chua ket luan.',
          summary: 'Nhan vat chinh lo ra mot manh moi lon ve than phan ke dung sau, nhung moi thu van chua nga ngu.',
          key_events: ['lo manh moi lon', 'nghi van tang cao'],
        },
      ],
    }, {
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        currentChapterCount: 10,
        batchCount: 3,
        nextMilestone: { label: 'Midpoint', percent: 50 },
      },
    });

    const tooFastIssue = validation.issues.find((issue) => issue.code === 'too-fast' && issue.chapterIndex === 2);
    expect(tooFastIssue?.severity).toBe('warning');
    expect(validation.hasBlockingIssues).toBe(false);
  });

  it('accepts setup beat mix from slow pacing even without explicit setup keywords', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 11: Khoang lang',
          purpose: 'Cho nhan vat lang lai va can nhac buoc di tiep theo.',
          summary: 'Nhan vat chinh ngoi voi dong doi, can nhac su doi doi vua xay ra va quyet dinh se tiep can nhu the nao.',
          key_events: ['ngoi lai trao doi', 'can nhac buoc di'],
          pacing: 'slow',
        },
        {
          title: 'Chuong 12: Dau vet moi',
          purpose: 'Mo mot huong di tiep theo.',
          summary: 'Nhan vat chinh tim thay dau vet moi va quyet dinh lan theo tung dau hieu nho.',
          key_events: ['tim thay dau vet', 'quyet dinh lan theo'],
        },
      ],
    }, {
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        currentChapterCount: 10,
        batchCount: 2,
      },
    });

    const beatMixIssue = validation.issues.find((issue) => issue.code === 'too-fast' && issue.chapterIndex == null);
    expect(beatMixIssue).toBeUndefined();
    expect(validation.hasBlockingIssues).toBe(false);
  });

  it('injects progress budget and revision context into ARC_OUTLINE prompts', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
      userPrompt: 'Mo rong hanh trinh vao tong mon.',
      startChapterNumber: 11,
      chapterCount: 3,
      arcPacing: 'slow',
      currentMacroArc: {
        title: 'Khoi dong tong mon',
        description: 'Main moi buoc vao vong ngoai.\nMuc tieu & ket qua: Gieo mam su tin cay vao Thu Su; khien doi thu de y den tai nang cua main.\nTinh trang: Thu Su (Tin cay), Doi thu (To mo).',
        chapter_from: 11,
        chapter_to: 30,
      },
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        currentChapterCount: 10,
        batchStartChapter: 11,
        batchEndChapter: 13,
        mainPlotMaxStep: 1,
        romanceMaxStep: 1,
        mysteryRevealAllowance: '0-1 minor reveal',
        powerProgressionCap: 'khong vuot tier lon trong batch nay',
        requiredBeatMix: 'at least one setup/build-up/consequence chapter',
        batchMacroOverlapCount: 3,
        macroSpan: 20,
        chaptersRemainingAfterBatchInMacro: 17,
        macroProgressCap: 'batch nay chi duoc day mot phan cot moc, khong duoc xem nhu da di tron cot moc',
        nextMilestone: { label: 'Vao noi mon', percent: 5 },
      },
      generatedOutline: {
        arc_title: 'Nhap tong mon',
        chapters: [
          { title: 'Chuong 11: Den cong son', summary: 'Main toi cong son va tham do.', key_events: ['tham do son mon'] },
        ],
      },
      outlineRevisionInstruction: 'Lam cham nhip, tang buildup va giu bi mat lon chua lo.',
    });

    expect(messages[0].content).toContain('"purpose"');
    expect(messages[1].content).toContain('[MACRO ARC HIEN TAI]');
    expect(messages[1].content).toContain('[HOP DONG DAI CUC BAT BUOC]');
    expect(messages[1].content).toContain('Khoi dong tong mon');
    expect(messages[1].content).toContain('OBJ1');
    expect(messages[1].content).toContain('[STORY PROGRESS BUDGET]');
    expect(messages[1].content).toContain('Dot nay tao tu Chuong 11 den Chuong 13');
    expect(messages[1].content).toContain('Pham vi tien do batch nay: 1.1% -> 1.4%');
    expect(messages[1].content).toContain('Sau batch nay van con');
    expect(messages[1].content).toContain('[DAN Y HIEN TAI CAN CHINH SUA]');
    expect(messages[1].content).toContain('Purpose:');
    expect(messages[1].content).toContain('[YEU CAU CHINH SUA DAN Y]');
  });

  it('allows revision prompts to change chapter count when the instruction explicitly asks for it', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
      userPrompt: 'Mo rong hanh trinh vao tong mon.',
      startChapterNumber: 11,
      chapterCount: 3,
      generatedOutline: {
        arc_title: 'Nhap tong mon',
        chapters: [
          { title: 'Chuong 11: Den cong son', purpose: 'Tham do cong son', summary: 'Main toi cong son va tham do.', key_events: ['tham do son mon'] },
        ],
      },
      validatorReports: [
        { code: 'too-fast', severity: 'error', chapterIndex: 0, message: 'Chapter co dau hieu day plot/reveal qua nhanh.', inputLabel: 'Noi dung dang thay + rang buoc he thong', relevantFields: ['summary', 'key_events', 'storyProgressBudget'] },
      ],
      outlineRevisionInstruction: 'Chen it nhat 1 chuong dem de lam cham nhip.',
    });

    expect(messages[1].content).toContain('Ban duoc phep tang/giam/chia/gop so chuong');
    expect(messages[1].content).toContain('Nguon: Noi dung dang thay + rang buoc he thong');
  });

  it('injects progress budget into ARC_CHAPTER_DRAFT prompts', () => {
    const macroArcContract = compileMacroArcContract({
      title: 'Arc 1',
      description: 'To Minh xuyen khong vao vu an tau luon.\nMuc tieu & ket qua: Gieo mam tinh cam an toan vao Ran; khoi day su to mo cua Sonoko.\nTinh trang: Ran (Gieo mam), Sonoko (To mo).',
      chapter_from: 10,
      chapter_to: 20,
    });
    const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
      startChapterNumber: 12,
      chapterOutlineTitle: 'Chuong 12: Thu nghiem dau tien',
      chapterOutlinePurpose: 'Cho main hieu mot quy tac nho cua tong mon.',
      chapterOutlineSummary: 'Main chi thu nghiem va va cham nho.',
      chapterOutlineEvents: ['gap doi thu nho', 'thay quy tac tong mon'],
      chapterOutlineObjectiveRefs: ['OBJ1'],
      chapterOutlineStateDelta: 'Ran tang mot nac cam giac an toan, Sonoko chi dung o muc to mo',
      chapterOutlineGuardrail: 'Khong day sang to tinh hay cap doi',
      macroArcContract,
      storyProgressBudget: {
        fromPercent: 1.2,
        toPercent: 1.4,
        currentChapterCount: 11,
        batchStartChapter: 12,
        batchEndChapter: 12,
        mainPlotMaxStep: 1,
        romanceMaxStep: 1,
        mysteryRevealAllowance: '0-1 minor reveal',
        powerProgressionCap: 'khong vuot tier lon trong batch nay',
        requiredBeatMix: 'at least one setup/build-up/consequence chapter',
        macroProgressCap: 'batch nay chi duoc day mot phan cot moc, khong duoc xem nhu da di tron cot moc',
      },
    });

    expect(messages[1].content).toContain('[STORY PROGRESS BUDGET]');
    expect(messages[1].content).toContain('[HOP DONG DAI CUC BAT BUOC]');
    expect(messages[1].content).toContain('Objective refs: OBJ1');
    expect(messages[1].content).toContain('Purpose: Cho main hieu mot quy tac nho cua tong mon.');
    expect(messages[1].content).toContain('Pham vi tien do batch nay: 1.2% -> 1.4%');
    expect(messages[1].content).toContain('Gioi han rieng cua macro arc');
    expect(messages[1].content).toContain('khong resolve tuyen chinh');
  });

  it('blocks outlines that overshoot a low-intensity macro arc contract', () => {
    const macroArcContract = compileMacroArcContract({
      title: 'Arc 1',
      description: 'To Minh xuyen khong vao vu an tren tau luon.\nMuc tieu & ket qua: Gieo mam tinh cam an toan vao Ran; khoi day su to mo cua Sonoko.\nTinh trang: Ran (Gieo mam), Sonoko (To mo).',
      chapter_from: 10,
      chapter_to: 20,
    });

    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 10: Loi hua ben lan can',
          purpose: 'To Minh to tinh voi Ran va cong khai muon o ben co.',
          summary: 'Ran bat dau xac lap tinh cam ro rang, Sonoko bi dat vao the canh tranh tinh cam.',
          key_events: ['to tinh voi Ran', 'Sonoko tham gia tranh gianh tinh cam'],
          objective_refs: ['OBJ1'],
          state_delta: 'Ran tien thang len cap doi ro rang',
          arc_guard_note: 'khong co',
        },
      ],
    }, {
      selectedMacroArc: {
        title: 'Arc 1',
        description: 'To Minh xuyen khong vao vu an tren tau luon.\nMuc tieu & ket qua: Gieo mam tinh cam an toan vao Ran; khoi day su to mo cua Sonoko.\nTinh trang: Ran (Gieo mam), Sonoko (To mo).',
        chapter_from: 10,
        chapter_to: 20,
      },
      macroArcContract,
      storyProgressBudget: {
        fromPercent: 1.0,
        toPercent: 1.1,
        currentChapterCount: 9,
        batchCount: 1,
      },
    });

    expect(validation.hasBlockingIssues).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'macro-state-overshoot')).toBe(true);
  });

  it('injects existing macro milestones and revision guidance into macro milestone prompts', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Dai truyen',
      genre: 'fantasy',
      authorIdea: 'Main di tu lang que den chien tranh toan luc.',
      targetLength: 800,
      planningScopeStart: 120,
      planningScopeEnd: 220,
      ultimateGoal: 'Lat doat ngai vang va pha bo loi nguyen.',
      macroMilestoneCount: 6,
      macroMilestoneRequirements: 'Nhip truyen cham va bam do dai du kien.',
      existingMacroMilestones: [
        {
          order: 1,
          title: 'Khoi hanh',
          description: 'Main roi lang va gap bien co dau tien.',
          chapter_from: 1,
          chapter_to: 80,
          emotional_peak: 'Hao huc va bat an',
          contract_json: serializeMacroArcContract({
            title: 'Khoi hanh',
            chapterFrom: 1,
            chapterTo: 80,
            emotionalPeak: 'Hao huc va bat an',
            narrativeSummary: 'Main roi lang va gap bien co dau tien.',
            objectives: [{ id: 'OBJ1', text: 'Khoi dong hanh trinh', keywords: ['khoi', 'hanh'], focusCharacters: ['Main'] }],
            targetStates: [{ character: 'Main', state: 'roi lang', category: 'general', stageScore: 0 }],
            focusedCharacters: ['Main'],
            maxRelationshipStage: 0,
            forbiddenOutcomes: [],
          }),
        },
      ],
      macroRevisionInstruction: 'Tang buildup phan dau va day midpoint ra xa hon.',
    });

    expect(messages[1].content).toContain('[DAI CUC HIEN TAI / BAN NHAP CAN CHINH SUA]');
    expect(messages[1].content).toContain('[SO LUONG COT MOC CAN TAO]');
    expect(messages[1].content).toContain('6');
    expect(messages[1].content).toContain('[TONG DO DAI TRUYEN DU KIEN]');
    expect(messages[1].content).toContain('[PHAM VI LAP DAI CUC LAN NAY]');
    expect(messages[1].content).toContain('Chuong 120 -> 220');
    expect(messages[1].content).toContain('[YEU CAU RIENG]');
    expect(messages[1].content).toContain('Nhip truyen cham');
    expect(messages[1].content).toContain('Khoi hanh');
    expect(messages[1].content).toContain('Objectives: OBJ1');
    expect(messages[1].content).toContain('[HUONG DAN CHINH SUA]');
    expect(messages[1].content).toContain('Tang buildup phan dau');
  });

  it('separates whole-story length from macro planning scope when generating milestones', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Truyen dai hoi',
      genre: 'fantasy',
      authorIdea: 'Chi lap dai cuc cho mot doan giua truyen.',
      targetLength: 480,
      planningScopeStart: 87,
      planningScopeEnd: 134,
      macroMilestoneCount: 4,
    });

    expect(messages[1].content).toContain('[TONG DO DAI TRUYEN DU KIEN]');
    expect(messages[1].content).toContain('480 chuong');
    expect(messages[1].content).toContain('[PHAM VI LAP DAI CUC LAN NAY]');
    expect(messages[1].content).toContain('Chuong 87 -> 134');
    expect(messages[1].content).toContain('Khong duoc tu y keo nguoc ve chuong 1');
    expect(messages[1].content).toContain('Khong duoc ngam coi pham vi nay la toan bo truyen');
  });

  it('supports optional fixed ranges for individual macro milestones and leaves blank ones on auto', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Truyen dai hoi',
      genre: 'fantasy',
      authorIdea: 'Lap dai cuc cho mot doan con.',
      targetLength: 320,
      planningScopeStart: 41,
      planningScopeEnd: 80,
      macroMilestoneCount: 4,
      macroMilestoneChapterPlans: [
        { chapter_from: 41, chapter_to: 48 },
        null,
        { chapter_from: 61, chapter_to: 70 },
        {},
      ],
    });

    expect(messages[1].content).toContain('[PHAM VI RIENG TUNG COT MOC]');
    expect(messages[1].content).toContain('Cot moc 1: KHOA trong Chuong 41 -> 48');
    expect(messages[1].content).toContain('Cot moc 2: AUTO phan bo');
    expect(messages[1].content).toContain('Cot moc 3: KHOA trong Chuong 61 -> 70');
    expect(messages[1].content).toContain('Cot moc 4: AUTO phan bo');
    expect(messages[1].content).toContain('Nhung cot moc da KHOA pham vi thi phai giu dung chapter range do');
  });

  it('keeps manually selected macro planning start when old milestone ranges start at chapter 1', () => {
    const scope = normalizePlanningScope({
      start: 11,
      end: 120,
      defaults: {
        hasExplicitTargetLength: true,
        safeTarget: 200,
        defaultStart: 11,
        defaultEnd: 200,
      },
      extraLowerBound: 1,
      extraUpperBound: 80,
    });

    expect(scope.start).toBe(11);
    expect(scope.end).toBe(120);
  });

  it('auto-continues macro milestone plan starts from the previous end', () => {
    let plans = updateMilestoneChapterPlanSequence([], {
      milestoneCount: 3,
      index: 0,
      field: 'chapter_to',
      value: '20',
      defaultStart: 11,
    });

    expect(plans[0].chapter_from).toBe('11');
    expect(plans[0].chapter_to).toBe('20');
    expect(plans[1].chapter_from).toBe('21');

    plans = updateMilestoneChapterPlanSequence(plans, {
      milestoneCount: 3,
      index: 1,
      field: 'chapter_to',
      value: '30',
      defaultStart: 11,
    });

    expect(plans[2].chapter_from).toBe('31');

    plans = updateMilestoneChapterPlanSequence(plans, {
      milestoneCount: 3,
      index: 0,
      field: 'chapter_to',
      value: '25',
      defaultStart: 11,
    });

    expect(plans[1].chapter_from).toBe('26');
  });

  it('does not overwrite a manually separated next milestone start', () => {
    const plans = updateMilestoneChapterPlanSequence([
      { chapter_from: '11', chapter_to: '20' },
      { chapter_from: '50', chapter_to: '' },
    ], {
      milestoneCount: 2,
      index: 0,
      field: 'chapter_to',
      value: '25',
      defaultStart: 11,
    });

    expect(plans[1].chapter_from).toBe('50');
  });

  it('auto-continues saved macro arc starts after editing previous end', () => {
    const updated = cascadeSequentialMacroArcStarts([
      { id: 1, chapter_from: 11, chapter_to: 25 },
      { id: 2, chapter_from: 21, chapter_to: 30 },
      { id: 3, chapter_from: 31, chapter_to: 40 },
    ], [20, 30, 40]);

    expect(updated[1].chapter_from).toBe(26);
    expect(updated[2].chapter_from).toBe(31);
  });

  it('keeps manually separated saved macro arc starts', () => {
    const updated = cascadeSequentialMacroArcStarts([
      { id: 1, chapter_from: 11, chapter_to: 25 },
      { id: 2, chapter_from: 50, chapter_to: 60 },
    ], [20, 60]);

    expect(updated[1].chapter_from).toBe(50);
  });

  it('clamps auto-shifted saved macro arc ranges so they never flip chapter_from > chapter_to', () => {
    const updated = cascadeSequentialMacroArcStarts([
      { id: 1, chapter_from: 11, chapter_to: 25 },
      { id: 2, chapter_from: 21, chapter_to: 22 },
    ], [20, 22]);

    expect(updated[1].chapter_from).toBe(26);
    expect(updated[1].chapter_to).toBe(26);
  });

  it('requires contract output when generating macro milestones and prefers stored contract_json', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Truyen moi',
      genre: 'mystery',
      authorIdea: 'Main xam nhap vao vu an tren tau luon.',
      macroMilestoneCount: 4,
    });

    expect(messages[0].content).toContain('"contract"');

    const macroArc = {
      title: 'Arc 1',
      description: 'Mo ta cu nhung se bi bo qua neu contract_json hop le.',
      chapter_from: 10,
      chapter_to: 20,
      contract_json: serializeMacroArcContract({
        title: 'Arc 1',
        chapterFrom: 10,
        chapterTo: 20,
        emotionalPeak: 'Hoi hop',
        narrativeSummary: 'To Minh tao an tuong an toan voi Ran va khien Sonoko to mo.',
        objectives: [{ id: 'OBJ1', text: 'Gieo mam su an toan vao Ran', keywords: ['an', 'toan', 'ran'], focusCharacters: ['Ran'] }],
        targetStates: [{ character: 'Ran', state: 'Gieo mam', category: 'relationship', stageScore: 1 }],
        focusedCharacters: ['Ran', 'Sonoko'],
        maxRelationshipStage: 1,
        forbiddenOutcomes: ['to tinh', 'cap doi'],
      }),
    };

    const contract = compileMacroArcContract(macroArc);
    expect(contract?.narrativeSummary).toContain('To Minh tao an tuong an toan');
    expect(contract?.forbiddenOutcomes).toContain('to tinh');
  });

  it('builds a dedicated AI analysis prompt for one macro arc contract', () => {
    const messages = buildPrompt(TASK_TYPES.ANALYZE_MACRO_CONTRACT, {
      projectTitle: 'Truyen moi',
      genre: 'fantasy',
      ultimateGoal: 'Main song sot va leo len vi tri cao hon.',
      currentMacroArc: {
        title: 'Khoi dong tong mon',
        description: 'Main buoc vao tong mon.\nMuc tieu & ket qua: Gieo mam su tin cay vao A; khien B to mo.\nTinh trang: A (Tin cay), B (To mo).',
        chapter_from: 10,
        chapter_to: 20,
      },
    });

    expect(messages[0].content).toContain('"contract"');
    expect(messages[1].content).toContain('[COT MOC DAI CUC CAN PHAN TICH]');
    expect(messages[1].content).toContain('Khoi dong tong mon');
    expect(messages[1].content).toContain('Gieo mam su tin cay vao A');
  });

  it('parses focus_characters from AI macro arc contracts', () => {
    const contract = compileMacroArcContract({
      title: 'Arc 1',
      description: 'Mo ta khac',
      contract: {
        narrative_summary: 'Tom tat',
        objectives: [
          { id: 'OBJ1', text: 'Bao ve A va khien B to mo', focus_characters: ['A', 'B'] },
        ],
        target_states: [
          { character: 'A', state: 'Tin cay' },
        ],
        focused_characters: ['A', 'B'],
        forbidden_outcomes: ['to tinh'],
        max_relationship_stage: 1,
      },
    });

    expect(contract?.objectives?.[0]?.focusCharacters).toEqual(['A', 'B']);
    expect(contract?.focusedCharacters).toEqual(['A', 'B']);
  });

  it('serializes and parses chapter anchors from macro arc contracts', () => {
    const serialized = serializeMacroArcContract({
      title: 'Arc neo chapter',
      chapterFrom: 20,
      chapterTo: 30,
      emotionalPeak: '',
      narrativeSummary: 'Chuan bi cho mot bien co dung chuong.',
      objectives: [],
      targetStates: [],
      focusedCharacters: [],
      maxRelationshipStage: 0,
      forbiddenOutcomes: [],
      chapterAnchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          objectiveRefs: ['OBJ1'],
          focusCharacters: ['Main', 'Nu A'],
          successSignals: ['gap Nu A'],
          forbidBefore: true,
          notes: '',
        },
      ],
    });

    const parsed = parseStoredMacroArcContract({
      title: 'Arc neo chapter',
      chapter_from: 20,
      chapter_to: 30,
      contract_json: serialized,
    });

    expect(parsed?.chapterAnchors).toHaveLength(1);
    expect(parsed?.chapterAnchors?.[0]?.targetChapter).toBe(25);
    expect(parsed?.chapterAnchors?.[0]?.strictness).toBe('hard');
    expect(parsed?.chapterAnchors?.[0]?.requirementText).toContain('Main phai gap Nu A');
  });

  it('upgrades legacy anchor ids and keeps overlapping anchors from different macro arcs', () => {
    const collected = collectBatchChapterAnchors([
      normalizeMacroMilestoneItem({
        id: 101,
        title: 'Arc A',
        description: 'Mo ta A',
        chapter_from: 20,
        chapter_to: 26,
        chapter_anchors: [
          { id: 'ANCHOR1', targetChapter: 25, strictness: 'hard', requirementText: 'Main gap Nu A' },
        ],
      }),
      normalizeMacroMilestoneItem({
        id: 202,
        title: 'Arc B',
        description: 'Mo ta B',
        chapter_from: 24,
        chapter_to: 30,
        chapter_anchors: [
          { id: 'ANCHOR1', targetChapter: 25, strictness: 'hard', requirementText: 'Main mat bi kip' },
        ],
      }),
    ], 24, 25);

    expect(collected).toHaveLength(2);
    expect(collected[0].id).not.toBe('ANCHOR1');
    expect(collected[1].id).not.toBe('ANCHOR1');
    expect(collected[0].id).not.toBe(collected[1].id);
    expect(collected.map((item) => item.sourceMacroArcId)).toEqual([101, 202]);
  });

  it('treats top-level chapter_anchors as authoritative even when empty', () => {
    const staleContractJson = serializeMacroArcContract({
      title: 'Arc stale',
      chapterFrom: 20,
      chapterTo: 30,
      emotionalPeak: '',
      narrativeSummary: 'Contract cu',
      objectives: [],
      targetStates: [],
      focusedCharacters: [],
      maxRelationshipStage: 0,
      forbiddenOutcomes: [],
      chapterAnchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Contract cu van con anchor',
          objectiveRefs: [],
          focusCharacters: [],
          successSignals: [],
          forbidBefore: true,
          notes: '',
        },
      ],
    });

    const contract = compileMacroArcContract({
      title: 'Arc stale',
      description: 'Da xoa het anchor',
      chapter_from: 20,
      chapter_to: 30,
      chapter_anchors: [],
      contract_json: staleContractJson,
    });

    expect(contract?.chapterAnchors || []).toEqual([]);
  });

  it('builds persistence snapshots that keep invalid raw anchors without reviving old contract state', () => {
    const snapshot = buildMacroArcPersistenceSnapshot({
      title: 'Arc persist',
      description: 'Mo ta moi',
      chapter_from: 20,
      chapter_to: 30,
      chapter_anchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 0,
          strictness: 'hard',
          requirementText: '',
          focusCharacters: ['Main'],
        },
      ],
      contract_json: serializeMacroArcContract({
        title: 'Arc persist',
        chapterFrom: 20,
        chapterTo: 30,
        emotionalPeak: '',
        narrativeSummary: 'Contract cu',
        objectives: [],
        targetStates: [],
        focusedCharacters: [],
        maxRelationshipStage: 0,
        forbiddenOutcomes: [],
        chapterAnchors: [
          {
            id: 'ANCHOR1',
            targetChapter: 25,
            strictness: 'hard',
            requirementText: 'Contract cu',
            objectiveRefs: [],
            focusCharacters: [],
            successSignals: [],
            forbidBefore: true,
            notes: '',
          },
        ],
      }),
    });
    const mirrored = JSON.parse(snapshot.contract_json);
    const compiled = compileMacroArcContract(snapshot);

    expect(snapshot.chapter_anchors).toHaveLength(1);
    expect(snapshot.chapter_anchors[0].id).toMatch(/^anchor_/);
    expect(mirrored.chapter_anchors).toHaveLength(1);
    expect(mirrored.chapter_anchors[0].id).toBe(snapshot.chapter_anchors[0].id);
    expect(mirrored.chapter_anchors[0].target_chapter).toBe(0);
    expect(mirrored.chapter_anchors[0].requirement_text).toBe('');
    expect(compiled?.chapterAnchors || []).toEqual([]);
  });

  it('flags incomplete raw chapter anchors even when executable contract drops them', () => {
    const macroArc = {
      title: 'Arc invalid anchor',
      description: 'Mo ta moi',
      chapter_from: 20,
      chapter_to: 30,
      chapter_anchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 0,
          strictness: 'hard',
          requirementText: '',
          focusCharacters: ['Main'],
        },
      ],
    };

    const issues = validateMacroArcChapterAnchors(macroArc);
    const compiled = compileMacroArcContract(macroArc);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'anchor-incomplete',
        severity: 'error',
      }),
    ]);
    expect(compiled?.chapterAnchors || []).toEqual([]);
  });

  it('flags raw hard anchors outside the macro range', () => {
    const issues = validateMacroArcChapterAnchors({
      title: 'Arc out of range',
      description: 'Mo ta moi',
      chapter_from: 20,
      chapter_to: 30,
      chapter_anchors: [
        {
          id: 'anchor_existing_out_of_range',
          targetChapter: 35,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
        },
      ],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'anchor-out-of-range',
        severity: 'error',
        anchorId: 'anchor_existing_out_of_range',
      }),
    ]);
  });

  it('rebuilds contract mirror from current description instead of reusing stale contract_json', () => {
    const snapshot = buildMacroArcPersistenceSnapshot({
      title: 'Arc mirror',
      description: 'Mo ta moi hoan toan.\nMuc tieu & ket qua: Main nghi ngo Su Ty; Buoc vao vet nut dau tien.\nTinh trang: Main (To mo).',
      chapter_from: 20,
      chapter_to: 30,
      chapter_anchors: [],
      contract_json: serializeMacroArcContract({
        title: 'Arc mirror',
        chapterFrom: 20,
        chapterTo: 30,
        emotionalPeak: 'Cu',
        narrativeSummary: 'Noi dung cu khong duoc giu lai',
        objectives: [{ id: 'OBJ1', text: 'Muc tieu cu', keywords: ['cu'], focusCharacters: [] }],
        targetStates: [{ character: 'Main', state: 'Tin cay', category: 'trust', stageScore: 1 }],
        focusedCharacters: ['Main'],
        maxRelationshipStage: 1,
        forbiddenOutcomes: ['to tinh'],
      }),
    });
    const mirrored = JSON.parse(snapshot.contract_json);

    expect(mirrored.narrative_summary).toContain('Mo ta moi hoan toan');
    expect(mirrored.narrative_summary).not.toContain('Noi dung cu khong duoc giu lai');
    expect((mirrored.objectives || []).some((item) => String(item.text || '').includes('Muc tieu cu'))).toBe(false);
  });

  it('clamps invalid chapter ranges before persisting macro arcs', () => {
    const snapshot = buildMacroArcPersistenceSnapshot({
      title: 'Arc invalid range',
      description: 'Mo ta',
      chapter_from: 26,
      chapter_to: 22,
      chapter_anchors: [],
      contract_json: '',
    });

    expect(snapshot.chapter_from).toBe(26);
    expect(snapshot.chapter_to).toBe(26);
    expect(JSON.parse(snapshot.contract_json)).toEqual(expect.objectContaining({
      chapter_from: 26,
      chapter_to: 26,
    }));
  });

  it('parses legacy boolean-like values for chapter anchors without coercing "false" to true', () => {
    expect(normalizeBoolean(false, true)).toBe(false);
    expect(normalizeBoolean(true, false)).toBe(true);
    expect(normalizeBoolean('false', true)).toBe(false);
    expect(normalizeBoolean('true', false)).toBe(true);
    expect(normalizeBoolean(0, true)).toBe(false);
    expect(normalizeBoolean(1, false)).toBe(true);
    expect(normalizeBoolean('0', true)).toBe(false);
    expect(normalizeBoolean('1', false)).toBe(true);
    expect(normalizeBoolean(null, true)).toBe(true);
    expect(normalizeBoolean(undefined, false)).toBe(false);
  });

  it('preserves existing stable ids for equivalent anchors after analyze-like normalization', () => {
    const reconciled = preserveChapterAnchorIds(
      [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
        {
          targetChapter: 27,
          strictness: 'soft',
          requirementText: 'Main bat dau nghi ngo Su Ty',
          focusCharacters: ['Main'],
          forbidBefore: false,
        },
      ],
      [
        {
          id: 'anchor_existing_1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          focusCharacters: ['Nu A', 'Main'],
          forbidBefore: true,
        },
        {
          id: 'anchor_existing_2',
          targetChapter: 27,
          strictness: 'soft',
          requirementText: 'Main bat dau nghi ngo Su Ty',
          focusCharacters: ['Main'],
          forbidBefore: false,
        },
      ],
    );

    expect(reconciled[0].id).toBe('anchor_existing_1');
    expect(reconciled[1].id).toBe('anchor_existing_2');
  });

  it('injects structured chapter anchor input into macro milestone prompts', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Truyen neo chapter',
      authorIdea: 'Lap dai cuc cho batch giua truyen.',
      planningScopeStart: 20,
      planningScopeEnd: 30,
      macroMilestoneCount: 3,
      macroChapterAnchorInputs: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
    });

    expect(messages[1].content).toContain('[YEU CAU BAT BUOC THEO CHUONG]');
    expect(messages[1].content).toContain('ANCHOR1');
    expect(messages[1].content).toContain('Chuong 25');
    expect(messages[1].content).toContain('Main phai gap Nu A');
  });

  it('injects batch chapter anchors into ARC_OUTLINE prompts', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
      userPrompt: 'Day batch tiep theo.',
      startChapterNumber: 20,
      chapterCount: 6,
      batchChapterAnchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
    });

    expect(messages[1].content).toContain('[CHAPTER ANCHORS BAT BUOC TRONG BATCH]');
    expect(messages[1].content).toContain('ANCHOR1');
    expect(messages[1].content).toContain('Chuong 25');
  });

  it('injects chapter anchor refs and guard blocks into ARC_CHAPTER_DRAFT prompts', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
      startChapterNumber: 25,
      chapterOutlineTitle: 'Chuong 25: Cuoc gap',
      chapterOutlineSummary: 'Main cuoi cung gap Nu A.',
      chapterOutlineAnchorRefs: ['ANCHOR1'],
      currentChapterAnchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main phai gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
      futureChapterAnchors: [
        {
          id: 'ANCHOR2',
          targetChapter: 26,
          strictness: 'hard',
          requirementText: 'Chua duoc to tinh',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
    });

    expect(messages[1].content).toContain('Anchor refs: ANCHOR1');
    expect(messages[1].content).toContain('[ANCHOR BAT BUOC CHO CHUONG NAY]');
    expect(messages[1].content).toContain('[ANCHOR CHUA DEN HAN]');
  });

  it('blocks outlines that miss or trigger hard anchors in the wrong chapter', () => {
    const validation = validateGeneratedOutline({
      chapters: [
        {
          title: 'Chuong 20: Som',
          purpose: 'Main gap Nu A qua som.',
          summary: 'Main gap Nu A ngay dau batch.',
          key_events: ['Main gap Nu A'],
          anchor_refs: ['ANCHOR1'],
        },
        {
          title: 'Chuong 21: Chuyen tiep',
          purpose: 'Chuyen tiep',
          summary: 'Chua co gi lon.',
          key_events: ['di chuyen'],
        },
        {
          title: 'Chuong 22: Chuyen tiep',
          purpose: 'Chuyen tiep',
          summary: 'Chua co gi lon.',
          key_events: ['tham do'],
        },
        {
          title: 'Chuong 23: Chuyen tiep',
          purpose: 'Chuyen tiep',
          summary: 'Chua co gi lon.',
          key_events: ['tham do'],
        },
        {
          title: 'Chuong 24: Chuyen tiep',
          purpose: 'Chuyen tiep',
          summary: 'Chua co gi lon.',
          key_events: ['tham do'],
        },
        {
          title: 'Chuong 25: Lech hen',
          purpose: 'Main lam viec khac.',
          summary: 'Main van chua gap Nu A.',
          key_events: ['lam viec khac'],
          anchor_refs: [],
        },
      ],
    }, {
      startChapterNumber: 20,
      batchChapterAnchors: [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
    });

    expect(validation.hasBlockingIssues).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'hard-anchor-early')).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'hard-anchor-missed')).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'hard-anchor-missing-ref')).toBe(true);
  });

  it('validates draft text against current and future chapter anchors', () => {
    const missingAtTarget = validateDraftAgainstChapterAnchors(
      { title: 'Chuong 25', content: 'Main van di mot minh.' },
      [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
      { currentChapterNumber: 25 },
    );
    const earlyBeforeTarget = validateDraftAgainstChapterAnchors(
      { title: 'Chuong 24', content: 'Main gap Nu A ngay trong dem.' },
      [
        {
          id: 'ANCHOR1',
          targetChapter: 25,
          strictness: 'hard',
          requirementText: 'Main gap Nu A',
          focusCharacters: ['Main', 'Nu A'],
          forbidBefore: true,
        },
      ],
      { currentChapterNumber: 24 },
    );

    expect(missingAtTarget.some((issue) => issue.code === 'hard-anchor-missed')).toBe(true);
    expect(earlyBeforeTarget.some((issue) => issue.code === 'hard-anchor-early')).toBe(true);
  });
});
