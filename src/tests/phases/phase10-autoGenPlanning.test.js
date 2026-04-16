import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { TASK_TYPES } from '../../services/ai/router';
import {
  recommendArcBatchCount,
  buildStoryProgressBudget,
  buildDraftQueue,
  validateGeneratedOutline,
} from '../../stores/arcGenerationStore';

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
      selectedMacroArc: { title: 'Khoi dong', chapter_to: 40 },
      milestones: [{ label: 'Midpoint', percent: 50 }],
    });

    expect(budget.fromPercent).toBe(1);
    expect(budget.toPercent).toBe(1.3);
    expect(budget.mainPlotMaxStep).toBe(1);
    expect(budget.requiredBeatMix).toContain('setup');
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

  it('injects progress budget and revision context into ARC_OUTLINE prompts', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
      userPrompt: 'Mo rong hanh trinh vao tong mon.',
      startChapterNumber: 11,
      chapterCount: 3,
      arcPacing: 'slow',
      currentMacroArc: {
        title: 'Khoi dong tong mon',
        description: 'Main moi buoc vao vong ngoai.',
        chapter_from: 11,
        chapter_to: 30,
      },
      storyProgressBudget: {
        fromPercent: 1.1,
        toPercent: 1.4,
        mainPlotMaxStep: 1,
        romanceMaxStep: 1,
        mysteryRevealAllowance: '0-1 minor reveal',
        powerProgressionCap: 'khong vuot tier lon trong batch nay',
        requiredBeatMix: 'at least one setup/build-up/consequence chapter',
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

    expect(messages[1].content).toContain('[MACRO ARC HIEN TAI]');
    expect(messages[1].content).toContain('Khoi dong tong mon');
    expect(messages[1].content).toContain('[STORY PROGRESS BUDGET]');
    expect(messages[1].content).toContain('Pham vi tien do batch nay: 1.1% -> 1.4%');
    expect(messages[1].content).toContain('[DAN Y HIEN TAI CAN CHINH SUA]');
    expect(messages[1].content).toContain('[YEU CAU CHINH SUA DAN Y]');
  });

  it('injects progress budget into ARC_CHAPTER_DRAFT prompts', () => {
    const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
      startChapterNumber: 12,
      chapterOutlineTitle: 'Chuong 12: Thu nghiem dau tien',
      chapterOutlineSummary: 'Main chi thu nghiem va va cham nho.',
      chapterOutlineEvents: ['gap doi thu nho', 'thay quy tac tong mon'],
      storyProgressBudget: {
        fromPercent: 1.2,
        toPercent: 1.4,
        mainPlotMaxStep: 1,
        romanceMaxStep: 1,
        mysteryRevealAllowance: '0-1 minor reveal',
        powerProgressionCap: 'khong vuot tier lon trong batch nay',
        requiredBeatMix: 'at least one setup/build-up/consequence chapter',
      },
    });

    expect(messages[1].content).toContain('[STORY PROGRESS BUDGET]');
    expect(messages[1].content).toContain('Pham vi tien do batch nay: 1.2% -> 1.4%');
    expect(messages[1].content).toContain('khong resolve tuyen chinh');
  });

  it('injects existing macro milestones and revision guidance into macro milestone prompts', () => {
    const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
      projectTitle: 'Dai truyen',
      genre: 'fantasy',
      authorIdea: 'Main di tu lang que den chien tranh toan luc.',
      targetLength: 800,
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
        },
      ],
      macroRevisionInstruction: 'Tang buildup phan dau va day midpoint ra xa hon.',
    });

    expect(messages[1].content).toContain('[DAI CUC HIEN TAI / BAN NHAP CAN CHINH SUA]');
    expect(messages[1].content).toContain('[SO LUONG COT MOC CAN TAO]');
    expect(messages[1].content).toContain('6');
    expect(messages[1].content).toContain('[YEU CAU RIENG]');
    expect(messages[1].content).toContain('Nhip truyen cham');
    expect(messages[1].content).toContain('Khoi hanh');
    expect(messages[1].content).toContain('[HUONG DAN CHINH SUA]');
    expect(messages[1].content).toContain('Tang buildup phan dau');
  });
});
