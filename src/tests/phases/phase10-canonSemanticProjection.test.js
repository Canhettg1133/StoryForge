import { describe, expect, it } from 'vitest';
import { CANON_OP_TYPES } from '../../services/canon/constants.js';
import {
  applyEventToEntityState,
  applyEventToRelationshipState,
  createInitialEntityState,
  createInitialRelationshipState,
} from '../../services/canon/state.js';
import { filterCommitReadyOps } from '../../services/canon/validation.js';

describe('phase10 semantic canon filtering and projection', () => {
  it('does not treat explicitly negated rumor/fake-death wording as uncertainty', () => {
    const evidence = 'Nghi Vũ chết thật tại chỗ, không phải tin đồn, hồi tưởng hay giả chết.';
    const result = filterCommitReadyOps([
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_id: 45101,
        subject_id: 45111,
        subject_name: 'Nghi Vũ',
        confidence: 0.96,
        evidence,
        payload: { status_summary: 'Đã chết tại cửa áp suất.' },
      },
    ], {
      projectId: 45000,
      chapterId: 45100,
      requireConfidence: true,
      requireEvidenceGrounding: true,
      sceneTextById: new Map([[45101, evidence]]),
    });

    expect(result.ops).toHaveLength(1);
    expect(result.reports).toEqual([]);
  });

  it('still filters genuinely uncertain death evidence', () => {
    const evidence = 'Đây chỉ là tin đồn rằng Nghi Vũ đã chết.';
    const result = filterCommitReadyOps([
      {
        op_type: CANON_OP_TYPES.CHARACTER_DIED,
        scene_id: 45101,
        subject_id: 45111,
        subject_name: 'Nghi Vũ',
        confidence: 0.96,
        evidence,
        payload: {},
      },
    ], {
      projectId: 45000,
      chapterId: 45100,
      requireConfidence: true,
      requireEvidenceGrounding: true,
      sceneTextById: new Map([[45101, evidence]]),
    });

    expect(result.ops).toEqual([]);
    expect(result.reports.map((report) => report.rule_code))
      .toContain('CANON_EVIDENCE_EXPLICITLY_UNCERTAIN');
  });

  it('projects injury_level from a character status operation', () => {
    const initial = createInitialEntityState({
      id: 45111,
      project_id: 45000,
      name: 'Đỗ Lam',
      current_status: 'Khỏe mạnh.',
    });
    const projected = applyEventToEntityState(initial, {
      op_type: CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
      payload: {
        injury_level: 'moderate',
        status_summary: 'Cổ tay trái rạn xương mức vừa.',
      },
    });

    expect(projected.injury_level).toBe('moderate');
    expect(projected.summary).toBe('Cổ tay trái rạn xương mức vừa.');
  });

  it('projects trust_level from a relationship status operation', () => {
    const initial = createInitialRelationshipState({
      id: 45121,
      project_id: 45000,
      character_a_id: 45111,
      character_b_id: 45112,
      relation_type: 'friend',
    });
    const projected = applyEventToRelationshipState(initial, {
      op_type: CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
      payload: {
        relationship_type: 'friend',
        trust_level: 'high',
        status_summary: 'Bạn bè với mức tin cậy cao.',
      },
    });

    expect(projected.relationship_type).toBe('friend');
    expect(projected.trust_level).toBe('high');
  });

  it('filters an operation whose typed payload contains invalid scalar and quantity values', () => {
    const evidence = 'Từ ba ống chỉ còn đúng hai ống nguyên vẹn.';
    const result = filterCommitReadyOps([{
      op_type: CANON_OP_TYPES.OBJECT_PARTIALLY_CONSUMED,
      scene_id: 45101,
      subject_id: 45111,
      object_id: 45131,
      object_name: 'Ống Sinh Quang',
      confidence: 0.96,
      evidence,
      payload: {
        item_category: 'consumable',
        quantity_delta: 'một',
        quantity_remaining: -5,
        availability: { state: 'available' },
      },
    }], {
      projectId: 45000,
      chapterId: 45100,
      requireConfidence: true,
      requireEvidenceGrounding: true,
      sceneTextById: new Map([[45101, evidence]]),
    });

    expect(result.ops).toEqual([]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      rule_code: 'INVALID_CANON_OP_PAYLOAD',
      evidence,
    });
  });
});
