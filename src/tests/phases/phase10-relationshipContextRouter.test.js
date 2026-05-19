import { describe, expect, it } from 'vitest';
import {
  buildRelationshipContextPacket,
  buildRelationshipPairKey,
} from '../../services/ai/relationshipContextRouter';

const characters = [
  { id: 1, name: 'Lan' },
  { id: 2, name: 'Kha' },
  { id: 3, name: 'Mai' },
  { id: 4, name: 'Nam' },
  { id: 5, name: 'Vân' },
];

describe('relationship context router', () => {
  it('keeps direct scene relationships in mustInclude before scoring the rest', () => {
    const result = buildRelationshipContextPacket({
      characters,
      relationships: [
        { id: 11, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Đang đứng cùng cảnh' },
        { id: 12, character_a_id: 3, character_b_id: 4, relation_type: 'lover', description: 'Bí mật ngoài cảnh' },
      ],
      relationshipStates: [
        { pair_key: '3:4', character_a_id: 3, character_b_id: 4, relationship_type: 'lover', intimacy_level: 'high', secrecy_state: 'secret', emotional_aftermath: 'căng thẳng' },
      ],
      characterContextGate: {
        sceneCast: [{ character: characters[0] }, { character: characters[1] }],
        chapterFocusCast: [],
        referencedCanonCast: [],
      },
      maxSupportingEdges: 1,
    });

    expect(result.relationshipContextPacket.mustIncludeEdges.map((edge) => edge.pairKey)).toContain('1:2');
    expect(result.relationshipContextPacket.supportingEdges.map((edge) => edge.pairKey)).toContain('3:4');
    expect(result.relationshipRoutingDebug.find((entry) => entry.pairKey === '1:2').selectedAs).toBe('mustInclude');
  });

  it('ranks critical secret and intimacy edges above ordinary one-hop edges in the scored pool', () => {
    const result = buildRelationshipContextPacket({
      characters,
      relationships: [
        { id: 21, character_a_id: 1, character_b_id: 5, relation_type: 'ally', description: 'Một quan hệ một bước bình thường' },
        { id: 22, character_a_id: 3, character_b_id: 4, relation_type: 'lover', description: 'Quan hệ bí mật' },
      ],
      relationshipStates: [
        { pair_key: '3:4', character_a_id: 3, character_b_id: 4, relationship_type: 'lover', intimacy_level: 'high', consent_state: 'mutual', secrecy_state: 'secret' },
      ],
      characterContextGate: {
        sceneCast: [{ character: characters[0] }],
        chapterFocusCast: [],
        referencedCanonCast: [],
      },
      maxSupportingEdges: 1,
    });

    expect(result.relationshipContextPacket.supportingEdges).toHaveLength(1);
    expect(result.relationshipContextPacket.supportingEdges[0].pairKey).toBe('3:4');
    expect(result.relationshipContextPacket.omittedSummary.count).toBe(1);
    expect(result.relationshipContextPacket.omittedSummary.topReasons.length).toBeGreaterThan(0);
  });

  it('marks budget pressure when too many mustInclude edges exceed the character budget', () => {
    const result = buildRelationshipContextPacket({
      characters,
      relationships: [
        { id: 31, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Một mô tả rất dài cần bị nén để giữ ngân sách context cho cảnh đang viết.' },
        { id: 32, character_a_id: 1, character_b_id: 3, relation_type: 'enemy', description: 'Một mô tả rất dài cần bị nén để giữ ngân sách context cho cảnh đang viết.' },
        { id: 33, character_a_id: 1, character_b_id: 4, relation_type: 'rival', description: 'Một mô tả rất dài cần bị nén để giữ ngân sách context cho cảnh đang viết.' },
      ],
      characterContextGate: {
        sceneCast: [{ character: characters[0] }, { character: characters[1] }, { character: characters[2] }, { character: characters[3] }],
        chapterFocusCast: [],
        referencedCanonCast: [],
      },
      maxMustIncludeEdges: 2,
      budgetChars: 180,
    });

    expect(result.relationshipContextPacket.mustIncludeEdges).toHaveLength(3);
    expect(result.relationshipContextPacket.budgetPressure).toBe(true);
    expect(result.relationshipContextPacket.mustIncludeEdges.every((edge) => edge.compact)).toBe(true);
  });

  it('ignores superseded relationship events when scoring recent supporting edges', () => {
    const result = buildRelationshipContextPacket({
      characters,
      relationships: [
        { id: 41, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Quan hệ nền yếu' },
      ],
      storyEvents: [
        {
          id: 501,
          op_type: 'RELATIONSHIP_STATUS_CHANGED',
          subject_id: 1,
          target_id: 2,
          chapter_id: 1,
          status: 'superseded',
        },
      ],
      chapters: [{ id: 1, order_index: 1 }],
      currentChapterIndex: 3,
      characterContextGate: {
        sceneCast: [],
        chapterFocusCast: [],
        referencedCanonCast: [],
      },
      maxSupportingEdges: 1,
    });

    expect(result.relationshipContextPacket.supportingEdges).toHaveLength(0);
    expect(result.relationshipRoutingDebug.find((entry) => entry.pairKey === '1:2').selectedAs).toBe('omitted');
  });

  it('uses a stable pair key for reversed character ids', () => {
    expect(buildRelationshipPairKey(7, 2)).toBe('2:7');
    expect(buildRelationshipPairKey('kha', 'lan')).toBe(buildRelationshipPairKey('lan', 'kha'));
  });
});
