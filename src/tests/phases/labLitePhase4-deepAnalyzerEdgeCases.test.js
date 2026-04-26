import { describe, expect, it } from 'vitest';
import {
  buildDeepAnalysisTargets,
  normalizeDeepAnalysisResult,
  planDeepAnalysisBatches,
} from '../../services/labLite/deepAnalyzer.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildDeepAnalysisPrompt } from '../../services/labLite/prompts/deepAnalysisPrompt.js';

describe('Lab Lite Phase 4 - deep analyzer edge cases', () => {
  it('keeps deep analysis capable of running more than one target at a time', () => {
    const store = fs.readFileSync(path.join(process.cwd(), 'src/stores/labLiteStore.js'), 'utf8');

    expect(store).toContain('concurrency: 2');
    expect(store).toContain('Promise.all(Array.from({ length: Math.min(2, created.items.length) }');
    expect(store).toContain('launchWorker');
  });

  it('deduplicates selected arcs and skips manual chapters already covered by arc targets', () => {
    const targets = buildDeepAnalysisTargets({
      selectedArcIds: ['arc_a', 'missing', 'arc_a'],
      selectedChapterIndexes: [2, 4, 'bad', 4, 8],
      arcs: [
        { id: 'arc_a', title: 'Arc A', chapterStart: 1, chapterEnd: 3, recommendedDeepChapters: [3, 1, 3, 2, 0] },
      ],
    });

    expect(targets).toEqual([
      expect.objectContaining({
        targetType: 'arc',
        targetId: 'arc_a',
        chapterIndexes: [1, 2, 3],
      }),
      expect.objectContaining({ targetType: 'chapter', targetId: '4', chapterIndexes: [4] }),
      expect.objectContaining({ targetType: 'chapter', targetId: '8', chapterIndexes: [8] }),
    ]);
  });

  it('can group manually selected adjacent chapters into browser-only analysis windows', () => {
    const targets = buildDeepAnalysisTargets({
      selectedChapterIndexes: [4, 5, 6, 9, 10, 12],
      groupManualChapters: true,
      manualGroupSize: 3,
    });

    expect(targets).toEqual([
      expect.objectContaining({ targetType: 'chapter_set', targetId: 'chapters_4_6', chapterIndexes: [4, 5, 6] }),
      expect.objectContaining({ targetType: 'chapter_set', targetId: 'chapters_9_10', chapterIndexes: [9, 10] }),
      expect.objectContaining({ targetType: 'chapter', targetId: '12', chapterIndexes: [12] }),
    ]);
  });

  it('expands a selected arc range when Arc Mapper has no recommended deep chapters', () => {
    const targets = buildDeepAnalysisTargets({
      selectedArcIds: ['arc_b'],
      arcs: [{ id: 'arc_b', title: 'Arc B', chapterStart: 5, chapterEnd: 7, recommendedDeepChapters: [] }],
    });

    expect(targets[0].chapterIndexes).toEqual([5, 6, 7]);
  });

  it('keeps oversized chapters as a single batch and continues batching following chapters in order', () => {
    const batches = planDeepAnalysisBatches({
      tokenCap: 100,
      targets: [{ targetType: 'arc', targetId: 'arc_big', chapterIndexes: [3, 1, 2, 99] }],
      chapters: [
        { index: 1, estimatedTokens: 130 },
        { index: 2, estimatedTokens: 30 },
        { index: 3, estimatedTokens: 40 },
      ],
    });

    expect(batches.map((batch) => batch.chapters.map((chapter) => chapter.index))).toEqual([[1], [2, 3]]);
    expect(batches[0].estimatedTokens).toBe(130);
    expect(batches[1].estimatedTokens).toBe(70);
  });

  it('normalizes aliases, evidence, relationship synonyms, and invalid chapter indexes without carrying unknown payload keys', () => {
    const result = normalizeDeepAnalysisResult({
      chapterCanon: [{ chapterIndex: -5, summary: '  A   turning point  ', evidence: 'Chapter one' }],
      characterUpdates: [{ name: 'Lan', aliases: 'A Lan', evidence: 'line 2', payload: { fullText: 'drop' } }],
      relationshipUpdates: [{ charA: 'Lan', charB: 'Kha', relationship: 'ally', summary: 'Trust grows.' }],
      timelineEvents: [{ chapterIndex: 'abc', description: 'The pact begins.', date_marker: 'early arc' }],
      sourceEvidence: ['source line'],
    }, { allowAdultCanon: true });

    expect(result.chapterCanon[0]).toEqual(expect.objectContaining({
      chapterIndex: 0,
      summary: 'A turning point',
      evidence: ['Chapter one'],
    }));
    expect(result.characterUpdates[0]).toEqual(expect.objectContaining({
      name: 'Lan',
      aliases: ['A Lan'],
      evidence: ['line 2'],
    }));
    expect(result.characterUpdates[0]).not.toHaveProperty('payload');
    expect(result.relationshipUpdates[0]).toEqual(expect.objectContaining({
      characterA: 'Lan',
      characterB: 'Kha',
      relation: 'ally',
      change: 'Trust grows.',
    }));
    expect(result.timelineEvents[0].chapterIndex).toBe(0);
  });

  it('normalizes cross-chapter windows, incident clusters, and continuity risks', () => {
    const result = normalizeDeepAnalysisResult({
      analysisWindows: [{ id: 'w1', chapter_start: 4, chapter_end: 6, summary: 'Rescue arc', key_incidents: ['capture', 'escape'] }],
      incidentClusters: [{ title: 'Broken oath', chapter_indexes: [4, '6', 6], canon_impact: 'Trust changes.' }],
      continuityRisks: [{ type: 'character_state', severity: 'high', chapterIndexes: [5, 6], description: 'Kha is both missing and present.' }],
    }, { allowAdultCanon: true });

    expect(result.analysisWindows[0]).toEqual(expect.objectContaining({
      windowId: 'w1',
      chapterStart: 4,
      chapterEnd: 6,
      keyIncidents: ['capture', 'escape'],
    }));
    expect(result.incidentClusters[0].chapterIndexes).toEqual([4, 6]);
    expect(result.continuityRisks[0]).toEqual(expect.objectContaining({
      type: 'character_state',
      severity: 'high',
      chapterIndexes: [5, 6],
    }));
  });

  it('keeps the deep-analysis prompt strict JSON and excludes unselected chapter content', () => {
    const messages = buildDeepAnalysisPrompt({
      corpusTitle: 'Truyện thử',
      target: { targetType: 'arc', targetId: 'arc_1', chapterIndexes: [2, 4] },
      chapters: [
        { index: 2, title: 'Chương 2', content: 'Nội dung chương hai.' },
        { index: 4, title: 'Chương 4', content: 'Nội dung chương bốn.' },
      ],
    });

    expect(messages[0].content).toContain('Chỉ trả JSON hợp lệ');
    expect(messages[0].content).toContain('cửa sổ phân tích');
    expect(messages[1].content).toContain('"chapterIndexes": [');
    expect(messages[1].content).toContain('"incidentClusters"');
    expect(messages[1].content).toContain('"continuityRisks"');
    expect(messages[1].content).toContain('Nội dung chương hai.');
    expect(messages[1].content).toContain('Nội dung chương bốn.');
    expect(messages[1].content).not.toContain('Nội dung chương ba.');
    expect(messages[1].content).not.toContain('corpusApi');
  });
});
