import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeepAnalysisTargets,
  normalizeDeepAnalysisResult,
  planDeepAnalysisBatches,
} from '../../services/labLite/deepAnalyzer.js';
import { buildDeepAnalysisPrompt } from '../../services/labLite/prompts/deepAnalysisPrompt.js';
import { buildCanonPack } from '../../services/labLite/canonPackBuilder.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryQuery {
  constructor(table, field = null, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _rows() {
    return this.rows ? clone(this.rows) : clone(this.table.rows);
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
    );
  }

  filter(fn) {
    return new MemoryQuery(this.table, this.field, this._rows().filter(fn));
  }

  async toArray() {
    return this._rows();
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
  }

  where(field) {
    return new MemoryQuery(this, field);
  }
}

function createMockDb(seed = {}) {
  const tableNames = ['characters', 'locations', 'objects', 'worldTerms', 'factions', 'canonFacts', 'timelineEvents', 'stylePacks'];
  const db = {};
  tableNames.forEach((name) => {
    db[name] = new MemoryTable(seed[name] || []);
  });
  db.transaction = async (_mode, ...args) => {
    const callback = args[args.length - 1];
    return callback();
  };
  return db;
}

async function loadMaterializer(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  vi.doMock('../../services/db/database.js', () => ({ default: db }));
  vi.doMock('../../services/db/database', () => ({ default: db }));
  return {
    db,
    materializer: await import('../../services/labLite/materializeCanonPack.js'),
  };
}

describe('Lab Lite Phase 4 - deep analysis services', () => {
  it('builds targets only from selected chapters and arcs', () => {
    const targets = buildDeepAnalysisTargets({
      selectedChapterIndexes: [7, 7, 9],
      selectedArcIds: ['arc_a'],
      arcs: [{ id: 'arc_a', title: 'Arc A', chapterStart: 1, chapterEnd: 4, recommendedDeepChapters: [1, 3] }],
    });

    expect(targets).toEqual([
      expect.objectContaining({ targetType: 'arc', targetId: 'arc_a', chapterIndexes: [1, 3] }),
      expect.objectContaining({ targetType: 'chapter', targetId: '7', chapterIndexes: [7] }),
      expect.objectContaining({ targetType: 'chapter', targetId: '9', chapterIndexes: [9] }),
    ]);
  });

  it('plans batches under the token cap while preserving chapter order', () => {
    const batches = planDeepAnalysisBatches({
      tokenCap: 100,
      targets: [{ targetType: 'arc', targetId: 'arc_a', chapterIndexes: [1, 2, 3] }],
      chapters: [
        { index: 1, estimatedTokens: 60 },
        { index: 2, estimatedTokens: 50 },
        { index: 3, estimatedTokens: 20 },
      ],
    });

    expect(batches.map((batch) => batch.chapters.map((chapter) => chapter.index))).toEqual([[1], [2, 3]]);
    expect(batches.every((batch) => batch.estimatedTokens <= 100)).toBe(true);
  });

  it('normalizes AI output conservatively and hides adult canon in safe mode', () => {
    const result = normalizeDeepAnalysisResult({
      chapterCanon: [{ chapterIndex: '2', summary: 'Major reveal', mainEvents: ['A'], charactersAppearing: ['Lan'] }],
      characterUpdates: [{ name: 'Lan', aliases: ['A Lan'], role: 'lead', extra: 'drop' }],
      worldUpdates: [{ type: 'unknown', name: 'Linh lực', description: 'Energy' }],
      adultCanonNotes: ['explicit note'],
      sourceEvidence: ['Chương 2'],
    }, { allowAdultCanon: false });

    expect(result.chapterCanon[0].chapterIndex).toBe(2);
    expect(result.characterUpdates[0]).not.toHaveProperty('extra');
    expect(result.worldUpdates[0].type).toBe('term');
    expect(result.adultCanonNotes).toEqual([]);
    expect(result.sourceEvidence).toEqual(['Chương 2']);
  });

  it('keeps deep analysis prompt scoped to provided chapters only', () => {
    const messages = buildDeepAnalysisPrompt({
      corpusTitle: 'Demo',
      target: { targetType: 'chapter', targetId: '2', chapterIndexes: [2] },
      chapters: [{ index: 2, title: 'Chương 2', content: 'Only this chapter text.' }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('"chapterIndex": 2');
    expect(messages[1].content).toContain('Only this chapter text.');
    expect(messages[1].content).not.toContain('"chapterIndex": 1');
  });
});

describe('Lab Lite Phase 5 - Canon Pack builder', () => {
  it('builds the required Canon Pack layers and index from artifacts', () => {
    const pack = buildCanonPack({
      corpus: { id: 'corpus_a', title: 'Demo Story', chapterCount: 2 },
      arcs: [{ id: 'arc_1', title: 'Opening', chapterStart: 1, chapterEnd: 2, recommendedDeepChapters: [1] }],
      scoutResults: [{ chapterIndex: 1, recommendation: 'deep_load', detectedSignals: ['reveal'], reason: 'Reveal reason' }],
      deepAnalysisItems: [{
        status: 'complete',
        result: normalizeDeepAnalysisResult({
          chapterCanon: [{ chapterIndex: 1, summary: 'Lan finds the seal.', charactersAppearing: ['Lan'] }],
          characterUpdates: [{ name: 'Lan', status: 'alive', evidence: ['Chương 1'] }],
          canonRestrictions: ['The seal is already broken.'],
          creativeGaps: ['Missing childhood period.'],
          analysisWindows: [{ windowId: 'w1', chapterStart: 1, chapterEnd: 2, summary: 'Opening window' }],
          incidentClusters: [{ id: 'incident_seal', title: 'Seal discovery', chapterIndexes: [1], summary: 'Lan finds the seal.' }],
          continuityRisks: [{ type: 'timeline', severity: 'high', chapterIndexes: [1, 2], description: 'Seal state needs review.' }],
        }, { allowAdultCanon: true }),
      }],
    });

    expect(pack.globalCanon.summary).toContain('Lan finds the seal');
    expect(pack.arcCanon).toHaveLength(1);
    expect(pack.characterCanon[0].name).toBe('Lan');
    expect(pack.chapterCanon[0].chapterIndex).toBe(1);
    expect(pack.canonRestrictions).toContain('The seal is already broken.');
    expect(pack.creativeGaps).toContain('Missing childhood period.');
    expect(pack.uncertainties.some((item) => item.includes('Seal state needs review'))).toBe(true);
    expect(pack.canonIndex.byCharacter.Lan).toEqual([1]);
    expect(pack.canonIndex.recommendedDeepChapters).toEqual([1]);
    expect(pack.canonIndex.incidentClusters.incident_seal).toEqual([1]);
    expect(pack.canonIndex.continuityRisks[0]).toEqual(expect.objectContaining({ severity: 'high' }));
    expect(pack.metadata.analysisWindows[0].summary).toBe('Opening window');
  });
});

describe('Lab Lite Phase 6 - materialize dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies create, update, and skip without writing during dry-run', async () => {
    const { materializer } = await loadMaterializer({
      characters: [{ id: 10, project_id: 1, name: 'Lan', normalized_name: 'lan', identity_key: 'character:lan', alias_keys: ['lan'] }],
      canonFacts: [{
        id: 20,
        project_id: 1,
        description: 'The seal is already broken.',
        fact_type: 'rule',
        fact_fingerprint: 'rule|the seal is already broken|global',
      }],
    });

    const plan = await materializer.buildMaterializationPlan({
      projectId: 1,
      canonPack: {
        id: 'pack_1',
        title: 'Demo Pack',
        characterCanon: [
          { name: 'Lan', status: 'alive' },
          { name: 'Kha', status: 'missing' },
        ],
        canonRestrictions: ['The seal is already broken.'],
        globalCanon: { hardRestrictions: [], worldRules: [], timelineAnchors: [] },
        styleCanon: { observations: ['Short sharp dialogue.'] },
        chapterCanon: [],
      },
    });

    expect(plan.actions.find((action) => action.type === 'character' && action.source.name === 'Lan').action).toBe('update');
    expect(plan.actions.find((action) => action.type === 'character' && action.source.name === 'Kha').action).toBe('create');
    expect(plan.actions.find((action) => action.type === 'canon_fact').action).toBe('skip');
    expect(plan.summary.create).toBeGreaterThan(0);
  });
});
