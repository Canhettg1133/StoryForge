import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  aiServiceMock,
  dbMock,
  projectStoreState,
  gatherContextMock,
} = vi.hoisted(() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createCollection(tableName, state) {
    return {
      where(field) {
        return {
          equals(expected) {
            const filtered = () => state[tableName].filter((row) => row?.[field] === expected);
            return {
              async toArray() {
                return clone(filtered());
              },
              async sortBy(sortField) {
                return clone(
                  filtered().sort((left, right) => (Number(left?.[sortField]) || 0) - (Number(right?.[sortField]) || 0)),
                );
              },
              async first() {
                return clone(filtered()[0] || null);
              },
            };
          },
        };
      },
      async add(row) {
        const nextId = state[tableName].reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0) + 1;
        const nextRow = { ...clone(row), id: row?.id || nextId };
        state[tableName].push(nextRow);
        return nextRow.id;
      },
      async update(id, payload) {
        const index = state[tableName].findIndex((row) => row.id === id);
        if (index < 0) return 0;
        state[tableName][index] = {
          ...state[tableName][index],
          ...clone(payload),
        };
        return 1;
      },
      async get(id) {
        return clone(state[tableName].find((row) => row.id === id) || null);
      },
    };
  }

  const state = {
    projects: [],
    chapters: [],
    chapterMeta: [],
    macro_arcs: [],
    arcs: [],
    scenes: [],
  };

  return {
    aiServiceMock: {
      setRouter: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
    },
    dbMock: {
      projects: {
        async get(id) {
          return clone(state.projects.find((row) => row.id === id) || null);
        },
        async update(id, payload) {
          const index = state.projects.findIndex((row) => row.id === id);
          if (index < 0) return 0;
          state.projects[index] = { ...state.projects[index], ...clone(payload) };
          return 1;
        },
      },
      chapters: createCollection('chapters', state),
      chapterMeta: createCollection('chapterMeta', state),
      macro_arcs: createCollection('macro_arcs', state),
      arcs: createCollection('arcs', state),
      scenes: createCollection('scenes', state),
      __reset(seed = {}) {
        state.projects = clone(seed.projects || []);
        state.chapters = clone(seed.chapters || []);
        state.chapterMeta = clone(seed.chapterMeta || []);
        state.macro_arcs = clone(seed.macro_arcs || []);
        state.arcs = clone(seed.arcs || []);
        state.scenes = clone(seed.scenes || []);
      },
      __rows(tableName) {
        return clone(state[tableName] || []);
      },
    },
    projectStoreState: {
      chapters: [],
      loadProject: vi.fn(async () => {}),
    },
    gatherContextMock: vi.fn(async () => ({
      targetLength: 120,
      milestones: [],
      currentMacroArc: null,
      allCharacters: [],
    })),
  };
});

vi.mock('../../services/ai/client.js', () => ({
  default: aiServiceMock,
}));

vi.mock('../../services/db/database.js', () => ({
  default: dbMock,
}));

vi.mock('../../stores/projectStore.js', () => ({
  default: {
    getState: () => projectStoreState,
  },
}));

vi.mock('../../services/ai/contextEngine.js', () => ({
  gatherContext: gatherContextMock,
}));

import useArcGenStore, {
  validateGeneratedOutline,
} from '../../stores/arcGenerationStore';
import { compileMacroArcContract } from '../../services/ai/macroArcContract';

const initialArcGenState = useArcGenStore.getState();

function buildExistingChapters(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    project_id: 1,
    order_index: index,
    title: `Chuong ${index + 1}`,
    status: 'draft',
  }));
}

function buildSlowOutline() {
  return {
    arc_title: 'Arc cham lai',
    chapters: [
      {
        title: 'Chuong 11: Tham do',
        purpose: 'Main tham do tung dau vet nho quanh tong mon.',
        summary: 'Main tham do vung ngoai tong mon, thay mot dau vet la nhung chua ket luan gi.',
        key_events: ['tham do vung ngoai', 'thay dau vet la'],
      },
      {
        title: 'Chuong 12: Ban bac',
        purpose: 'Main ban bac voi dong doi ve huong dieu tra tiep theo.',
        summary: 'Main ban bac voi dong doi, doi chieu manh moi va quyet dinh di cham de tranh lo than phan ke dung sau.',
        key_events: ['ban bac voi dong doi', 'quyet dinh dieu tra cham'],
      },
    ],
  };
}

function buildTooFastOutline() {
  return {
    arc_title: 'Arc qua nhanh',
    chapters: [
      {
        title: 'Chuong 11: Lo bi mat lon',
        purpose: 'Main tiet lo bi mat lon va dong thread ngay lap tuc.',
        summary: 'Main tiet lo bi mat lon, xac nhan hung thu va giai quyet thread chinh ngay trong chuong dau batch.',
        key_events: ['tiet lo bi mat lon', 'giai quyet thread chinh'],
      },
      {
        title: 'Chuong 12: Rut lui',
        purpose: 'Main thu don dep hau qua sau tiet lo.',
        summary: 'Main thu don dep hau qua sau khi su that lon da bi lo.',
        key_events: ['thu don dep hau qua'],
      },
    ],
  };
}

function buildCausalOutline() {
  return {
    arc_title: 'Arc nhan qua',
    chapters: [
      {
        title: 'Chuong 11: Vet thuong trong suong',
        purpose: 'Dat Lam Mac vao mot lua chon sinh ton co gia.',
        summary: 'Lam Mac tinh lai trong suong doc va phai chon giua an minh hoac cuu dong doi.',
        opening_state: 'Lam Mac bi thuong va mat phuong huong.',
        continuity_in: { response: '' },
        conflict: 'Lam Mac muon tranh bi truy sat nhung dong doi dang bi bao vay.',
        key_events: ['Lam Mac an minh', 'Dong doi bi bao vay'],
        decision_or_consequence: 'Lam Mac lo dau vet de ke dich nhan ra anh con song.',
        state_changes: [
          { subject: 'Lam Mac', change: 'Bi lo dau vet sinh ton va mat loi the an than.' },
        ],
        ending_state: 'Ke dich biet Lam Mac con song va bat dau sieu chat vong vay.',
        continuity_out: { text: 'Vong vay sieu chat ep Lam Mac phai doi cach tron thoat.' },
        pacing: 'slow',
      },
      {
        title: 'Chuong 12: Duong lui bi khoa',
        purpose: 'Bien he qua bi lo dau vet thanh ap luc moi.',
        summary: 'Lam Mac tim duong lui nhung ke dich da khoa het loi ra sau dau vet chuong truoc.',
        opening_state: 'Lam Mac bi ep vao khu rung hep.',
        continuity_in: { response: 'Vong vay tu chuong truoc khien moi duong lui deu bi khoa.' },
        conflict: 'Lam Mac muon thoat than nhung phai giu dong doi khong bi bat.',
        key_events: ['phat hien loi ra bi khoa', 'danh lac huong ke dich'],
        decision_or_consequence: 'Lam Mac hy sinh vat pham che giau than phan.',
        state_changes: [
          { subject: 'Vat pham che giau than phan', change: 'Bi tieu hao de doi lay mot khoang trong thoat than.' },
        ],
        ending_state: 'Lam Mac thoat khoi vong vay tam thoi nhung khong con vat pham che giau.',
        continuity_out: { text: '' },
        pacing: 'medium',
      },
    ],
  };
}

function buildGuardedMacroArc() {
  return {
    id: 501,
    title: 'Khoi dong tong mon',
    description: 'Main moi buoc vao tong mon.\nMuc tieu & ket qua: Gieo mam su tin cay, chi duoc buildup va manh moi nho.\nTinh trang: Nu chinh (Gieo mam).',
    chapter_from: 11,
    chapter_to: 30,
  };
}

function buildValidationContext() {
  return {
    storyProgressBudget: {
      fromPercent: 1.1,
      toPercent: 1.3,
      currentChapterCount: 10,
      batchStartChapter: 11,
      batchEndChapter: 12,
      batchCount: 2,
      nextMilestone: { label: 'Midpoint', percent: 50 },
    },
    startChapterNumber: 11,
  };
}

describe('phase10 arc outline revision flow', () => {
  beforeEach(() => {
    dbMock.__reset({
      projects: [{ id: 1, updated_at: 0, target_length: 120, milestones: '[]' }],
      macro_arcs: [],
    });
    projectStoreState.chapters = buildExistingChapters(10);
    projectStoreState.loadProject.mockClear();
    aiServiceMock.send.mockReset();
    gatherContextMock.mockClear();
    useArcGenStore.setState(initialArcGenState, true);
  });

  it('defaults to outline review mode when initializing arc generation', async () => {
    await useArcGenStore.getState().initializeArcGeneration({
      projectId: 1,
      currentChapterCount: 10,
    });

    expect(useArcGenStore.getState().outputMode).toBe('outline_review');
  });

  it('keeps outline and generated chapter drafting on the selected proxy model', async () => {
    dbMock.__reset({
      projects: [{ id: 1, updated_at: 0, target_length: 120, milestones: '[]' }],
      chapters: buildExistingChapters(10),
      chapterMeta: [],
      macro_arcs: [],
    });
    projectStoreState.chapters = buildExistingChapters(10);
    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      arcGoal: 'Build the next investigation arc.',
      arcChapterCount: 2,
      outputMode: 'outline_review',
    });

    aiServiceMock.send.mockImplementationOnce(({ onComplete }) => {
      onComplete(JSON.stringify(buildSlowOutline()));
    });

    await useArcGenStore.getState().generateOutline({
      projectId: 1,
      chapterIndex: 10,
      genre: 'fantasy',
    });

    expect(aiServiceMock.send).toHaveBeenCalledTimes(1);
    expect(aiServiceMock.send.mock.calls[0][0].routeOptions?.useProxyQualityRouting).not.toBe(true);

    aiServiceMock.send.mockReset();
    aiServiceMock.send.mockImplementation(({ onComplete }) => {
      onComplete('Draft text for the generated chapter. It follows the outline and keeps the branch focused.');
    });

    const started = await useArcGenStore.getState().startBatchDraft({
      projectId: 1,
      genre: 'fantasy',
      startingChapterIndex: 10,
    });

    expect(started).toBe(true);
    expect(aiServiceMock.send).toHaveBeenCalled();
    aiServiceMock.send.mock.calls.forEach(([options]) => {
      expect(options.routeOptions?.useProxyQualityRouting).not.toBe(true);
    });
  });

  it('keeps generated outlines ready when later chapters include handoff text', async () => {
    dbMock.__reset({
      projects: [{ id: 1, updated_at: 0, target_length: 120, milestones: '[]' }],
      chapters: buildExistingChapters(52),
      chapterMeta: [],
      macro_arcs: [],
    });
    projectStoreState.chapters = buildExistingChapters(52);
    useArcGenStore.setState({
      currentChapterCount: 52,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      arcGoal: 'Tiep noi hau qua tam ly sau mot loi the bi ep buoc.',
      arcChapterCount: 2,
      outputMode: 'outline_review',
    });

    aiServiceMock.send.mockImplementationOnce(({ onComplete }) => {
      onComplete(JSON.stringify({
        arc_title: 'Vong xoay toi loi va suong mu',
        chapters: [
          {
            title: 'Chuong 53: Loi the bat luc',
            purpose: 'Lam ro hau qua tam ly cua Lam Mac sau khi bi Diep Ninh rang buoc.',
            summary: 'Lam Mac tinh day trong mac cam va chap nhan giu bi mat cho Diep Ninh.',
            key_events: ['Lam Mac mac cam toi loi', 'Diep Ninh ep anh giu bi mat'],
            ending_state: 'Lam Mac bi rang buoc tam ly voi Diep Ninh va tro thanh dong pham bat dac di.',
            state_delta: 'Lam Mac mat duong lui va bi keo sau hon vao bi mat cua lang.',
          },
          {
            title: 'Chuong 54: Am anh sau loi the',
            purpose: 'Cho Lam Mac vat lon voi loi the va su le thuoc moi.',
            summary: 'Lam Mac roi khoi Diep Ninh, bi am anh boi bi mat va thay dan lang dang nghi ngo.',
            key_events: ['Lam Mac bi am anh', 'Dan lang nhin anh day nghi ngo'],
            handoff_from_previous: 'Sau khi bi rang buoc voi Diep Ninh va chap nhan lam dong pham bat dac di, Lam Mac roi di trong mac cam.',
          },
        ],
      }));
    });

    await useArcGenStore.getState().generateOutline({
      projectId: 1,
      chapterIndex: 52,
      genre: 'psychological horror',
    });

    const nextState = useArcGenStore.getState();
    expect(nextState.outlineStatus).toBe('ready');
    expect(nextState.generatedOutline.chapters).toHaveLength(2);
    expect(nextState.generatedOutline.chapters[1].continuity_in).toEqual({
      response: 'Sau khi bi rang buoc voi Diep Ninh va chap nhan lam dong pham bat dac di, Lam Mac roi di trong mac cam.',
    });
    expect(nextState.generatedOutline.chapters[0].state_delta).toBe('Lam Mac mat duong lui va bi keo sau hon vao bi mat cua lang.');
    expect(nextState.outlineValidation.issues.some((issue) => issue.code === 'chapter-handoff-weak')).toBe(false);
  });

  it('force-saves outline even when blocking issues remain', async () => {
    const macroArc = buildGuardedMacroArc();
    const validationContext = buildValidationContext();
    const generatedOutline = buildTooFastOutline();
    const macroArcContract = compileMacroArcContract(macroArc);
    const outlineValidation = validateGeneratedOutline(generatedOutline, {
      ...validationContext,
      selectedMacroArc: macroArc,
      macroArcContract,
    });

    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [macroArc],
      selectedMacroArcId: macroArc.id,
      currentMacroArcId: macroArc.id,
      generatedOutline,
      macroArcContract,
      storyProgressBudget: validationContext.storyProgressBudget,
      outlineValidation,
      batchChapterAnchors: [],
      selectedDraftIndexes: [0],
    });

    const blocked = await useArcGenStore.getState().commitOutlineOnly(1);
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe('blocked');
    expect(dbMock.__rows('chapters')).toHaveLength(0);

    const forced = await useArcGenStore.getState().commitOutlineOnly(1, { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.status).toBe('saved');
    expect(forced.forced).toBe(true);
    expect(dbMock.__rows('chapters')).toHaveLength(2);
    expect(dbMock.__rows('scenes')).toHaveLength(2);
  });

  it('persists causal outline metadata when saving outline-only chapters', async () => {
    const generatedOutline = buildCausalOutline();
    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      arcGoal: 'Kiem tra luu metadata nhan qua.',
      generatedOutline,
      storyProgressBudget: buildValidationContext().storyProgressBudget,
      outlineValidation: { issues: [], hasBlockingIssues: false },
      batchChapterAnchors: [],
      selectedDraftIndexes: [0],
    });

    const saved = await useArcGenStore.getState().commitOutlineOnly(1);
    expect(saved.ok).toBe(true);

    const [firstChapter] = dbMock.__rows('chapters');
    expect(firstChapter).toEqual(expect.objectContaining({
      conflict: 'Lam Mac muon tranh bi truy sat nhung dong doi dang bi bao vay.',
      decision_or_consequence: 'Lam Mac lo dau vet de ke dich nhan ra anh con song.',
      pacing: 'slow',
      state_delta: 'Lam Mac: Bi lo dau vet sinh ton va mat loi the an than.',
    }));
    expect(firstChapter.continuity_in).toEqual({ response: '' });
    expect(firstChapter.continuity_out).toEqual({ text: 'Vong vay sieu chat ep Lam Mac phai doi cach tron thoat.' });
    expect(firstChapter.state_changes).toEqual([
      { subject: 'Lam Mac', change: 'Bi lo dau vet sinh ton va mat loi the an than.' },
    ]);
  });

  it('persists causal outline metadata when saving generated drafts', async () => {
    const generatedOutline = buildCausalOutline();
    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      arcGoal: 'Kiem tra luu ban nhap nhan qua.',
      generatedOutline,
      storyProgressBudget: buildValidationContext().storyProgressBudget,
      outlineValidation: { issues: [], hasBlockingIssues: false },
      batchChapterAnchors: [],
      selectedDraftIndexes: [0],
      draftResults: [
        {
          outlineIndex: 0,
          title: 'Chuong 11: Vet thuong trong suong',
          status: 'done',
          content: 'Ban nhap chuong 11.',
          wordCount: 1200,
        },
      ],
    });

    const saved = await useArcGenStore.getState().commitDraftsToProject(1);
    expect(saved).toBe(true);

    const [firstChapter] = dbMock.__rows('chapters');
    expect(firstChapter).toEqual(expect.objectContaining({
      status: 'draft',
      conflict: 'Lam Mac muon tranh bi truy sat nhung dong doi dang bi bao vay.',
      decision_or_consequence: 'Lam Mac lo dau vet de ke dich nhan ra anh con song.',
      pacing: 'slow',
      state_delta: 'Lam Mac: Bi lo dau vet sinh ton va mat loi the an than.',
    }));
    expect(firstChapter.continuity_in).toEqual({ response: '' });
    expect(firstChapter.continuity_out).toEqual({ text: 'Vong vay sieu chat ep Lam Mac phai doi cach tron thoat.' });
    expect(firstChapter.state_changes).toEqual([
      { subject: 'Lam Mac', change: 'Bi lo dau vet sinh ton va mat loi the an than.' },
    ]);
  });

  it('revalidates revised outlines and records improved outcomes', async () => {
    const validationContext = buildValidationContext();
    const generatedOutline = buildTooFastOutline();
    const baselineValidation = validateGeneratedOutline(generatedOutline, validationContext);

    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      generatedOutline,
      storyProgressBudget: validationContext.storyProgressBudget,
      outlineValidation: baselineValidation,
      outlineRevisionPrompt: 'Lam cham nhip, tang buildup.',
      batchChapterAnchors: [],
    });

    aiServiceMock.send.mockImplementationOnce(({ onComplete }) => {
      onComplete(JSON.stringify(buildSlowOutline()));
    });

    const result = await useArcGenStore.getState().reviseGeneratedOutline({
      projectId: 1,
      chapterIndex: 10,
      genre: 'fantasy',
      instruction: 'Lam cham nhip, tang buildup.',
    });

    const nextState = useArcGenStore.getState();
    expect(result.ok).toBe(true);
    expect(nextState.outlineValidation.hasBlockingIssues).toBe(false);
    expect(nextState.outlineRevisionAssessment.status).toBe('improved');
    expect(nextState.outlineRevisionAssessment.beforeBlockingIssueCount).toBeGreaterThan(nextState.outlineRevisionAssessment.afterBlockingIssueCount);
    expect(nextState.outlineRevisionPrompt).toBe('');
  });

  it('keeps revision feedback explicit when AI does not improve the outline', async () => {
    const validationContext = buildValidationContext();
    const generatedOutline = buildTooFastOutline();
    const baselineValidation = validateGeneratedOutline(generatedOutline, validationContext);

    useArcGenStore.setState({
      currentChapterCount: 10,
      projectTargetLength: 120,
      projectMilestones: [],
      availableMacroArcs: [],
      selectedMacroArcId: null,
      currentMacroArcId: null,
      generatedOutline,
      storyProgressBudget: validationContext.storyProgressBudget,
      outlineValidation: baselineValidation,
      outlineRevisionPrompt: 'Lam cham nhip, tang buildup.',
      batchChapterAnchors: [],
    });

    aiServiceMock.send.mockImplementationOnce(({ onComplete }) => {
      onComplete(JSON.stringify(buildTooFastOutline()));
    });

    const result = await useArcGenStore.getState().reviseGeneratedOutline({
      projectId: 1,
      chapterIndex: 10,
      genre: 'fantasy',
      instruction: 'Lam cham nhip, tang buildup.',
    });

    const nextState = useArcGenStore.getState();
    expect(result.ok).toBe(true);
    expect(nextState.outlineRevisionAssessment.status).toBe('unchanged');
    expect(nextState.outlineRevisionAssessment.afterBlockingIssueCount).toBe(nextState.outlineRevisionAssessment.beforeBlockingIssueCount);
    expect(nextState.outlineRevisionPrompt).toBe('Lam cham nhip, tang buildup.');
  });
});
