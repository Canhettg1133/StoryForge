import { describe, expect, it } from 'vitest';
import {
  mapAiOpsToCandidateOps,
  mapAiOpsToCandidateOpsDetailed,
} from '../../services/canon/opMapping.js';

const refs = {
  chapterId: 44101,
  scenes: [{ id: 44111, title: 'Hai cái tên' }],
  characters: [
    { id: 44121, name: 'Đỗ Lam', aliases: ['Lam'] },
    { id: 44122, name: 'Đỗ Lâm', aliases: ['Lâm'] },
  ],
  locations: [{ id: 44131, name: 'Rãnh Kính' }],
  plotThreads: [],
  canonFacts: [],
  objects: [],
};

function statusOp(subjectName) {
  return {
    op_type: 'CHARACTER_STATUS_CHANGED',
    scene_index: 1,
    subject_name: subjectName,
    confidence: 0.96,
    evidence: `${subjectName} có thay đổi rõ.`,
    payload: { status_summary: 'Có thay đổi rõ.' },
  };
}

describe('phase10 typed canon mapping with Vietnamese diacritics', () => {
  it('maps canonical names that differ only by accents to separate characters', () => {
    const mapped = mapAiOpsToCandidateOps(
      [statusOp('Đỗ Lam'), statusOp('Đỗ Lâm')],
      refs,
    );

    expect(mapped).toHaveLength(2);
    expect(mapped.map((item) => item.subject_id)).toEqual([44121, 44122]);
    expect(mapped.flatMap((item) => item.mapping_errors)).toEqual([]);
  });

  it('maps accent-distinct aliases before using accent-folded fallback', () => {
    const mapped = mapAiOpsToCandidateOps(
      [statusOp('Lam'), statusOp('Lâm')],
      refs,
    );

    expect(mapped).toHaveLength(2);
    expect(mapped.map((item) => item.subject_id)).toEqual([44121, 44122]);
    expect(mapped.flatMap((item) => item.mapping_errors)).toEqual([]);
  });

  it('explains each duplicate and missing-reference operation filtered during mapping', () => {
    const duplicate = statusOp('Đỗ Lam');
    const missing = statusOp('Người Không Tồn Tại');
    const result = mapAiOpsToCandidateOpsDetailed(
      [duplicate, { ...duplicate }, missing],
      refs,
    );

    expect(result.candidateOps).toHaveLength(1);
    expect(result.filteredOps).toHaveLength(2);
    expect(result.filteredOps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reasonCode: 'CANON_OP_DUPLICATE_FILTERED',
        opType: 'CHARACTER_STATUS_CHANGED',
        evidence: 'Đỗ Lam có thay đổi rõ.',
      }),
      expect.objectContaining({
        reasonCode: 'CANON_OP_MISSING_REFERENCE_FILTERED',
        opType: 'CHARACTER_STATUS_CHANGED',
        evidence: 'Người Không Tồn Tại có thay đổi rõ.',
        missingReferences: ['subject_name:Người Không Tồn Tại'],
      }),
    ]));
  });
});
