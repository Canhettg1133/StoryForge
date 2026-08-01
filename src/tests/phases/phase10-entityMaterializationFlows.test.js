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
    'chapter_commits',
    'chapter_revisions',
    'validator_reports',
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
  const summarizeChapter = vi.fn(
    options.summarizeChapterImpl || (async () => options.summary ?? 'Tom tat'),
  );
  const extractFromChapter = vi.fn(
    options.extractFromChapterImpl || (async () => options.extracted ?? null),
  );
  const canonicalizeChapter = vi.fn(
    options.canonicalizeChapterImpl || (async () => options.canonResult ?? { ok: true, revisionId: 77 }),
  );
  const applyCompletionDelta = vi.fn(
    options.applyCompletionDeltaImpl || (async () => undefined),
  );
  const purgeChapterCanonState = vi.fn(async () => null);
  const rebuildCanonFromChapter = vi.fn(async () => null);

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
    purgeChapterCanonState,
    rebuildCanonFromChapter,
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
      purgeChapterCanonState,
      rebuildCanonFromChapter,
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

  it('blocks a second chapter completion run while the first is still active', async () => {
    let resolveSummary;
    let resolveExtract;
    const summaryPromise = new Promise((resolve) => {
      resolveSummary = resolve;
    });
    const extractPromise = new Promise((resolve) => {
      resolveExtract = resolve;
    });

    const { store, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    }, {
      summarizeChapterImpl: () => summaryPromise,
      extractFromChapterImpl: () => extractPromise,
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    });

    const firstRun = store.getState().runChapterCompletion(11, { mode: 'manual' });
    await vi.waitFor(() => {
      expect(store.getState().chapterCompletionById[11]?.running).toBe(true);
    });
    const secondRun = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(secondRun).toMatchObject({
      ok: false,
      kind: 'busy',
    });
    await vi.waitFor(() => {
      expect(mocks.summarizeChapter).toHaveBeenCalledTimes(1);
      expect(mocks.extractFromChapter).toHaveBeenCalledTimes(1);
    });

    resolveSummary('Tom tat');
    resolveExtract({ characters: [] });

    const firstResult = await firstRun;
    expect(firstResult.ok).toBe(true);
  });

  it('does not materialize extracted entities when canonization fails', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          name: 'Ly Mac',
          aliases: ['Mac'],
          identity_action: 'new',
          existing_entity_id: null,
        }],
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
    expect(candidates[0].resolution_status).toBe('rolled_back');
    expect(mocks.applyCompletionDelta).toHaveBeenCalledWith(expect.objectContaining({
      createdEntries: { characters: [], locations: [], objects: [], worldTerms: [] },
      refreshProjection: false,
    }));
  });

  it('makes a valid new extracted entity available before canonization and keeps it only after success', async () => {
    let mockDb;
    let characterCountAtCanon = -1;
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
        characters: [{
          name: 'Lý Mặc',
          raw_name: { unexpected: true },
          aliases: ['Mặc'],
          identity_action: 'new',
          existing_entity_id: null,
        }],
      },
      canonicalizeChapterImpl: async () => {
        characterCountAtCanon = (await mockDb.characters.toArray()).length;
        return { ok: true, revisionId: 91 };
      },
    });
    mockDb = db;

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(characterCountAtCanon).toBe(1);
    expect(await db.characters.toArray()).toEqual([
      expect.objectContaining({
        name: 'Lý Mặc',
        aliases: ['Mặc'],
        normalized_name: 'ly mac',
        identity_key: 'character:ly mac',
      }),
    ]);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].resolution_status).toBe('created_new');
    expect(result.extractionStats.stats.created_new).toBe(1);
  });

  it('blocks completion when chapter extraction contains invalid identity field types', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          name: { unexpected: true },
          aliases: [],
          identity_action: 'new',
          existing_entity_id: null,
        }],
        locations: [{
          name: 'Động Phủ',
          aliases: [{ unexpected: true }],
          identity_action: 'new',
          existing_entity_id: null,
        }],
        objects: [{
          name: 'Ngọc Bội',
          aliases: [],
          identity_action: { unexpected: true },
          existing_entity_id: null,
        }],
        terms: [{
          name: 'Linh Khí',
          aliases: [],
          identity_action: 'existing',
          existing_entity_id: { unexpected: true },
        }, {
          name: 'Cảnh Giới',
          aliases: [],
          definition: { unexpected: true },
          identity_action: 'new',
          existing_entity_id: null,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect(await db.characters.toArray()).toHaveLength(0);
    expect(await db.locations.toArray()).toHaveLength(0);
    expect(await db.objects.toArray()).toHaveLength(0);
    expect(await db.worldTerms.toArray()).toHaveLength(0);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(5);
    expect(candidates.every((candidate) => candidate.resolution_status === 'rejected')).toBe(true);
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(5);
    expect(result.message).toContain('không thể nhận diện chắc chắn');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('blocks completion when a chapter extraction candidate omits the identity contract', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
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

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect(await db.characters.toArray()).toHaveLength(2);
    const suggestions = await db.suggestions.toArray();
    expect(suggestions.some((item) => item.type === 'entity_resolution')).toBe(false);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates[0].resolution_status).toBe('rejected');
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(1);
    expect(result.message).toContain('không thể nhận diện chắc chắn');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('sends a valid but ambiguous alias to entity review without blocking chapter canon', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh mở cánh cửa nhưng người kể không nói đó là ai.', final_text: '', order_index: 0 }],
      characters: [
        { id: 1, project_id: 1, name: 'Ngọc Anh', aliases: ['Anh'] },
        { id: 2, project_id: 1, name: 'Lan Anh', aliases: ['Anh'] },
      ],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          identity_action: 'new',
          existing_entity_id: null,
          name: 'Anh',
          aliases: [],
        }],
        locations: [],
        objects: [],
        terms: [],
      },
      canonResult: {
        ok: true,
        revisionId: 91,
        extractedCount: 0,
        committedCount: 0,
        filteredCount: 0,
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh mở cánh cửa nhưng người kể không nói đó là ai.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(await db.characters.toArray()).toHaveLength(2);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    expect(result.extractionStats.stats.ambiguous_review).toBe(1);
    expect(result.message).toContain('Hộp đề xuất');
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].resolution_status).toBe('ambiguous_review');
    const suggestions = await db.suggestions.toArray();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      type: 'entity_resolution',
      status: 'pending',
      source_chapter_id: 11,
      target_name: 'Anh',
    });
  });

  it('matches an existing extracted object by validated AI identity and stores its observed alias', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac lay vien Huyet Lien Dan.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [{ id: 5, project_id: 1, name: 'Huyết Liên Đan', aliases: [], description: '' }],
      worldTerms: [],
    }, {
      extracted: {
        objects: [{
          name: 'Huyết Liên Đan',
          aliases: ['Viên Huyết Liên Đan'],
          description: 'Đan dược được Lý Mặc sử dụng.',
          identity_action: 'existing',
          existing_entity_id: 5,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac lay vien Huyet Lien Dan.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    const objects = await db.objects.toArray();
    expect(objects).toHaveLength(1);
    expect(objects[0].aliases).toContain('Viên Huyết Liên Đan');
    expect(objects[0].description).toBe('Đan dược được Lý Mặc sử dụng.');
    expect(result.extractionStats.stats.matched_existing).toBe(1);
  });

  it('preserves the extracted primary name as an alias when AI-new matches an existing object alias', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Vien Huyet Lien Dan xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [{ id: 5, project_id: 1, name: 'Huyết Liên Đan', aliases: [], description: '' }],
      worldTerms: [],
    }, {
      extracted: {
        objects: [{
          name: 'Viên Huyết Liên Đan',
          aliases: ['Huyết Liên Đan'],
          identity_action: 'new',
          existing_entity_id: null,
          owner_character_id: { unexpected: true },
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Vien Huyet Lien Dan xuat hien.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    const objects = await db.objects.toArray();
    expect(objects).toHaveLength(1);
    expect(objects[0].name).toBe('Huyết Liên Đan');
    expect(objects[0].aliases).toEqual(expect.arrayContaining([
      'Huyết Liên Đan',
      'Viên Huyết Liên Đan',
    ]));
    expect(objects[0].owner_character_id ?? null).toBeNull();
    expect(result.extractionStats.stats.matched_existing).toBe(1);
  });

  it('maps an observed short character name through a validated id and stores it as an alias', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Mặc bước vào đại điện.', final_text: '', order_index: 0 }],
      characters: [{ id: 7, project_id: 1, name: 'Lý Mặc', aliases: [], personality: '' }],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          name: 'Lý Mặc',
          aliases: ['Mặc'],
          personality: 'Điềm tĩnh.',
          identity_action: 'existing',
          existing_entity_id: 7,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Mặc bước vào đại điện.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    const characters = await db.characters.toArray();
    expect(characters).toHaveLength(1);
    expect(characters[0].aliases).toContain('Mặc');
    expect(characters[0].personality).toBe('Điềm tĩnh.');
    expect(result.extractionStats.stats.matched_existing).toBe(1);
  });

  it('accepts null optional metadata from a valid existing identity and drops pronoun aliases', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Mai An bước vào kho. Cô kiểm tra la bàn.', final_text: '', order_index: 0 }],
      characters: [{
        id: 7,
        project_id: 1,
        name: 'Mai An',
        aliases: ['An'],
        role: 'protagonist',
        age: '',
        appearance: '',
        personality: '',
        personality_tags: '',
        flaws: '',
      }],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          identity_action: 'existing',
          existing_entity_id: 7,
          name: 'Mai An',
          aliases: ['An', 'Cô'],
          role: 'Người kiểm tra la bàn.',
          age: null,
          appearance: null,
          personality: 'Cẩn trọng.',
          personality_tags: null,
          flaws: null,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Mai An bước vào kho. Cô kiểm tra la bàn.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    const character = await db.characters.get(7);
    expect(character.aliases).toEqual(['An']);
    expect(character.personality).toBe('Cẩn trọng.');
    expect(character.age).toBe('');
    expect(character.appearance).toBe('');
    expect(character.personality_tags).toBe('');
    expect(character.flaws).toBe('');
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(0);
  });

  it('blocks completion when an extracted identity id conflicts with its canonical name', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Huyet Lien Dan xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [
        { id: 5, project_id: 1, name: 'Huyết Liên Đan', aliases: [] },
        { id: 6, project_id: 1, name: 'Cửu Chuyển Đan', aliases: [] },
      ],
      worldTerms: [],
    }, {
      extracted: {
        objects: [{
          name: 'Huyết Liên Đan',
          identity_action: 'existing',
          existing_entity_id: 6,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Huyet Lien Dan xuat hien.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect(await db.objects.toArray()).toHaveLength(2);
    expect(await db.suggestions.toArray()).toHaveLength(0);
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(1);
    expect(result.message).toContain('không thể nhận diện chắc chắn');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('blocks completion when duplicate extracted identities disagree about identity', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Lý Mặc xuất hiện.', final_text: '', order_index: 0 }],
      characters: [{ id: 7, project_id: 1, name: 'Lý Mặc', aliases: [] }],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [
          {
            name: 'Lý Mặc',
            aliases: ['Mặc'],
            identity_action: 'existing',
            existing_entity_id: 7,
          },
          {
            name: 'Lý Mặc',
            aliases: [],
            identity_action: 'new',
            existing_entity_id: null,
          },
        ],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Lý Mặc xuất hiện.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(1);
    expect(result.message).toContain('không thể nhận diện chắc chắn');
    expect((await db.characters.get(7)).aliases).toEqual([]);
    expect(await db.suggestions.toArray()).toHaveLength(0);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].resolution_status).toBe('rejected');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('blocks completion when a chapter extraction item lacks a canonical name', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Một người vô danh xuất hiện.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [{
          aliases: ['Vô Danh'],
          identity_action: 'new',
          existing_entity_id: null,
        }],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Một người vô danh xuất hiện.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect(result.extractionStats.stats.skipped_ai_identity).toBe(1);
    expect(result.message).toContain('không thể nhận diện chắc chắn');
    expect(await db.characters.toArray()).toHaveLength(0);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].resolution_status).toBe('rejected');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('keeps the chapter draft and skips canon when Codex extraction throws', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extractFromChapterImpl: async () => {
        throw new Error('identity roster unavailable');
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect((await db.chapters.get(11)).status).toBe('draft');
    expect(result.extractionWarning).toContain('Không thể trích xuất Codex');
    expect(result.message).toContain('Không thể trích xuất Codex');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('keeps the chapter draft and skips canon when Codex extraction is invalid', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
    }, {
      extracted: null,
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung chuong.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect((await db.chapters.get(11)).status).toBe('draft');
    expect(result.extractionWarning).toContain('AI không trả về dữ liệu Codex hợp lệ');
    expect(result.message).toContain('AI không trả về dữ liệu Codex hợp lệ');
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
  });

  it('finishes summary and Codex extraction for a draft chapter while reusing its fresh canon', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
      chapter_revisions: [{
        id: 501,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'canonical',
        chapter_text: 'Anh nhin ve phia xa.',
      }],
      chapter_commits: [{
        id: 601,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 501,
        canonical_revision_id: 501,
        status: 'canonical',
        warning_count: 0,
        error_count: 0,
      }],
      validator_reports: [],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [],
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(result.canonResult.reused).toBe(true);
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
    expect(mocks.summarizeChapter).toHaveBeenCalledOnce();
    expect(mocks.extractFromChapter).toHaveBeenCalledOnce();
    expect((await db.chapters.get(11)).status).toBe('done');
  });

  it('does not reuse a fresh revision that contains a canon extraction fallback', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
      chapter_revisions: [{
        id: 501,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'canonical',
        chapter_text: 'Anh nhin ve phia xa.',
      }],
      chapter_commits: [{
        id: 601,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 501,
        canonical_revision_id: 501,
        status: 'canonical',
        warning_count: 0,
        error_count: 0,
      }],
      validator_reports: [{
        id: 701,
        project_id: 1,
        chapter_id: 11,
        revision_id: 501,
        rule_code: 'CANON_EXTRACT_FALLBACK',
        severity: 'info',
      }],
    }, {
      extracted: { characters: [] },
      canonResult: {
        ok: true,
        revisionId: 502,
        extractionStatus: 'succeeded',
        extractedCount: 0,
        committedCount: 0,
        filteredCount: 0,
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(result.canonResult.reused).not.toBe(true);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    expect((await db.chapters.get(11)).status).toBe('done');
  });

  it('retries a fresh blocked revision when its canon projection rebuild failed', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
      chapter_revisions: [{
        id: 501,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'blocked',
        chapter_text: 'Anh nhin ve phia xa.',
      }],
      chapter_commits: [{
        id: 601,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 501,
        canonical_revision_id: 501,
        status: 'blocked',
        warning_count: 0,
        error_count: 1,
      }],
      validator_reports: [{
        id: 701,
        project_id: 1,
        chapter_id: 11,
        revision_id: 501,
        rule_code: 'CANON_PROJECTION_REBUILD_FAILED',
        severity: 'error',
      }],
    }, {
      extracted: { characters: [] },
      canonResult: {
        ok: true,
        revisionId: 502,
        extractionStatus: 'succeeded',
        extractedCount: 0,
        committedCount: 0,
        filteredCount: 0,
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Anh nhin ve phia xa.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(result.canonResult.reused).not.toBe(true);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    expect((await db.chapters.get(11)).status).toBe('done');
  });

  it('runs chapter canonization during completion when no fresh canon cache exists', async () => {
    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: {
        characters: [],
      },
      canonResult: { ok: true, revisionId: 91 },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(true);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledWith(
      1,
      11,
      expect.objectContaining({
        routeOptions: expect.any(Object),
      }),
    );
    expect(result.canonResult).toMatchObject({ ok: true, revisionId: 91 });
    expect((await db.chapters.get(11)).status).toBe('done');
  });

  it('keeps the chapter draft when the canon engine returns no explicit success result', async () => {
    const { store, db } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Nội dung chương.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      extracted: { characters: [], locations: [], objects: [], terms: [] },
      canonicalizeChapterImpl: async () => null,
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Nội dung chương.', final_text: '', order_index: 0 }],
    });

    const result = await store.getState().runChapterCompletion(11, { mode: 'manual' });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('blocked');
    expect((await db.chapters.get(11)).status).toBe('draft');
  });

  it('waits for Codex extraction before starting canonization', async () => {
    let resolveSummary;
    let resolveExtract;
    let summaryResolved = false;
    let extractResolved = false;
    let canonStartedAfterAnalysisSettled = false;
    const summaryPromise = new Promise((resolve) => {
      resolveSummary = (value) => {
        summaryResolved = true;
        resolve(value);
      };
    });
    const extractPromise = new Promise((resolve) => {
      resolveExtract = (value) => {
        extractResolved = true;
        resolve(value);
      };
    });

    const { store, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      summarizeChapterImpl: () => summaryPromise,
      extractFromChapterImpl: () => extractPromise,
      canonicalizeChapterImpl: async () => {
        canonStartedAfterAnalysisSettled = summaryResolved && extractResolved;
        return { ok: true, revisionId: 91 };
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Ly Mac xuat hien.', final_text: '', order_index: 0 }],
    });

    const completionPromise = store.getState().runChapterCompletion(11, { mode: 'manual' });

    await vi.waitFor(() => {
      expect(mocks.extractFromChapter).toHaveBeenCalledTimes(1);
    });
    expect(mocks.canonicalizeChapter).not.toHaveBeenCalled();
    resolveSummary('Tom tat');
    resolveExtract({ characters: [] });

    await vi.waitFor(() => {
      expect(mocks.canonicalizeChapter).toHaveBeenCalledTimes(1);
    });
    expect(canonStartedAfterAnalysisSettled).toBe(true);
    expect(mocks.canonicalizeChapter).toHaveBeenCalledWith(
      1,
      11,
      expect.objectContaining({
        allowConcurrent: true,
        routeOptions: expect.any(Object),
      }),
    );

    const result = await completionPromise;
    expect(result.ok).toBe(true);
  });

  it('abandons chapter completion commit when chapter text changes during canonicalization', async () => {
    let releaseCanon;
    const canonStarted = new Promise((resolve) => {
      releaseCanon = resolve;
    });
    let resumeCanon;
    const canonPause = new Promise((resolve) => {
      resumeCanon = resolve;
    });

    const { store, db, mocks } = await loadProjectStoreModule({
      projects: [{ id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung cu.', final_text: '', order_index: 0 }],
      characters: [],
      locations: [],
      objects: [],
      worldTerms: [],
    }, {
      summary: 'Tom tat cu',
      extracted: {
        characters: [{
          name: 'Ly Mac',
          aliases: [],
          identity_action: 'new',
          existing_entity_id: null,
        }],
      },
      canonicalizeChapterImpl: async () => {
        releaseCanon();
        await canonPause;
        return { ok: true, revisionId: 99 };
      },
    });

    store.setState({
      currentProject: { id: 1, title: 'Test', genre_primary: 'fantasy', prompt_templates: '{}', updated_at: 1 },
      chapters: [{ id: 11, project_id: 1, title: 'Chuong 1', status: 'draft', actual_word_count: 100 }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, draft_text: 'Noi dung cu.', final_text: '', order_index: 0 }],
    });

    const completionPromise = store.getState().runChapterCompletion(11, { mode: 'manual' });

    await canonStarted;
    await db.scenes.update(21, { draft_text: 'Noi dung moi vua duoc sua.' });
    resumeCanon();

    const result = await completionPromise;

    expect(result).toMatchObject({
      ok: false,
      kind: 'stale',
    });
    expect((await db.chapters.get(11)).status).toBe('draft');
    expect(await db.characters.toArray()).toHaveLength(0);
    expect(await db.chapterMeta.toArray()).toHaveLength(0);
    expect(await db.entity_resolution_candidates.toArray()).toHaveLength(0);
    expect(mocks.applyCompletionDelta).not.toHaveBeenCalled();
    expect(mocks.purgeChapterCanonState).toHaveBeenCalledWith(1, 11);
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
