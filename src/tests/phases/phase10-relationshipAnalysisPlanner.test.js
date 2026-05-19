import { describe, expect, it } from 'vitest';
import {
  buildRelationshipAnalysisChapterText,
  buildRelationshipAnalysisSignature,
  planRelationshipAnalysisBatches,
} from '../../services/ai/relationshipAnalysisPlanner';

function makeScene(id, chapterId, textLength, orderIndex = 0) {
  return {
    id,
    chapter_id: chapterId,
    order_index: orderIndex,
    title: `Cảnh ${id}`,
    draft_text: 'a'.repeat(textLength),
  };
}

function makeScenesByChapterId(entries) {
  return new Map(entries.map(([chapterId, scenes]) => [chapterId, scenes]));
}

describe('relationship analysis planner', () => {
  it('skips chapters that were already analyzed with the same signature', () => {
    const scenes = [makeScene(1, 10, 900)];
    const text = buildRelationshipAnalysisChapterText(scenes);
    const signature = buildRelationshipAnalysisSignature(text);

    const plan = planRelationshipAnalysisBatches({
      chapters: [{ id: 10, order_index: 0, title: 'Chương 1' }],
      scenesByChapterId: makeScenesByChapterId([[10, scenes]]),
      chapterMetas: [{
        chapter_id: 10,
        relationship_analysis_signature: signature,
        relationship_analysis_status: 'analyzed',
      }],
      maxEstimatedInputTokens: 100000,
    });

    expect(plan.chapterPlans[0].status).toBe('analyzed');
    expect(plan.batches).toHaveLength(0);
  });

  it('groups multiple needed chapters under the 100k input cap into one request', () => {
    const plan = planRelationshipAnalysisBatches({
      chapters: [
        { id: 10, order_index: 0, title: 'Chương 1' },
        { id: 11, order_index: 1, title: 'Chương 2' },
      ],
      scenesByChapterId: makeScenesByChapterId([
        [10, [makeScene(1, 10, 3000)]],
        [11, [makeScene(2, 11, 3000)]],
      ]),
      maxEstimatedInputTokens: 100000,
    });

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].items.map((item) => item.chapterId)).toEqual([10, 11]);
    expect(plan.batches[0].estimatedInputTokens).toBeLessThanOrEqual(100000);
  });

  it('splits batches when estimated input would exceed 100k', () => {
    const plan = planRelationshipAnalysisBatches({
      chapters: [
        { id: 10, order_index: 0, title: 'Chương 1' },
        { id: 11, order_index: 1, title: 'Chương 2' },
      ],
      scenesByChapterId: makeScenesByChapterId([
        [10, [makeScene(1, 10, 180000)]],
        [11, [makeScene(2, 11, 180000)]],
      ]),
      maxEstimatedInputTokens: 100000,
    });

    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.every((batch) => batch.estimatedInputTokens <= 100000)).toBe(true);
  });

  it('splits an oversized chapter by scene groups instead of truncating content', () => {
    const plan = planRelationshipAnalysisBatches({
      chapters: [{ id: 10, order_index: 0, title: 'Chương dài' }],
      scenesByChapterId: makeScenesByChapterId([[
        10,
        [
          makeScene(1, 10, 140000, 0),
          makeScene(2, 10, 140000, 1),
          makeScene(3, 10, 140000, 2),
        ],
      ]]),
      maxEstimatedInputTokens: 100000,
    });

    expect(plan.oversizedItems).toHaveLength(0);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.flatMap((batch) => batch.items).every((item) => item.partCount > 1)).toBe(true);
  });
});
