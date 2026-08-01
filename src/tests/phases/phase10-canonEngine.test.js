import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/db/database', () => ({
  default: {},
}));

vi.mock('../../services/ai/client', () => ({
  default: {},
}));

vi.mock('../../services/ai/promptBuilder', () => ({
  buildPrompt: vi.fn(() => []),
}));

vi.mock('../../services/ai/router', () => ({
  TASK_TYPES: {},
}));

const engine = await import('../../services/canon/engine');
const { CANON_OP_TYPES } = await import('../../services/canon/constants');
const { normalizeCanonFactDescription } = await import('../../services/entityIdentity/factIdentity');
const { filterCommitReadyOps } = await import('../../services/canon/validation');

describe('phase10 canon engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes Vietnamese đ as d instead of dropping it from fact fingerprints', () => {
    expect(normalizeCanonFactDescription('Đèn đã được sửa')).toBe('den da duoc sua');
    expect(normalizeCanonFactDescription('Đèn')).not.toBe(
      normalizeCanonFactDescription('Én'),
    );
  });

  it('applies death and rescue events to entity state', () => {
    const start = engine.createInitialEntityState({ id: 1, project_id: 99, current_status: 'Con song' });
    const dead = engine.applyEventToEntityState(start, {
      op_type: CANON_OP_TYPES.CHARACTER_DIED,
      payload: { status_summary: 'Da chet o tran cau' },
    });
    const rescued = engine.applyEventToEntityState(dead, {
      op_type: CANON_OP_TYPES.CHARACTER_RESCUED,
      payload: { status_summary: 'Duoc cuu song' },
    });

    expect(start.alive_status).toBe('unknown');
    expect(dead.alive_status).toBe('dead');
    expect(rescued.alive_status).toBe('alive');
    expect(rescued.rescued).toBe(true);
  });

  it('does not infer liveness from free-text character status', () => {
    const status = 'Thoat chet sau tran truoc, hien con song | Muc tieu: Giai ma cai chet bi an cua ba';
    const state = engine.createInitialEntityState({
      id: 1,
      project_id: 99,
      current_status: status,
      goals: 'Giai ma cai chet bi an cua ba',
    });
    const changed = engine.applyEventToEntityState(state, {
      op_type: CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
      payload: { status_summary: 'Khong con song trong loi don cua dan lang' },
    });

    expect(state.alive_status).toBe('unknown');
    expect(changed.alive_status).toBe('unknown');
    expect(changed.summary).toBe('Khong con song trong loi don cua dan lang');
  });

  it('keeps liveness-looking summary text when state is unknown', () => {
    const summary = engine.buildCharacterStateSummary({
      alive_status: 'unknown',
      goals_active: ['Giai ma cai chet bi an cua ba'],
      summary: 'Da chet | Muc tieu: Giai ma cai chet bi an cua ba | Con song',
    });

    expect(summary).toContain('Da chet');
    expect(summary).toContain('Con song');
    expect(summary).toContain('Mục tiêu: Giai ma cai chet bi an cua ba');
  });

  it('warns without blocking when a committed-dead character has new ops', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 2,
      candidateOps: [{
        op_type: CANON_OP_TYPES.GOAL_CHANGED,
        scene_id: 10,
        subject_id: 5,
        subject_name: 'Lam',
        payload: { new_goal: 'Bao ve em gai' },
        evidence: 'Lam thuc hien nhiem vu moi',
      }],
      entityStates: [{
        entity_id: 5,
        alive_status: 'dead',
        goals_abandoned: [],
      }],
      threadStates: [],
      factStates: [],
    });

    const report = reports.find((item) => item.rule_code === 'DEAD_CHARACTER_ACTIVE');
    expect(report?.severity).toBe('warning');
    expect(engine.reportsHaveErrors(reports)).toBe(false);
  });

  it('warns without blocking when a committed-dead character acts in prose', () => {
    const reports = engine.validateGeneratedProseDiscipline({
      projectId: 1,
      chapterId: 2,
      sceneText: 'Lam buoc vao dien va noi: "Ta da tro lai."',
      characters: [{ id: 5, name: 'Lam' }],
      entityStates: [{ entity_id: 5, alive_status: 'dead' }],
    });

    const report = reports.find((item) => item.rule_code === 'DEAD_CHARACTER_ACTIVE');
    expect(report?.severity).toBe('warning');
    expect(reports.some((item) => item.rule_code === 'UNAVAILABLE_CHARACTER_ACTIVE')).toBe(false);
  });

  it('flags resolved thread progress as contradiction', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 2,
      candidateOps: [{
        op_type: CANON_OP_TYPES.THREAD_PROGRESS,
        scene_id: 11,
        thread_id: 9,
        thread_title: 'Bi mat hoang toc',
        evidence: 'Thread nay duoc day tiep',
      }],
      entityStates: [],
      threadStates: [{
        thread_id: 9,
        state: 'resolved',
      }],
      factStates: [],
    });

    expect(reports.some((report) => report.rule_code === 'THREAD_ALREADY_RESOLVED')).toBe(true);
  });

  it('warns when opening an already active thread again', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 2,
      candidateOps: [{
        op_type: CANON_OP_TYPES.THREAD_OPENED,
        scene_id: 11,
        thread_id: 9,
        thread_title: 'Bi mat hoang toc',
        evidence: 'Thread nay duoc mo lai.',
      }],
      entityStates: [],
      threadStates: [{ thread_id: 9, state: 'active' }],
      factStates: [],
    });

    expect(reports.some((report) => report.rule_code === 'THREAD_ALREADY_ACTIVE')).toBe(true);
  });

  it('maps extracted thread ops by id and drops ungrounded AI thread ops', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [],
      locations: [],
      plotThreads: [{ id: 9, title: 'Bi mat hoang toc', state: 'active' }],
      canonFacts: [],
      objects: [],
    };

    const ops = engine.mapAiOpsToCandidateOps([
      {
        op_type: CANON_OP_TYPES.THREAD_PROGRESS,
        scene_index: 1,
        thread_id: 9,
        thread_title: 'mot cach dien dat khac',
        summary: 'Thread co tien trien moi.',
        evidence: 'Bang chung trong van ban.',
        confidence: 0.8,
      },
      {
        op_type: CANON_OP_TYPES.THREAD_OPENED,
        scene_index: 1,
        thread_title: 'Tuyen truyen tu che cua model',
        summary: 'Mo mot thread moi khong co trong database.',
        evidence: 'Bang chung mo ho.',
        confidence: 0.8,
      },
    ], refs);

    expect(ops).toHaveLength(1);
    expect(ops[0].thread_id).toBe(9);
    expect(ops[0].thread_title).toBe('Bi mat hoang toc');
  });

  it('prefers an exact location match over an earlier substring match', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [{ id: 5, name: 'Mai An' }],
      locations: [
        { id: 20, name: 'Thành Cổ' },
        { id: 21, name: 'Trạm Y Tế Thành Cổ' },
      ],
      plotThreads: [],
      canonFacts: [],
      objects: [],
    };

    const [mapped] = engine.mapAiOpsToCandidateOps([{
      op_type: CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED,
      scene_index: 1,
      subject_name: 'Mai An',
      location_name: 'Trạm Y Tế Thành Cổ',
      summary: 'Mai An được đưa tới trạm y tế để điều trị.',
      evidence: 'Mọi người đưa Mai An vào Trạm Y Tế Thành Cổ.',
      confidence: 0.95,
      payload: { reason: 'Điều trị' },
    }], refs);

    expect(mapped.location_id).toBe(21);
    expect(mapped.location_name).toBe('Trạm Y Tế Thành Cổ');
  });

  it('prefers an exact thread title over an earlier substring match', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [],
      locations: [],
      plotThreads: [
        { id: 30, title: 'Cổng Tro' },
        { id: 31, title: 'Khóa Cổng Tro' },
      ],
      canonFacts: [],
      objects: [],
    };

    const [mapped] = engine.mapAiOpsToCandidateOps([{
      op_type: CANON_OP_TYPES.THREAD_PROGRESS,
      scene_index: 1,
      thread_title: 'Khóa Cổng Tro',
      summary: 'Nhóm đã tìm được nửa chìa khóa.',
      evidence: 'Nửa chìa khóa nằm trong hốc đá.',
      confidence: 0.91,
    }], refs);

    expect(mapped.thread_id).toBe(31);
    expect(mapped.thread_title).toBe('Khóa Cổng Tro');
  });

  it('keeps risky terminal character ops at mapping time for later review', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [{ id: 5, name: 'Lan' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
    };

    const ops = engine.mapAiOpsToCandidateOps([
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_index: 1,
        subject_name: 'Lan',
        summary: 'Lan gia chet de qua mat ke thu.',
        evidence: 'Lan gia chet trong man kich.',
        confidence: 0.9,
      },
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_index: 1,
        subject_name: 'Lan',
        summary: 'Ke thu doa giet Lan.',
        evidence: 'Ke thu noi: "Ta se giet Lan."',
        confidence: 0.9,
      },
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_index: 1,
        subject_name: 'Lan',
        summary: 'Nhan chung noi rang Lan da chet.',
        evidence: 'Nhan chung noi rang Lan da chet trong dem qua.',
        confidence: 0.9,
      },
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_index: 1,
        subject_name: 'Lan',
        summary: 'Lan bien mat khoi can phong.',
        evidence: 'Lan bien mat khoi can phong.',
        confidence: 0.9,
      },
    ], refs);

    expect(ops).toHaveLength(4);
    expect(ops.every((op) => op.op_type === CANON_OP_TYPES.CHARACTER_DIED)).toBe(true);
    expect(ops.every((op) => op.subject_id === 5)).toBe(true);
  });

  it('keeps risky terminal item ops at mapping time for later review', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [{ id: 5, name: 'Lan' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [{ id: 8, name: 'Ngoc An Hon' }],
    };

    const ops = engine.mapAiOpsToCandidateOps([
      {
        op_type: CANON_OP_TYPES.OBJECT_CONSUMED,
        scene_index: 1,
        subject_name: 'Lan',
        object_name: 'Ngoc An Hon',
        summary: 'Lan noi vien ngoc da dung het.',
        evidence: 'Lan noi: "Ngoc An Hon da dung het roi."',
        confidence: 0.9,
      },
      {
        op_type: CANON_OP_TYPES.OBJECT_LOST,
        scene_index: 1,
        subject_name: 'Lan',
        object_name: 'Ngoc An Hon',
        summary: 'Anh sang cua Ngoc An Hon bien mat.',
        evidence: 'Anh sang cua Ngoc An Hon bien mat trong khoanh khac.',
        confidence: 0.9,
      },
    ], refs);

    expect(ops).toHaveLength(2);
    expect(ops.map((op) => op.op_type)).toEqual([
      CANON_OP_TYPES.OBJECT_CONSUMED,
      CANON_OP_TYPES.OBJECT_LOST,
    ]);
    expect(ops.every((op) => op.object_id === 8)).toBe(true);
  });

  it('links a newly registered secret to its same-chapter reveal and orders the dependency first', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [
        { id: 5, name: 'Mai An' },
        { id: 6, name: 'Le Minh' },
      ],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
    };

    const ops = engine.mapAiOpsToCandidateOps([
      {
        op_type: CANON_OP_TYPES.SECRET_REVEALED,
        scene_index: 1,
        subject_name: 'Mai An',
        target_name: 'Le Minh',
        fact_description: 'An Dong chi chap nhan mau cua nguoi giu cong tu nguyen',
        summary: 'Mai biet quy tac cua an dong.',
        evidence: 'Le Minh chi noi rieng voi Mai ve quy tac cua an dong.',
        confidence: 0.96,
      },
      {
        op_type: CANON_OP_TYPES.FACT_REGISTERED,
        scene_index: 1,
        fact_description: 'An Dong chi chap nhan mau cua nguoi giu cong tu nguyen',
        summary: 'Quy tac bi mat cua an dong.',
        evidence: 'An Dong chi chap nhan mau cua nguoi giu cong tu nguyen.',
        confidence: 0.97,
        payload: {
          description: 'An Dong chi chap nhan mau cua nguoi giu cong tu nguyen',
          fact_type: 'secret',
        },
      },
    ], refs);

    expect(ops.map((op) => op.op_type)).toEqual([
      CANON_OP_TYPES.FACT_REGISTERED,
      CANON_OP_TYPES.SECRET_REVEALED,
    ]);
    expect(ops[0].fact_id).toBeTruthy();
    expect(ops[1]).toMatchObject({
      fact_id: ops[0].fact_id,
      subject_id: 5,
      target_id: 6,
    });
  });

  it('does not guess a same-chapter secret reference when fact descriptions differ', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [{ id: 5, name: 'Mai An' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
    };

    const ops = engine.mapAiOpsToCandidateOps([
      {
        op_type: CANON_OP_TYPES.FACT_REGISTERED,
        fact_description: 'Bi mat cua an dong',
        evidence: 'Van ban noi ro bi mat cua an dong.',
        confidence: 0.9,
        payload: { fact_type: 'secret' },
      },
      {
        op_type: CANON_OP_TYPES.SECRET_REVEALED,
        subject_name: 'Mai An',
        fact_description: 'Bi mat cua canh cong',
        evidence: 'Mai nghe mot bi mat khac.',
        confidence: 0.9,
      },
    ], refs);

    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe(CANON_OP_TYPES.FACT_REGISTERED);
  });

  it('marks secret reveal on an already revealed fact as contradiction', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 3,
      candidateOps: [{
        op_type: CANON_OP_TYPES.SECRET_REVEALED,
        scene_id: 12,
        fact_id: 7,
        fact_description: 'Than phan that cua Lan',
        evidence: 'Lan thua nhan than phan that.',
      }],
      entityStates: [],
      threadStates: [],
      factStates: [{
        id: 7,
        fact_type: 'secret',
        revealed_at_chapter: 2,
        description: 'Than phan that cua Lan',
      }],
    });

    expect(reports.some((report) => report.rule_code === 'SECRET_ALREADY_REVEALED')).toBe(true);
  });

  it('preserves the secret type and first reveal chapter when another character learns it later', () => {
    const factStates = [{
      id: 7,
      fact_type: 'secret',
      revealed_at_chapter: 2,
      description: 'Than phan that cua Lan',
    }];

    const next = engine.applyEventToFactStates(factStates, {
      op_type: CANON_OP_TYPES.SECRET_REVEALED,
      fact_id: 7,
      fact_description: 'Than phan that cua Lan',
    }, 2);

    expect(next[0]).toMatchObject({
      fact_type: 'secret',
      revealed_at_chapter: 2,
    });
  });

  it('does not report a repeated reveal when a different character learns the secret', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 3,
      candidateOps: [{
        op_type: CANON_OP_TYPES.SECRET_REVEALED,
        scene_id: 12,
        subject_id: 8,
        subject_name: 'Minh',
        fact_id: 7,
        fact_description: 'Than phan that cua Lan',
        evidence: 'Lan noi rieng bi mat cho Minh.',
      }],
      entityStates: [{ entity_id: 8, knowledge: {} }],
      threadStates: [],
      factStates: [{
        id: 7,
        fact_type: 'secret',
        revealed_at_chapter: 2,
        description: 'Than phan that cua Lan',
      }],
    });

    expect(reports.some((report) => report.rule_code === 'SECRET_ALREADY_REVEALED')).toBe(false);
  });

  it('filters a repeated secret reveal for a character who already knows that fact', () => {
    const result = filterCommitReadyOps([{
      op_type: CANON_OP_TYPES.SECRET_REVEALED,
      subject_id: 10,
      subject_name: 'Mai',
      fact_id: 7,
      confidence: 0.99,
      evidence: 'Mai nhắc lại bí mật.',
    }], {
      projectId: 1,
      chapterId: 4,
      entityStates: [{ entity_id: 10, knowledge: { 7: true } }],
    });

    expect(result.ops).toEqual([]);
    expect(result.reports).toEqual([
      expect.objectContaining({ rule_code: 'SECRET_ALREADY_REVEALED' }),
    ]);
  });

  it('requires strong references for important canon ops', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 3,
      candidateOps: [
        {
          op_type: CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED,
          scene_id: 10,
          subject_name: 'Lan',
          evidence: 'Lan roi khoi thanh co.',
          confidence: 0.42,
          payload: {},
        },
        {
          op_type: CANON_OP_TYPES.SECRET_REVEALED,
          scene_id: 11,
          subject_id: 7,
          subject_name: 'Lan',
          fact_description: '',
          evidence: 'Lan tiet lo bi mat.',
          payload: {},
        },
      ],
      entityStates: [{
        entity_id: 7,
        alive_status: 'alive',
        goals_abandoned: [],
        allegiance: 'trieu dinh',
      }],
      threadStates: [],
      factStates: [],
    });

    expect(reports.some((report) => report.rule_code === 'MISSING_SUBJECT_REFERENCE')).toBe(true);
    expect(reports.some((report) => report.rule_code === 'MISSING_LOCATION_REFERENCE')).toBe(true);
    expect(reports.some((report) => report.rule_code === 'MISSING_FACT_REFERENCE')).toBe(true);
    expect(reports.some((report) => report.rule_code === 'LOW_CONFIDENCE_CANON_OP_FILTERED')).toBe(true);
  });

  it('reports ambiguous exact character references instead of fuzzy mapping', () => {
    const refs = {
      chapterId: 2,
      scenes: [{ id: 11, title: 'Canh 1' }],
      characters: [
        { id: 1, name: 'Ngoc Anh', aliases: ['Anh'] },
        { id: 2, name: 'Lan Anh', aliases: ['Anh'] },
      ],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
    };

    const ops = engine.mapAiOpsToCandidateOps([{
      op_type: CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
      scene_index: 1,
      subject_name: 'Anh',
      summary: 'Anh thay doi trang thai.',
      evidence: 'Anh im lang.',
      confidence: 0.8,
      payload: { status_summary: 'Lo lang' },
    }], refs);
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 2,
      candidateOps: ops,
      entityStates: [],
      threadStates: [],
      factStates: [],
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].subject_id).toBe(null);
    expect(reports.some((report) => report.rule_code === 'AMBIGUOUS_CHARACTER_REFERENCE')).toBe(true);
    expect(engine.reportsHaveErrors(reports)).toBe(true);
  });

  it('updates thread projection when resolved', () => {
    const start = engine.createInitialThreadState({ id: 4, project_id: 99, state: 'active', description: 'Bi mat hoang toc' });
    const next = engine.applyEventToThreadState(start, {
      op_type: CANON_OP_TYPES.THREAD_RESOLVED,
      subject_id: 1,
      target_id: 2,
      payload: { summary: 'Da giai quyet than phan that cua hoang hau' },
    });

    expect(next.state).toBe('resolved');
    expect(next.summary).toContain('Da giai quyet');
    expect(next.focus_entity_ids).toEqual(expect.arrayContaining([1, 2]));
  });

  it('tracks item consumption in item state', () => {
    const start = engine.createInitialItemState({ id: 4, project_id: 9, description: 'Ngoc Hoa An' });
    const next = engine.applyEventToItemState(start, {
      op_type: CANON_OP_TYPES.OBJECT_CONSUMED,
      payload: { availability: 'consumed', status_summary: 'Da dung het trong mot lan kich hoat' },
    });

    expect(next.is_consumed).toBe(true);
    expect(next.availability).toBe('consumed');
    expect(next.summary).toContain('Da dung het');
  });

  it('does not force legacy items without classification into unique category', () => {
    const start = engine.createInitialItemState({ id: 4, project_id: 9, description: 'Vat pham cu' });

    expect(start.item_category).toBe('');
  });

  it('tracks stack item quantity for partial consumption', () => {
    const start = engine.createInitialItemState({
      id: 4,
      project_id: 9,
      item_category: 'consumable',
      quantity: 5,
      quantity_unit: 'vien',
      description: 'Binh dan duoc',
    });
    const next = engine.applyEventToItemState(start, {
      op_type: CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
      payload: { quantity_delta: 2, quantity_unit: 'vien', status_summary: 'Da dung hai vien' },
    });

    expect(next.item_category).toBe('consumable');
    expect(next.quantity_remaining).toBe(3);
    expect(next.quantity_unit).toBe('vien');
    expect(next.is_consumed).toBe(false);
    expect(next.availability).toBe('available');
  });

  it('allows acquired item timeline before consuming an item that was previously depleted', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 9,
      candidateOps: [
        {
          op_type: CANON_OP_TYPES.OBJECT_ACQUIRED,
          scene_id: 1,
          object_id: 8,
          object_name: 'Huyet Lien Dan',
          target_id: 2,
          payload: { item_category: 'consumable', quantity_delta: 3, quantity_unit: 'vien' },
          evidence: 'Lam Phong mua them ba vien Huyet Lien Dan.',
        },
        {
          op_type: CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
          scene_id: 2,
          object_id: 8,
          object_name: 'Huyet Lien Dan',
          payload: { item_category: 'consumable', quantity_delta: 1, quantity_unit: 'vien' },
          evidence: 'Hắn nuot mot vien.',
        },
      ],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true, item_category: 'consumable', quantity_remaining: 0, quantity_unit: 'vien' }],
    });

    expect(reports.some((report) => report.rule_code === 'ITEM_UNAVAILABLE_REUSED')).toBe(false);
    expect(reports.some((report) => report.rule_code === 'ITEM_QUANTITY_DEPLETED')).toBe(false);
  });

  it('sorts item timeline by scene order instead of raw candidate op array order', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 9,
      sceneOrderMap: new Map([[101, 0], [102, 1]]),
      candidateOps: [
        {
          op_type: CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
          scene_id: 102,
          object_id: 8,
          object_name: 'Huyet Lien Dan',
          payload: { item_category: 'consumable', quantity_delta: 1, quantity_unit: 'vien' },
          evidence: 'Hắn nuot mot vien.',
        },
        {
          op_type: CANON_OP_TYPES.OBJECT_ACQUIRED,
          scene_id: 101,
          object_id: 8,
          object_name: 'Huyet Lien Dan',
          target_id: 2,
          payload: { item_category: 'consumable', quantity_delta: 3, quantity_unit: 'vien' },
          evidence: 'Lam Phong mua them ba vien Huyet Lien Dan.',
        },
      ],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true, item_category: 'consumable', quantity_remaining: 0, quantity_unit: 'vien' }],
    });

    expect(reports.some((report) => report.rule_code === 'ITEM_REUSE_NEEDS_REVIEW')).toBe(false);
    expect(reports.some((report) => report.rule_code === 'ITEM_QUANTITY_DEPLETED')).toBe(false);
  });

  it('allows found item timeline before transferring a lost unique item', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 9,
      candidateOps: [
        {
          op_type: CANON_OP_TYPES.OBJECT_FOUND,
          scene_id: 1,
          object_id: 12,
          object_name: 'Kiem Vo Anh',
          subject_id: 2,
          payload: { item_category: 'equipment' },
          evidence: 'Lam Phong tim lai Kiem Vo Anh.',
        },
        {
          op_type: CANON_OP_TYPES.OBJECT_TRANSFERRED,
          scene_id: 2,
          object_id: 12,
          object_name: 'Kiem Vo Anh',
          target_id: 3,
          payload: { item_category: 'equipment' },
          evidence: 'Hắn giao kiếm cho A Dao.',
        },
      ],
      itemStates: [{ object_id: 12, availability: 'lost', item_category: 'equipment' }],
    });

    expect(reports.some((report) => report.rule_code === 'ITEM_UNAVAILABLE_REUSED')).toBe(false);
  });

  it('downgrades unavailable item reuse to review when classification and quantity are missing', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 9,
      candidateOps: [{
        op_type: CANON_OP_TYPES.OBJECT_CONSUMED,
        scene_id: 1,
        object_id: 8,
        object_name: 'Huyet Lien Dan',
        evidence: 'Hắn lại nuot Huyet Lien Dan.',
      }],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true }],
    });

    expect(reports.some((report) => report.rule_code === 'ITEM_UNAVAILABLE_REUSED')).toBe(false);
    expect(reports.some((report) => report.rule_code === 'ITEM_REUSE_NEEDS_REVIEW' && report.severity === 'warning')).toBe(true);
  });

  it('blocks overspending known currency quantity', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 9,
      candidateOps: [{
        op_type: CANON_OP_TYPES.OBJECT_SPENT,
        scene_id: 1,
        object_id: 21,
        object_name: 'Tien mat',
        payload: { item_category: 'currency', quantity_delta: 700000, quantity_unit: 'VND' },
        evidence: 'Hắn tiêu 700 nghin.',
      }],
      itemStates: [{ object_id: 21, availability: 'available', item_category: 'currency', quantity_remaining: 500000, quantity_unit: 'VND' }],
    });

    expect(reports.some((report) => report.rule_code === 'ITEM_QUANTITY_OVERSPENT')).toBe(true);
  });

  it('keeps ownership stable for lent items and only restores holder on return', () => {
    const start = engine.createInitialItemState({
      id: 41,
      project_id: 9,
      item_category: 'equipment',
      owner_character_id: 7,
      holder_character_id: 7,
      description: 'Thanh kiem gia toc',
    });
    const lent = engine.applyEventToItemState(start, {
      op_type: CANON_OP_TYPES.OBJECT_TRANSFERRED,
      target_id: 9,
      payload: { transfer_kind: 'lend', status_summary: 'Cho muon tam thoi' },
    });
    const returned = engine.applyEventToItemState(lent, {
      op_type: CANON_OP_TYPES.OBJECT_RETURNED,
      target_id: 7,
      payload: { status_summary: 'Duoc tra lai' },
    });

    expect(lent.owner_character_id).toBe(7);
    expect(lent.holder_character_id).toBe(9);
    expect(returned.owner_character_id).toBe(7);
    expect(returned.holder_character_id).toBe(7);
  });

  it('does not warn when draft only remembers or questions a spent item', () => {
    const reports = engine.validateDraftTextAgainstTruth({
      projectId: 1,
      chapterId: 9,
      sceneText: 'Tai sao, ngay ca Huyet Lien Dan cung mang mot khi tuc tuong dong voi han? Huyet Lien Dan da dung het roi.',
      objects: [{ id: 8, name: 'Huyet Lien Dan' }],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true }],
    });

    expect(reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(false);
  });

  it('does not warn about an unavailable item when the same chapter recovers it first', () => {
    const reports = engine.validateDraftTextAgainstTruth({
      projectId: 1,
      chapterId: 9,
      sceneText: 'Kha tim thay La Ban Thoi Vu trong luoi chan rac, sua lai roi tra cho Mai.',
      objects: [{ id: 8, name: 'La Ban Thoi Vu' }],
      itemStates: [{ object_id: 8, availability: 'lost', is_consumed: false }],
      candidateOps: [{
        op_type: CANON_OP_TYPES.OBJECT_FOUND,
        object_id: 8,
        scene_id: 91,
      }],
    });

    expect(reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(false);
  });

  it('does not mistake common words for a reference to a hidden secret', () => {
    const reports = engine.validateDraftTextAgainstTruth({
      projectId: 1,
      chapterId: 2,
      sceneText: 'Mai dieu tra Cong Tro de cuu nguoi anh.',
      factStates: [{
        id: 7,
        fact_type: 'secret',
        description: 'Bach Ly la nguoi dieu khien Cong Tro',
      }],
    });

    expect(reports.some((report) => report.rule_code === 'DRAFT_TOUCHES_HIDDEN_SECRET')).toBe(false);
  });

  it('keeps a real hidden-secret warning until the chapter explicitly reveals that fact', () => {
    const input = {
      projectId: 1,
      chapterId: 3,
      sceneText: 'Le Minh thu nhan Bach Ly la nguoi dieu khien Cong Tro.',
      factStates: [{
        id: 7,
        fact_type: 'secret',
        description: 'Bach Ly la nguoi dieu khien Cong Tro',
      }],
    };

    const unresolvedReports = engine.validateDraftTextAgainstTruth(input);
    const resolvedReports = engine.validateDraftTextAgainstTruth({
      ...input,
      candidateOps: [{
        op_type: CANON_OP_TYPES.SECRET_REVEALED,
        fact_id: 7,
        subject_id: 10,
      }],
    });

    expect(unresolvedReports.some((report) => report.rule_code === 'DRAFT_TOUCHES_HIDDEN_SECRET')).toBe(true);
    expect(resolvedReports.some((report) => report.rule_code === 'DRAFT_TOUCHES_HIDDEN_SECRET')).toBe(false);
  });

  it('does not confuse dan duoc names with an eat/use marker', () => {
    const reports = engine.validateDraftTextAgainstTruth({
      projectId: 1,
      chapterId: 9,
      sceneText: 'Tai sao vi tien boi than bi kia lai biet ro ve han nhu vay va tai sao ngay ca Huyet Lien Dan cung mang mot khi tuc tuong dong voi han? Ta la ai?',
      objects: [{ id: 8, name: 'Huyet Lien Dan' }],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true }],
    });

    expect(reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(false);
  });

  it('warns when draft actually uses a spent item again', () => {
    const reports = engine.validateDraftTextAgainstTruth({
      projectId: 1,
      chapterId: 9,
      sceneText: 'Lam Phong lay Huyet Lien Dan ra, nuot xuong de kich hoat linh luc.',
      objects: [{ id: 8, name: 'Huyet Lien Dan' }],
      itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true }],
    });

    expect(reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(true);
  });

  it('warns across broad item reuse contexts for different genres', () => {
    const cases = [
      {
        sceneText: 'Nang rut Kiem Vo Anh da bi pha huy ra va chem xuong.',
        objectName: 'Kiem Vo Anh',
        availability: 'destroyed',
      },
      {
        sceneText: 'Phi hanh gia tim thay The Truy Cap da mat, lap vao bang dieu khien de mo khoa cua.',
        objectName: 'The Truy Cap',
        availability: 'lost',
      },
      {
        sceneText: 'Phap su nap ma luc vao Tran Ban Co de trieu hoi cong dich chuyen.',
        objectName: 'Tran Ban Co',
        availability: 'consumed',
      },
    ];

    cases.forEach((item, index) => {
      const reports = engine.validateDraftTextAgainstTruth({
        projectId: 1,
        chapterId: 9,
        sceneText: item.sceneText,
        objects: [{ id: index + 20, name: item.objectName }],
        itemStates: [{ object_id: index + 20, availability: item.availability, is_consumed: item.availability === 'consumed' }],
      });

      expect(reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(true);
    });
  });

  it('tracks relationship intimacy and consent continuity', () => {
    const start = engine.createInitialRelationshipState({
      project_id: 1,
      character_a_id: 5,
      character_b_id: 7,
      relation_type: 'lover',
      description: 'Da co tinh cam',
    });
    const next = engine.applyEventToRelationshipState(start, {
      op_type: CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
      payload: {
        intimacy_level: 'high',
        consent_state: 'mutual',
        emotional_aftermath: 'gan gui hon nhung van co chut ngai ngung',
        status_summary: 'Quan he than mat hon sau canh cao trao',
      },
    });

    expect(next.intimacy_level).toBe('high');
    expect(next.consent_state).toBe('mutual');
    expect(next.emotional_aftermath).toContain('gan gui hon');
  });

  it('does not require consent metadata for non-intimate emotional beats', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 2,
      candidateOps: [{
        op_type: CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
        scene_id: 12,
        subject_id: 5,
        target_id: 6,
        subject_name: 'Lieu Uyen',
        target_name: 'Lam Phong',
        payload: {
          intimacy_level: 'low',
          emotional_aftermath: 'Dau don va bat luc',
        },
        evidence: 'Phong nhi...',
      }],
      relationshipStates: [{
        pair_key: '5:6',
        character_a_id: 5,
        character_b_id: 6,
        relationship_type: 'mentor',
        intimacy_level: 'none',
        secrecy_state: 'public',
        consent_state: 'unknown',
      }],
    });

    expect(reports.some((report) => report.rule_code === 'INTIMACY_CONSENT_UNSPECIFIED')).toBe(false);
  });

  it('deduplicates registered facts by fingerprint in fact state projection', () => {
    const start = [{
      id: 41,
      description: 'Lang co loi nguyen',
      fact_type: 'fact',
      subject_scope: 'global',
      normalized_description: 'lang co loi nguyen',
      fact_fingerprint: 'fact|lang co loi nguyen|global',
    }];
    const next = engine.applyEventToFactStates(start, {
      id: 501,
      chapter_id: 3,
      op_type: CANON_OP_TYPES.FACT_REGISTERED,
      fact_description: 'Lang co loi nguyen.',
      payload: {
        description: 'Lang co loi nguyen.',
        fact_type: 'fact',
      },
    }, 2);

    expect(next).toHaveLength(1);
    expect(next[0].fact_fingerprint).toBe('fact|lang co loi nguyen|global');
  });

  it('deduplicates repeated character summary fragments', () => {
    const summary = engine.buildCharacterStateSummary({
      alive_status: 'alive',
      goals_active: ['Tim cho dua vung chac'],
      summary: 'Con song | Muc tieu: Tim cho dua vung chac',
    });

    expect(summary).toBe('Còn sống | Mục tiêu: Tim cho dua vung chac');
  });

  it('warns on sharp relationship reversal without reason', () => {
    const reports = engine.validateCandidateOps({
      projectId: 1,
      chapterId: 5,
      candidateOps: [{
        op_type: CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
        scene_id: 12,
        subject_id: 1,
        target_id: 2,
        subject_name: 'Lan',
        target_name: 'Kha',
        payload: { relationship_type: 'enemy' },
        evidence: 'Lan bat ngo coi Kha la ke thu.',
      }],
      entityStates: [],
      threadStates: [],
      factStates: [],
      relationshipStates: [{
        pair_key: '1:2',
        character_a_id: 1,
        character_b_id: 2,
        relationship_type: 'lover',
      }],
    });

    expect(reports.some((report) => report.rule_code === 'RELATIONSHIP_REVERSAL_WITHOUT_REASON')).toBe(true);
  });
});
