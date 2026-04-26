import { describe, expect, it } from 'vitest';
import { createEmptyCanonPack } from '../../services/labLite/canonPackSchema.js';
import { evaluateCanonPackReadiness, buildCanonPackWriteTargets } from '../../services/labLite/canonPackReadiness.js';
import { buildDeepSelectionPlan } from '../../services/labLite/longContextPlanner.js';
import { buildCanonPackMergePlan, applyCanonPackMergePlan } from '../../services/labLite/canonPackMerge.js';

function makeChapters(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `chapter_${index + 1}`,
    index: index + 1,
    title: `Chapter ${index + 1}`,
    estimatedTokens: 1200,
  }));
}

describe('Lab Lite Phase 12 - guided workspace helpers', () => {
  it('scores empty, usable, and strong Canon Packs deterministically', () => {
    const empty = createEmptyCanonPack({ title: 'Empty' });
    const weak = evaluateCanonPackReadiness(empty, { chapterCount: 100 }, { deepAnalysisItems: [] });

    expect(weak.status).toBe('not_ready');
    expect(weak.score).toBeLessThan(35);
    expect(weak.missing).toContain('character_canon');

    const usablePack = {
      ...empty,
      characterCanon: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      relationshipCanon: [{ characterA: 'A', characterB: 'B', relation: 'ally' }],
      chapterCanon: Array.from({ length: 18 }, (_, index) => ({ chapterIndex: index + 1, summary: `S${index}` })),
      styleCanon: { observations: ['short chapters'], tone: 'tense', pacing: 'fast', voice: 'close third' },
      canonRestrictions: ['A cannot know the secret before chapter 40'],
      creativeGaps: ['Missing winter training arc'],
      globalCanon: { ...empty.globalCanon, summary: 'A long-running canon.' },
    };
    const usable = evaluateCanonPackReadiness(usablePack, { chapterCount: 100 }, { deepAnalysisItems: [{ status: 'complete' }] });

    expect(usable.status).toMatch(/usable|strong/);
    expect(usable.score).toBeGreaterThanOrEqual(60);
    expect(usable.nextActions.length).toBeGreaterThan(0);
  });

  it('plans deep selection for a 1000 chapter corpus without returning a flat first-180 list', () => {
    const chapters = makeChapters(1000);
    const scoutResults = [
      { chapterIndex: 12, recommendation: 'deep_load', priority: 'critical', detectedSignals: ['reveal'] },
      { chapterIndex: 240, recommendation: 'deep_load', priority: 'high', detectedSignals: ['relationship_shift'] },
      { chapterIndex: 870, recommendation: 'light_load', priority: 'medium', detectedSignals: ['adult_sensitive'] },
    ];
    const arcs = [
      { id: 'arc_a', title: 'Opening', chapterStart: 1, chapterEnd: 90, importance: 'high', recommendedDeepChapters: [12, 45] },
      { id: 'arc_b', title: 'Late War', chapterStart: 820, chapterEnd: 910, importance: 'critical', recommendedDeepChapters: [870, 900] },
    ];

    const plan = buildDeepSelectionPlan({
      preset: 'adult_sensitive',
      chapters,
      scoutResults,
      arcs,
      allowAdultCanon: true,
      modelInputLimit: 1_000_000,
    });

    expect(plan.selectedChapterIndexes).toContain(870);
    expect(plan.selectedChapterIndexes).not.toEqual(chapters.slice(0, 180).map((chapter) => chapter.index));
    expect(plan.estimatedTokens).toBeGreaterThan(0);
    expect(plan.estimatedRequests).toBeGreaterThan(0);
    expect(plan.coverageAfterRun).toBeGreaterThan(0);
  });

  it('builds a Canon Pack merge plan without overwriting until selected actions are applied', () => {
    const basePack = createEmptyCanonPack({ id: 'base_pack', title: 'Base' });
    basePack.characterCanon = [{ name: 'Lan', status: 'alive', evidence: ['chapter 1'] }];
    basePack.canonRestrictions = ['Lan has not left the city.'];

    const incomingPack = createEmptyCanonPack({ id: 'incoming_pack', title: 'Incoming' });
    incomingPack.characterCanon = [
      { name: 'Lan', status: 'missing', evidence: ['extra scene'] },
      { name: 'Minh', status: 'alive', evidence: ['extra scene'] },
    ];
    incomingPack.canonRestrictions = ['Minh must not know Lan is missing.'];

    const plan = buildCanonPackMergePlan({
      basePack,
      incomingPack,
      ingestBatch: { id: 'batch_1', type: 'scene_patch' },
    });

    expect(plan.actions.some((action) => action.action === 'conflict')).toBe(true);
    expect(basePack.characterCanon.find((character) => character.name === 'Lan').status).toBe('alive');

    const createMinh = plan.actions.find((action) => action.type === 'character' && action.source?.name === 'Minh');
    const merged = applyCanonPackMergePlan({
      basePack,
      mergePlan: plan,
      selectedActionIds: [createMinh.id],
    });

    expect(merged.characterCanon.some((character) => character.name === 'Minh')).toBe(true);
    expect(merged.characterCanon.find((character) => character.name === 'Lan').status).toBe('alive');
    expect(merged.metadata.sourceBatches).toContain('batch_1');
  });

  it('keeps adult write targets and adult readiness gated by adult mode', () => {
    const pack = createEmptyCanonPack({ title: 'Adult Pack' });
    pack.creativeGaps = ['Missing confession scene'];
    pack.adultCanon = {
      enabled: true,
      detailsHidden: true,
      notes: [{ dynamic: 'slow trust', evidence: 'chapter 88', targetHint: 'after chapter 90' }],
    };

    const safe = evaluateCanonPackReadiness(pack, { chapterCount: 120 }, { allowAdultCanon: false });
    const adult = evaluateCanonPackReadiness(pack, { chapterCount: 120 }, { allowAdultCanon: true });
    const targets = buildCanonPackWriteTargets(pack, { allowAdultCanon: true });

    expect(safe.missing).not.toContain('adult_context');
    expect(adult.missing).not.toContain('adult_context');
    expect(targets.some((target) => target.type === 'adult_scene')).toBe(true);
  });
});
