import { describe, expect, it } from 'vitest';
import { buildCanonIndex, buildCanonPack } from '../../services/labLite/canonPackBuilder.js';
import { CANON_PACK_VERSION, createEmptyCanonPack, normalizeCanonPack } from '../../services/labLite/canonPackSchema.js';

describe('Lab Lite Phase 5 - Canon Pack schema and builder edge cases', () => {
  it('creates a complete empty Canon Pack with all required layers', () => {
    const pack = createEmptyCanonPack({
      id: 'pack_empty',
      corpusId: 'corpus_1',
      title: 'Gói canon',
      sourceTitle: 'Truyện gốc',
    });

    expect(pack).toEqual(expect.objectContaining({
      id: 'pack_empty',
      corpusId: 'corpus_1',
      title: 'Gói canon',
      status: 'draft',
      globalCanon: expect.any(Object),
      arcCanon: [],
      characterCanon: [],
      relationshipCanon: [],
      chapterCanon: [],
      styleCanon: expect.any(Object),
      adultCanon: expect.any(Object),
      canonRestrictions: [],
      creativeGaps: [],
      canonIndex: expect.any(Object),
      uncertainties: [],
    }));
    expect(pack.metadata.version).toBe(CANON_PACK_VERSION);
  });

  it('normalizes malformed Canon Pack input without losing safe metadata', () => {
    const pack = normalizeCanonPack({
      id: 'pack_bad',
      corpusId: 'corpus_bad',
      title: ` ${'A'.repeat(300)} `,
      globalCanon: { themes: 'not-array', mainCharacters: ['Lan'], hardRestrictions: [null, 'Không hồi sinh mentor.'] },
      characterCanon: [{ name: '' }, { name: 'Lan' }],
      styleCanon: { observations: 'not-array', tone: 'Trầm' },
      adultCanon: { enabled: 1, notes: ['Chỉ bật khi chế độ phù hợp.'] },
      canonIndex: { recommendedDeepChapters: [3, 1] },
      metadata: { sourceTitle: 'Nguồn', custom: 'keep' },
    });

    expect(pack.title.length).toBeLessThanOrEqual(183);
    expect(pack.globalCanon.themes).toEqual([]);
    expect(pack.globalCanon.hardRestrictions).toEqual(['Không hồi sinh mentor.']);
    expect(pack.characterCanon).toEqual([{ name: 'Lan' }]);
    expect(pack.styleCanon.observations).toEqual([]);
    expect(pack.adultCanon.enabled).toBe(true);
    expect(pack.metadata).toEqual(expect.objectContaining({
      version: CANON_PACK_VERSION,
      sourceTitle: 'Nguồn',
      custom: 'keep',
    }));
  });

  it('builds a sorted, deduped Canon Index from Scout and deep artifacts', () => {
    const index = buildCanonIndex({
      scoutResults: [
        { chapterIndex: 3, recommendation: 'deep_load', detectedSignals: ['reveal', 'relationship_shift'], reason: 'Bí mật lộ ra.' },
        { chapterIndex: 1, recommendation: 'light_load', detectedSignals: ['worldbuilding'], reason: 'Luật thế giới.' },
        { chapterIndex: 3, recommendation: 'deep_load', detectedSignals: ['reveal'], reason: 'Lặp lại.' },
        { chapterIndex: 0, recommendation: 'deep_load', detectedSignals: ['reveal'], reason: 'Bỏ qua.' },
      ],
      deepAnalysisItems: [{
        result: {
          chapterCanon: [
            { chapterIndex: 2, charactersAppearing: ['Lan', 'Kha', 'Lan'] },
            { chapterIndex: 1, charactersAppearing: ['Lan'] },
          ],
        },
      }],
    });

    expect(index.recommendedDeepChapters).toEqual([3]);
    expect(index.byReveal[3]).toBe('Lặp lại.');
    expect(index.byRelationship[3]).toContain('Bí mật');
    expect(index.byWorldbuilding[1]).toContain('Luật');
    expect(index.byCharacter.Lan).toEqual([1, 2]);
    expect(index.byCharacter.Kha).toEqual([2]);
  });

  it('merges duplicate character updates, ignores failed deep items, and hides adult notes when adult canon is disabled', () => {
    const pack = buildCanonPack({
      corpus: { id: 'corpus_1', title: 'Truyện thử', sourceFileName: 'demo.txt', chapterCount: 3 },
      arcs: [{ id: 'arc_1', title: 'Mở đầu', chapterStart: 1, chapterEnd: 3, summary: 'Arc mở.', recommendedDeepChapters: [1, 3] }],
      scoutResults: [{ chapterIndex: 3, recommendation: 'deep_load', detectedSignals: ['ending_hook'], reason: 'Có móc kết.' }],
      allowAdultCanon: false,
      deepAnalysisItems: [
        { status: 'failed', result: { characterUpdates: [{ name: 'Không dùng' }] } },
        {
          status: 'complete',
          result: {
            chapterCanon: [
              { chapterIndex: 2, summary: 'Chương hai.', charactersAppearing: ['Lan'] },
              { chapterIndex: 1, summary: 'Chương một.', charactersAppearing: ['Lan', 'Kha'] },
            ],
            characterUpdates: [
              { name: 'Lan', aliases: ['A Lan'], status: 'alive', evidence: ['c1'] },
              { name: 'lan', aliases: ['Lan Nhi'], voice: 'ít nói', evidence: ['c2'] },
            ],
            relationshipUpdates: [{ characterA: 'Lan', characterB: 'Kha', change: 'Tin nhau hơn.' }],
            worldUpdates: [{ type: 'rule', name: 'Không hồi sinh', description: 'Người đã chết không tự sống lại.' }],
            timelineEvents: [{ chapterIndex: 1, event: 'Lan gặp Kha.' }],
            styleObservations: ['Câu ngắn.', 'Câu ngắn.'],
            adultCanonNotes: ['ẩn đi'],
            canonRestrictions: ['Không hồi sinh mentor.', 'Không hồi sinh mentor.'],
            creativeGaps: ['Tuổi thơ của Kha còn trống.'],
            uncertainties: ['Chưa rõ nguồn sức mạnh.'],
          },
        },
      ],
    });

    expect(pack.title).toBe('Truyện thử - Canon Pack');
    expect(pack.chapterCanon.map((chapter) => chapter.chapterIndex)).toEqual([1, 2]);
    expect(pack.characterCanon).toHaveLength(1);
    expect(pack.characterCanon[0]).toEqual(expect.objectContaining({
      name: 'lan',
      aliases: ['A Lan', 'Lan Nhi'],
      voice: 'ít nói',
    }));
    expect(pack.relationshipCanon).toHaveLength(1);
    expect(pack.globalCanon.worldRules).toEqual(['Người đã chết không tự sống lại.']);
    expect(pack.styleCanon.observations).toEqual(['Câu ngắn.']);
    expect(pack.adultCanon).toEqual({ enabled: false, notes: [] });
    expect(pack.metadata.worldUpdates).toEqual([expect.objectContaining({ type: 'rule' })]);
    expect(pack.canonRestrictions).toEqual(['Không hồi sinh mentor.']);
  });
});
