import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareByField(field) {
  return (a, b) => {
    const left = a?.[field];
    const right = b?.[field];
    if (left === right) return 0;
    if (left == null) return -1;
    if (right == null) return 1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  };
}

function matchesField(row, field, expected) {
  if (field.startsWith('[') && field.endsWith(']')) {
    const keys = field.slice(1, -1).split('+');
    return keys.every((key, index) => row?.[key] === expected[index]);
  }
  return row?.[field] === expected;
}

class MemoryQuery {
  constructor(table, field = null, rows = null, reversed = false) {
    this.table = table;
    this.field = field;
    this.rows = rows;
    this.reversed = reversed;
  }

  _baseRows() {
    const source = this.rows ? clone(this.rows) : clone(this.table.rows);
    return this.reversed ? source.reverse() : source;
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => matchesField(row, this.field, expected)),
      false,
    );
  }

  anyOf(values) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => values.includes(row?.[this.field])),
      false,
    );
  }

  filter(predicate) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter(predicate),
      false,
    );
  }

  reverse() {
    return new MemoryQuery(this.table, this.field, this._baseRows(), true);
  }

  async toArray() {
    return this._baseRows();
  }

  async first() {
    return this._baseRows()[0];
  }

  async sortBy(field) {
    return this._baseRows().sort(compareByField(field));
  }

  async delete() {
    const ids = this._baseRows().map((row) => row.id).filter(Boolean);
    await this.table.bulkDelete(ids);
  }
}

class MemoryCollection extends MemoryQuery {
  async modify(mutator) {
    for (const row of this.table.rows) {
      mutator(row);
    }
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0) + 1;
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  filter(predicate) {
    return new MemoryQuery(this, null, this.rows.filter(predicate));
  }

  toCollection() {
    return new MemoryCollection(this);
  }

  orderBy(field) {
    return new MemoryQuery(this, null, [...this.rows].sort(compareByField(field)));
  }

  async toArray() {
    return clone(this.rows);
  }

  async sortBy(field) {
    return clone(this.rows).sort(compareByField(field));
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }

  async add(record) {
    const next = clone(record);
    if (next.id == null) {
      next.id = this.nextId++;
    } else {
      this.nextId = Math.max(this.nextId, Number(next.id) + 1);
    }
    this.rows.push(next);
    return next.id;
  }

  async bulkAdd(records) {
    const keys = [];
    for (const record of records) {
      keys.push(await this.add(record));
    }
    return keys;
  }

  async update(id, changes) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(changes) };
    return 1;
  }

  async bulkDelete(ids) {
    const idSet = new Set(ids);
    this.rows = this.rows.filter((row) => !idSet.has(row.id));
  }

  async delete(id) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'projects',
    'chapters',
    'scenes',
    'chapterMeta',
    'characters',
    'locations',
    'objects',
    'worldTerms',
    'suggestions',
    'entity_resolution_candidates',
    'canonFacts',
    'project_analysis_snapshots',
    'relationships',
    'taboos',
    'voicePacks',
    'story_events',
    'entity_state_current',
  ];
  const db = {};
  for (const name of tableNames) {
    db[name] = new MemoryTable(seed[name] || []);
  }
  db.transaction = async (_mode, ...args) => {
    const fn = args[args.length - 1];
    return fn();
  };
  return db;
}

async function loadProjectStoreModule(seed, options = {}) {
  vi.resetModules();
  const db = createMockDb(seed);
  const summarizeChapter = vi.fn(async () => options.summary ?? 'Tom tat');
  const extractFromChapter = vi.fn(async () => options.extracted ?? null);
  const canonicalizeChapter = vi.fn(async () => options.canonResult ?? { ok: true, revisionId: 77 });
  const applyCompletionDelta = vi.fn(async () => undefined);

  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../stores/aiStore', () => ({
    default: {
      getState: () => ({
        summarizeChapter,
        extractFromChapter,
      }),
    },
  }));
  vi.doMock('../../stores/codexStore', () => ({
    default: {
      getState: () => ({
        applyCompletionDelta,
        loadCodex: vi.fn(async () => undefined),
      }),
    },
  }));
  vi.doMock('../../services/canon/workflow', () => ({
    canonicalizeChapter,
  }));
  vi.doMock('../../services/canon/projection', () => ({
    purgeChapterCanonState: vi.fn(async () => null),
    rebuildCanonFromChapter: vi.fn(async () => null),
  }));
  vi.doMock('../../services/db/projectDataService.js', () => ({
    deleteProjectCascade: vi.fn(async () => undefined),
  }));

  const module = await import('../../stores/projectStore.js');
  return {
    db,
    store: module.default,
    mocks: {
      summarizeChapter,
      extractFromChapter,
      canonicalizeChapter,
      applyCompletionDelta,
    },
  };
}

async function loadViewerModule(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  vi.doMock('../../services/db/database.js', () => ({ default: db }));
  const module = await import('../../services/viewer/viewerDbService.js');
  return { db, ...module };
}

describe('phase10 entity materialization flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not materialize extracted entities when canonization fails', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{ name: 'Ly Mac', aliases: ['Mac'] }],
      },
      canonResult: { ok: false, revisionId: 90 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(await db.characters.toArray()).toHaveLength(0);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].resolution_status).toBe('pending_canon');
  });

  it('materializes only after canon pass and creates ambiguity review instead of duplicate character', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
      characters: [
        { id: 1, project_id: 1, name: 'Ngoc Anh', aliases: ['Anh'], normalized_name: 'ngoc anh', alias_keys: ['anh'], identity_key: 'character:ngoc anh' },
        { id: 2, project_id: 1, name: 'Lan Anh', aliases: ['Anh'], normalized_name: 'lan anh', alias_keys: ['anh'], identity_key: 'character:lan anh' },
      ],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{ name: 'Anh' }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(await db.characters.toArray()).toHaveLength(2);
    const suggestions = await db.suggestions.toArray();
    expect(suggestions.some((item) => item.type === 'entity_resolution')).toBe(true);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates[0].resolution_status).toBe('ambiguous_review');
  });

  it('saves analysis snapshot without auto-creating ambiguous character duplicates', async () => {
    const { db, saveAnalysisSnapshotToProject } = await loadViewerModule({
      projects: [{ id: 1, title: 'Snapshot Project', world_rules: '[]', updated_at: 1 }],
      characters: [
        { id: 1, project_id: 1, name: 'Ngoc Anh', aliases: ['Anh'], normalized_name: 'ngoc anh', alias_keys: ['anh'], identity_key: 'character:ngoc anh' },
        { id: 2, project_id: 1, name: 'Lan Anh', aliases: ['Anh'], normalized_name: 'lan anh', alias_keys: ['anh'], identity_key: 'character:lan anh' },
      ],
      locations: [],
      objects: [],
      worldTerms: [],
      suggestions: [],
      entity_resolution_candidates: [],
      project_analysis_snapshots: [],
    });

    const saved = await saveAnalysisSnapshotToProject({
      projectId: 1,
      corpusId: 'corpus-1',
      analysisId: 'analysis-1',
      result: {
        characters: {
          profiles: [{ name: 'Anh' }],
        },
      },
      materializeProjectEntities: true,
    });

    expect(saved.snapshotId).toBeTruthy();
    expect(await db.characters.toArray()).toHaveLength(2);
    const suggestions = await db.suggestions.toArray();
    expect(suggestions.some((item) => item.type === 'entity_resolution')).toBe(true);
  });
});
