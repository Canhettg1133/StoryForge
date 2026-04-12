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

describe('phase10 canon engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(dead.alive_status).toBe('dead');
    expect(rescued.alive_status).toBe('alive');
    expect(rescued.rescued).toBe(true);
  });

  it('validates dead character acting again as hard error', () => {
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

    expect(reports.some((report) => report.rule_code === 'DEAD_CHARACTER_ACTIVE')).toBe(true);
    expect(engine.reportsHaveErrors(reports)).toBe(true);
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
    expect(reports.some((report) => report.rule_code === 'LOW_CONFIDENCE_CANON_OP')).toBe(true);
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

  it('deduplicates repeated character summary fragments', () => {
    const summary = engine.buildCharacterStateSummary({
      alive_status: 'alive',
      goals_active: ['Tim cho dua vung chac'],
      summary: 'Con song | Muc tieu: Tim cho dua vung chac',
    });

    expect(summary).toBe('Con song | Muc tieu: Tim cho dua vung chac');
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
