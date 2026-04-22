import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

class MemoryQuery {
  constructor(table, field = null, rows = null, reversed = false) {
    this.table = table;
    this.field = field;
    this.rows = rows;
    this.reversed = reversed;
  }

  _rows() {
    const source = this.rows ? clone(this.rows) : clone(this.table.rows);
    return this.reversed ? source.reverse() : source;
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
      false,
    );
  }

  reverse() {
    return new MemoryQuery(this.table, this.field, this._rows(), true);
  }

  async toArray() {
    return this._rows();
  }

  async sortBy(field) {
    return this._rows().sort(compareByField(field));
  }

  async delete() {
    const rows = this._rows();
    const ids = new Set(rows.map((row) => row?.id).filter((id) => id != null));
    this.table.rows = this.table.rows.filter((row) => !ids.has(row?.id));
    return ids.size;
  }
}

class MemoryTable {
  constructor(rows = [], options = {}) {
    this.rows = clone(rows);
    this.options = options;
  }

  where(field) {
    if (this.options.throwOnWhere) {
      throw new Error(this.options.throwOnWhere);
    }
    return new MemoryQuery(this, field);
  }

  orderBy(field) {
    if (this.options.throwOnOrderBy) {
      throw new Error(this.options.throwOnOrderBy);
    }
    return new MemoryQuery(this, null, [...this.rows].sort(compareByField(field)));
  }

  async toArray() {
    return clone(this.rows);
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }

  async update(id, changes) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(changes) };
    return 1;
  }

  async add(record) {
    const nextId = this.rows.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0) + 1;
    const next = { ...clone(record), id: record?.id ?? nextId };
    this.rows.push(next);
    return next.id;
  }

  async delete(id) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.id !== id);
    return before === this.rows.length ? 0 : 1;
  }

  async bulkDelete(ids = []) {
    const idSet = new Set(ids);
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !idSet.has(row.id));
    return before - this.rows.length;
  }
}

function createMockDb(seed = {}, failures = {}) {
  const db = {
    projects: new MemoryTable(seed.projects || [], { throwOnOrderBy: failures.projectsOrderBy }),
    chapters: new MemoryTable(seed.chapters || [], { throwOnWhere: failures.chaptersWhere }),
    scenes: new MemoryTable(seed.scenes || [], { throwOnWhere: failures.scenesWhere }),
    chapterMeta: new MemoryTable(seed.chapterMeta || []),
    characters: new MemoryTable(seed.characters || []),
    locations: new MemoryTable(seed.locations || []),
    objects: new MemoryTable(seed.objects || []),
    worldTerms: new MemoryTable(seed.worldTerms || []),
    suggestions: new MemoryTable(seed.suggestions || []),
    entity_resolution_candidates: new MemoryTable(seed.entity_resolution_candidates || []),
    canonFacts: new MemoryTable(seed.canonFacts || []),
  };
  return db;
}

async function loadProjectStore(seed = {}, failures = {}) {
  vi.resetModules();
  const db = createMockDb(seed, failures);

  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../stores/aiStore', () => ({
    default: {
      getState: () => ({
        summarizeChapter: vi.fn(),
        extractFromChapter: vi.fn(),
      }),
    },
  }));
  vi.doMock('../../stores/codexStore', () => ({
    default: {
      getState: () => ({
        applyCompletionDelta: vi.fn(async () => undefined),
        loadCodex: vi.fn(async () => undefined),
      }),
    },
  }));
  vi.doMock('../../services/canon/workflow', () => ({
    canonicalizeChapter: vi.fn(async () => ({ ok: true, revisionId: 1 })),
  }));
  vi.doMock('../../services/canon/projection', () => ({
    purgeChapterCanonState: vi.fn(async () => null),
    rebuildCanonFromChapter: vi.fn(async () => null),
  }));
  vi.doMock('../../services/db/projectDataService.js', () => ({
    deleteProjectCascade: vi.fn(async () => undefined),
  }));

  const module = await import('../../stores/projectStore.js');
  return { store: module.default, db };
}

describe('phase10 project load resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to raw project scan when updated_at index read fails', async () => {
    const { store } = await loadProjectStore({
      projects: [
        { id: 1, title: 'Older', updated_at: 10 },
        { id: 2, title: 'Newest', updated_at: 20 },
      ],
    }, {
      projectsOrderBy: 'updated_at index unavailable',
    });

    const projects = await store.getState().loadProjects();

    expect(projects.map((project) => project.id)).toEqual([2, 1]);
    expect(store.getState().projects.map((project) => project.id)).toEqual([2, 1]);
  });

  it('falls back to raw chapter and scene scans and clears loading when indexed reads fail', async () => {
    const { store } = await loadProjectStore({
      projects: [{ id: 2, title: 'Project 2', updated_at: 20 }],
      chapters: [
        { id: 11, project_id: 2, order_index: 1, title: 'Chuong 2', actual_word_count: 0 },
        { id: 10, project_id: 2, order_index: 0, title: 'Chuong 1', actual_word_count: 0 },
      ],
      scenes: [
        { id: 21, project_id: 2, chapter_id: 11, order_index: 1, title: 'Canh 2', draft_text: 'hello world', final_text: '' },
        { id: 20, project_id: 2, chapter_id: 10, order_index: 0, title: 'Canh 1', draft_text: 'mot hai ba', final_text: '' },
      ],
    }, {
      chaptersWhere: 'chapter project_id index unavailable',
      scenesWhere: 'scene project_id index unavailable',
    });

    await store.getState().loadProject(2);
    const state = store.getState();

    expect(state.loading).toBe(false);
    expect(state.currentProject?.id).toBe(2);
    expect(state.chapters.map((chapter) => chapter.id)).toEqual([10, 11]);
    expect(state.scenes.map((scene) => scene.id)).toEqual([20, 21]);
    expect(state.activeChapterId).toBe(10);
    expect(state.activeSceneId).toBe(20);
  });

  it('ignores stale loadProject responses that finish after a newer project load', async () => {
    const { store, db } = await loadProjectStore({
      projects: [
        { id: 1, title: 'Project 1', updated_at: 10 },
        { id: 2, title: 'Project 2', updated_at: 20 },
      ],
      chapters: [
        { id: 10, project_id: 1, order_index: 0, title: 'P1 Chapter', actual_word_count: 0 },
        { id: 20, project_id: 2, order_index: 0, title: 'P2 Chapter', actual_word_count: 0 },
      ],
      scenes: [
        { id: 100, project_id: 1, chapter_id: 10, order_index: 0, title: 'P1 Scene', draft_text: 'old', final_text: '' },
        { id: 200, project_id: 2, chapter_id: 20, order_index: 0, title: 'P2 Scene', draft_text: 'new', final_text: '' },
      ],
    });

    const project1 = createDeferred();
    const project2 = createDeferred();

    db.projects.get = vi.fn((id) => {
      if (id === 1) return project1.promise;
      if (id === 2) return project2.promise;
      return Promise.resolve(undefined);
    });

    const firstLoad = store.getState().loadProject(1);
    const secondLoad = store.getState().loadProject(2);

    project2.resolve({ id: 2, title: 'Project 2', updated_at: 20 });
    await secondLoad;

    expect(store.getState().currentProject?.id).toBe(2);
    expect(store.getState().chapters.map((chapter) => chapter.id)).toEqual([20]);
    expect(store.getState().scenes.map((scene) => scene.id)).toEqual([200]);

    project1.resolve({ id: 1, title: 'Project 1', updated_at: 10 });
    await firstLoad;

    expect(store.getState().currentProject?.id).toBe(2);
    expect(store.getState().chapters.map((chapter) => chapter.id)).toEqual([20]);
    expect(store.getState().scenes.map((scene) => scene.id)).toEqual([200]);
    expect(store.getState().activeChapterId).toBe(20);
    expect(store.getState().activeSceneId).toBe(200);
  });

  it('keeps selection near the deleted chapter instead of jumping back to the first chapter', async () => {
    const { store } = await loadProjectStore({
      projects: [{ id: 7, title: 'Project 7', updated_at: 20 }],
      chapters: [
        { id: 10, project_id: 7, order_index: 0, title: 'Chuong 1', actual_word_count: 0 },
        { id: 20, project_id: 7, order_index: 1, title: 'Chuong 2', actual_word_count: 0 },
        { id: 30, project_id: 7, order_index: 2, title: 'Chuong 3', actual_word_count: 0 },
      ],
      scenes: [
        { id: 100, project_id: 7, chapter_id: 10, order_index: 0, title: 'Canh 1', draft_text: 'one', final_text: '' },
        { id: 200, project_id: 7, chapter_id: 20, order_index: 0, title: 'Canh 2', draft_text: 'two', final_text: '' },
        { id: 300, project_id: 7, chapter_id: 30, order_index: 0, title: 'Canh 3', draft_text: 'three', final_text: '' },
      ],
    });

    await store.getState().loadProject(7, { activeChapterId: 20, activeSceneId: 200 });
    await store.getState().deleteChapter(20);

    expect(store.getState().chapters.map((chapter) => chapter.id)).toEqual([10, 30]);
    expect(store.getState().activeChapterId).toBe(30);
    expect(store.getState().activeSceneId).toBe(300);
  });
});
