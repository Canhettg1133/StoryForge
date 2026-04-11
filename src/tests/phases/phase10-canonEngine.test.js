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
});
