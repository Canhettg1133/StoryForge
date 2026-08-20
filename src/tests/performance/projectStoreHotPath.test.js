import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class MemoryQuery {
  constructor(table, field, value) {
    this.table = table;
    this.field = field;
    this.value = value;
  }

  async toArray() {
    this.table.queryCount += 1;
    return [...this.table.rows.values()]
      .filter((row) => row?.[this.field] === this.value)
      .map(clone);
  }

  async sortBy(field) {
    const rows = await this.toArray();
    return rows.sort((left, right) => Number(left?.[field] || 0) - Number(right?.[field] || 0));
  }

  async delete() {
    const rows = await this.toArray();
    rows.forEach((row) => this.table.rows.delete(row.id));
    return rows.length;
  }
}

class MemoryWhere {
  constructor(table, field) {
    this.table = table;
    this.field = field;
  }

  equals(value) {
    return new MemoryQuery(this.table, this.field, value);
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = new Map(rows.map((row) => [row.id, clone(row)]));
    this.queryCount = 0;
    this.failNextUpdate = false;
  }

  where(field) {
    return new MemoryWhere(this, field);
  }

  async get(id) {
    return clone(this.rows.get(id));
  }

  async toArray() {
    return [...this.rows.values()].map(clone);
  }

  async update(id, changes) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('simulated update failure');
    }
    const current = this.rows.get(id);
    if (!current) return 0;
    this.rows.set(id, { ...current, ...clone(changes) });
    return 1;
  }

  async delete(id) {
    return this.rows.delete(id) ? 1 : 0;
  }
}

function createMemoryDb(seed) {
  const db = {
    projects: new MemoryTable(seed.projects),
    chapters: new MemoryTable(seed.chapters),
    scenes: new MemoryTable(seed.scenes),
    transactionCount: 0,
  };

  db.transaction = vi.fn(async (...args) => {
    db.transactionCount += 1;
    const callback = args.at(-1);
    const snapshots = new Map(
      [db.projects, db.chapters, db.scenes].map((table) => [table, clone([...table.rows.entries()])]),
    );
    try {
      return await callback();
    } catch (error) {
      snapshots.forEach((rows, table) => {
        table.rows = new Map(rows);
      });
      throw error;
    }
  });

  return db;
}

async function loadStore(seed) {
  vi.resetModules();
  const db = createMemoryDb(seed);

  vi.doMock('../../services/db/database.js', () => ({ default: db }));
  vi.doMock('../../services/storyMirror/outbox.js', () => ({
    enqueueSceneMirror: vi.fn(async () => undefined),
  }));
  vi.doMock('../../stores/aiStore.js', () => ({
    default: { getState: () => ({ summarizeChapter: vi.fn(), extractFromChapter: vi.fn() }) },
  }));
  vi.doMock('../../stores/codexStore.js', () => ({
    default: { getState: () => ({ loadCodex: vi.fn(), applyCompletionDelta: vi.fn() }) },
  }));
  vi.doMock('../../services/canon/workflow.js', () => ({
    canonicalizeChapter: vi.fn(async () => ({ ok: true })),
  }));
  vi.doMock('../../services/canon/projection.js', () => ({
    purgeChapterCanonState: vi.fn(),
    rebuildCanonFromChapter: vi.fn(),
  }));
  vi.doMock('../../services/db/projectDataService.js', () => ({
    deleteProjectCascade: vi.fn(),
  }));

  const store = (await import('../../stores/projectStore.js')).default;
  return { db, store };
}

function makeSeed() {
  return {
    projects: [{ id: 1, title: 'Dự án lớn', updated_at: 1 }],
    chapters: [{
      id: 2,
      project_id: 1,
      order_index: 0,
      title: 'Chương 1',
      actual_word_count: 10,
      word_count_version: 1,
    }],
    scenes: [
      {
        id: 3,
        project_id: 1,
        chapter_id: 2,
        order_index: 0,
        title: 'Cảnh 1',
        draft_text: 'một',
        final_text: '',
        word_count: 1,
        word_count_version: 1,
      },
      {
        id: 4,
        project_id: 1,
        chapter_id: 2,
        order_index: 1,
        title: 'Cảnh 2',
        draft_text: 'a b c d e f g h i',
        final_text: '',
        word_count: 9,
        word_count_version: 1,
      },
    ],
  };
}

describe('project store performance hot paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repairs a stale chapter total from verified scene caches without reading prose', async () => {
    const seed = makeSeed();
    seed.chapters[0].actual_word_count = 77;
    seed.scenes[0].draft_text = { legacy: 'must not be scanned' };
    seed.scenes[1].draft_text = { legacy: 'must not be scanned' };
    const { store } = await loadStore(seed);

    await store.getState().loadProject(1);

    expect(store.getState().chapters[0].actual_word_count).toBe(10);
  });

  it('does not expose a stale zero chapter total when legacy scenes already contain prose', async () => {
    const seed = makeSeed();
    seed.chapters[0].actual_word_count = 0;
    const { store } = await loadStore(seed);

    await store.getState().loadProject(1);

    expect(store.getState().chapters[0].actual_word_count).toBe(10);
  });

  it('rejects a stale versioned chapter total when editing before repaired state is persisted', async () => {
    const seed = makeSeed();
    seed.chapters[0].actual_word_count = 0;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().updateScene(3, { draft_text: 'một hai' });

    expect((await db.chapters.get(2)).actual_word_count).toBe(11);
    expect(store.getState().chapters[0].actual_word_count).toBe(11);
  });

  it('rejects a stale versioned chapter total when deleting before repaired state is persisted', async () => {
    const seed = makeSeed();
    seed.chapters[0].actual_word_count = 0;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().deleteScene(3);

    expect((await db.chapters.get(2)).actual_word_count).toBe(9);
    expect(store.getState().chapters[0].actual_word_count).toBe(9);
  });

  it('updates one scene and the chapter total atomically without scanning the whole chapter', async () => {
    const { db, store } = await loadStore(makeSeed());
    await store.getState().loadProject(1);
    db.scenes.queryCount = 0;

    await store.getState().updateScene(3, { draft_text: 'một hai' });

    expect(db.transactionCount).toBe(1);
    expect(db.scenes.queryCount).toBe(0);
    expect((await db.scenes.get(3)).word_count).toBe(2);
    expect((await db.chapters.get(2)).actual_word_count).toBe(11);
    expect(store.getState().chapters[0].actual_word_count).toBe(11);
  });

  it('does not double-count an edited legacy scene whose stored scene count is stale', async () => {
    const seed = makeSeed();
    seed.scenes[0].word_count = 0;
    delete seed.scenes[0].word_count_version;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().updateScene(3, { draft_text: 'một hai' });

    expect((await db.chapters.get(2)).actual_word_count).toBe(11);
    expect(store.getState().chapters[0].actual_word_count).toBe(11);
  });

  it('does not trust a positive legacy scene count without a cache version', async () => {
    const seed = makeSeed();
    seed.scenes[0].word_count = 5;
    delete seed.scenes[0].word_count_version;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().updateScene(3, { draft_text: 'một hai' });

    expect((await db.chapters.get(2)).actual_word_count).toBe(11);
    expect(store.getState().chapters[0].actual_word_count).toBe(11);
  });

  it('rolls back scene, chapter, and project updates when the atomic save fails', async () => {
    const { db, store } = await loadStore(makeSeed());
    await store.getState().loadProject(1);
    db.chapters.failNextUpdate = true;

    await expect(store.getState().updateScene(3, { draft_text: 'không được lưu' }))
      .rejects.toThrow('simulated update failure');

    expect((await db.scenes.get(3)).draft_text).toBe('một');
    expect((await db.chapters.get(2)).actual_word_count).toBe(10);
    expect((await db.projects.get(1)).updated_at).toBe(1);
  });

  it('moves a scene between chapters without trusting the target aggregate pending persistence', async () => {
    const seed = makeSeed();
    seed.chapters.push({
      id: 5,
      project_id: 1,
      order_index: 1,
      title: 'Chương 2',
      actual_word_count: 0,
      word_count_version: 1,
    });
    seed.scenes.push({
      id: 6,
      project_id: 1,
      chapter_id: 5,
      order_index: 0,
      title: 'Cảnh 1',
      draft_text: 'j k l m n',
      final_text: '',
      word_count: 5,
      word_count_version: 1,
    });
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    expect(store.getState().chapters.find((chapter) => chapter.id === 5)?.actual_word_count).toBe(5);
    expect((await db.chapters.get(5)).actual_word_count).toBe(0);

    await store.getState().updateScene(3, { chapter_id: 5 });

    expect((await db.scenes.get(3)).chapter_id).toBe(5);
    expect((await db.chapters.get(2)).actual_word_count).toBe(9);
    expect((await db.chapters.get(5)).actual_word_count).toBe(6);
    expect(store.getState().chapters.find((chapter) => chapter.id === 2)?.actual_word_count).toBe(9);
    expect(store.getState().chapters.find((chapter) => chapter.id === 5)?.actual_word_count).toBe(6);
  });

  it('subtracts the deleted scene count in the same transaction without recounting chapter text', async () => {
    const { db, store } = await loadStore(makeSeed());
    await store.getState().loadProject(1);

    await store.getState().deleteScene(3);

    expect(db.transactionCount).toBe(1);
    expect(await db.scenes.get(3)).toBeUndefined();
    expect((await db.chapters.get(2)).actual_word_count).toBe(9);
    expect(store.getState().chapters[0].actual_word_count).toBe(9);
  });

  it('rolls back deletion, reindexing, and totals when the chapter update fails', async () => {
    const { db, store } = await loadStore(makeSeed());
    await store.getState().loadProject(1);
    db.chapters.failNextUpdate = true;

    await expect(store.getState().deleteScene(3)).rejects.toThrow('simulated update failure');

    expect((await db.scenes.get(3)).draft_text).toBe('một');
    expect((await db.scenes.get(4)).order_index).toBe(1);
    expect((await db.chapters.get(2)).actual_word_count).toBe(10);
    expect((await db.projects.get(1)).updated_at).toBe(1);
    expect(store.getState().scenes).toHaveLength(2);
    expect(store.getState().chapters[0].actual_word_count).toBe(10);
  });

  it('subtracts prose when deleting a legacy scene whose stored scene count is stale', async () => {
    const seed = makeSeed();
    seed.scenes[0].word_count = 0;
    delete seed.scenes[0].word_count_version;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().deleteScene(3);

    expect((await db.chapters.get(2)).actual_word_count).toBe(9);
    expect(store.getState().chapters[0].actual_word_count).toBe(9);
  });

  it('recounts legacy prose when the scene cache contains an explicit stale zero', async () => {
    const seed = makeSeed();
    seed.scenes[0].word_count = 0;
    delete seed.scenes[0].word_count_version;
    const { db, store } = await loadStore(seed);
    await store.getState().loadProject(1);

    await store.getState().refreshChapterWordCount(2);

    expect((await db.chapters.get(2)).actual_word_count).toBe(10);
    expect(store.getState().chapters[0].actual_word_count).toBe(10);
    expect((await db.scenes.get(3)).word_count_version).toBe(1);
  });
});
