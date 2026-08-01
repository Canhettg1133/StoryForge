import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertCanonRunAllowed,
  beginBulkCanonRun,
  endBulkCanonRun,
} from '../../services/canon/runLock.js';

function createTable(rows = []) {
  const data = rows.map((row) => ({ ...row }));
  return {
    where(field) {
      return {
        equals(value) {
          const filtered = data.filter((row) => row[field] === value);
          return {
            async toArray() {
              return filtered.map((row) => ({ ...row }));
            },
            async sortBy(sortField) {
              return filtered
                .map((row) => ({ ...row }))
                .sort((a, b) => (a[sortField] || 0) - (b[sortField] || 0));
            },
          };
        },
      };
    },
    async update(id, patch) {
      const index = data.findIndex((row) => row.id === id);
      if (index >= 0) data[index] = { ...data[index], ...patch };
    },
    async get(id) {
      const row = data.find((item) => item.id === id);
      return row ? { ...row } : undefined;
    },
  };
}

async function loadStore(results) {
  vi.resetModules();
  const db = {
    chapters: createTable([
      { id: 11, project_id: 1, order_index: 0, title: 'Chuong 1', status: 'done' },
      { id: 12, project_id: 1, order_index: 1, title: 'Chuong 2', status: 'done' },
      { id: 13, project_id: 1, order_index: 2, title: 'Chuong 3', status: 'done' },
    ]),
    chapter_commits: createTable([
      { id: 21, project_id: 1, chapter_id: 11, status: 'canonical' },
      { id: 22, project_id: 1, chapter_id: 12, status: 'canonical' },
      { id: 23, project_id: 1, chapter_id: 13, status: 'canonical' },
    ]),
  };
  const canonicalizeChapter = vi.fn();
  results.forEach((result) => canonicalizeChapter.mockResolvedValueOnce(result));

  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/canon/workflow', () => ({
    canonicalizeChapter,
    repairChapterRevision: vi.fn(),
    saveRepairDraftRevision: vi.fn(),
  }));
  vi.doMock('../../services/canon/queries', () => ({
    buildRetrievalPacket: vi.fn(async () => ({})),
    getChapterCanonState: vi.fn(async () => ({})),
  }));
  vi.doMock('../../services/canon/projection', () => ({
    invalidateFromChapter: vi.fn(async () => []),
    rebuildCanonFromChapter: vi.fn(async () => ({})),
  }));
  vi.doMock('../../stores/codexStore', () => ({
    default: { getState: () => ({ loadCodex: vi.fn(async () => {}) }) },
  }));
  vi.doMock('../../stores/suggestionStore', () => ({
    default: { getState: () => ({ loadSuggestions: vi.fn(async () => {}) }) },
  }));

  const store = (await import('../../stores/canonStore')).default;
  return { store, db, canonicalizeChapter };
}

describe('phase10 full canon reanalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reanalyzes completed chapters sequentially in chapter order', async () => {
    const { store, canonicalizeChapter } = await loadStore([
      { ok: true, revisionId: 101, committedCount: 1 },
      { ok: true, revisionId: 102, committedCount: 0 },
      { ok: true, revisionId: 103, committedCount: 2 },
    ]);

    const result = await store.getState().reanalyzeCompletedChapters(1);

    expect(result.ok).toBe(true);
    expect(canonicalizeChapter.mock.calls.map((call) => call[1])).toEqual([11, 12, 13]);
    expect(store.getState().bulkProgress).toMatchObject({
      status: 'completed',
      current: 3,
      total: 3,
    });
  });

  it('requires explicit engine success for both one-chapter and bulk canon runs', async () => {
    const direct = await loadStore([null]);
    const directResult = await direct.store.getState().canonicalizeChapter(1, 11);
    expect(directResult).toMatchObject({ ok: false, kind: 'blocked' });

    const bulk = await loadStore([null]);
    const bulkResult = await bulk.store.getState().reanalyzeCompletedChapters(1);
    expect(bulkResult).toMatchObject({ ok: false, kind: 'blocked', chapterId: 11 });
    expect((await bulk.db.chapters.get(11)).status).toBe('draft');
    expect(bulk.canonicalizeChapter).toHaveBeenCalledTimes(1);
  });

  it('blocks unrelated canon runs while the full audit owns the engine lock', () => {
    const token = beginBulkCanonRun();
    try {
      expect(() => assertCanonRunAllowed()).toThrow(/đang rà lại toàn bộ chương/u);
      expect(() => assertCanonRunAllowed(token)).not.toThrow();
    } finally {
      endBulkCanonRun(token);
    }
    expect(() => assertCanonRunAllowed()).not.toThrow();
  });

  it('stops on failure and resumes from the failed chapter', async () => {
    const { store, db, canonicalizeChapter } = await loadStore([
      { ok: true, revisionId: 101, committedCount: 1 },
      { ok: false, revisionId: 102, extractionStatus: 'failed', reports: [] },
      { ok: true, revisionId: 202, committedCount: 1 },
      { ok: true, revisionId: 203, committedCount: 1 },
    ]);

    const failed = await store.getState().reanalyzeCompletedChapters(1);

    expect(failed.ok).toBe(false);
    expect(canonicalizeChapter.mock.calls.map((call) => call[1])).toEqual([11, 12]);
    expect((await db.chapters.get(12)).status).toBe('draft');
    expect(store.getState().bulkProgress).toMatchObject({
      status: 'failed',
      chapterId: 12,
    });

    const resumed = await store.getState().reanalyzeCompletedChapters(1);

    expect(resumed.ok).toBe(true);
    expect(canonicalizeChapter.mock.calls.map((call) => call[1])).toEqual([11, 12, 12, 13]);
    expect((await db.chapters.get(12)).status).toBe('done');
  });
});
