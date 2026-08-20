import { describe, expect, it } from 'vitest';
import { WORD_COUNT_CACHE_VERSION } from '../../services/projects/sceneWordCounts.js';
import { reconcileProjectWordCounts } from '../../services/projects/wordCountReconciliation.js';

function createTable(rows) {
  const records = new Map(rows.map((row) => [row.id, { ...row }]));
  return {
    records,
    async get(id) {
      const row = records.get(id);
      return row ? { ...row } : undefined;
    },
    async update(id, changes) {
      records.set(id, { ...records.get(id), ...changes });
      return 1;
    },
  };
}

function createDb(seed) {
  const db = {
    scenes: createTable(seed.scenes),
    chapters: createTable(seed.chapters),
  };
  db.transaction = async (...args) => args.at(-1)();
  return db;
}

describe('idle project word-count reconciliation', () => {
  it('does not count scene text before the first idle slice', async () => {
    let releaseIdle;
    let replaceCalls = 0;
    const text = {
      replace() {
        replaceCalls += 1;
        return '';
      },
    };
    const db = createDb({
      scenes: [{ id: 1, project_id: 9, chapter_id: 5, draft_text: text, final_text: '' }],
      chapters: [{ id: 5, project_id: 9, actual_word_count: 0 }],
    });
    const idle = new Promise((resolve) => {
      releaseIdle = resolve;
    });

    const reconciliation = reconcileProjectWordCounts({
      db,
      projectId: 9,
      scenes: [...db.scenes.records.values()],
      waitForIdle: () => idle,
    });
    await Promise.resolve();

    expect(replaceCalls).toBe(0);
    releaseIdle();
    await reconciliation;
    expect(replaceCalls).toBeGreaterThan(0);
  });

  it('backfills legacy scene counts and persists one correct chapter total', async () => {
    const db = createDb({
      scenes: [
        { id: 1, project_id: 9, chapter_id: 5, draft_text: 'một hai', final_text: '' },
        { id: 2, project_id: 9, chapter_id: 5, draft_text: 'ba bốn năm', final_text: '' },
      ],
      chapters: [{ id: 5, project_id: 9, actual_word_count: 99 }],
    });

    const result = await reconcileProjectWordCounts({
      db,
      projectId: 9,
      scenes: [...db.scenes.records.values()],
      waitForIdle: async () => undefined,
    });

    expect((await db.scenes.get(1)).word_count).toBe(2);
    expect((await db.scenes.get(2)).word_count).toBe(3);
    expect((await db.scenes.get(1)).word_count_version).toBe(WORD_COUNT_CACHE_VERSION);
    expect((await db.scenes.get(2)).word_count_version).toBe(WORD_COUNT_CACHE_VERSION);
    expect((await db.chapters.get(5)).actual_word_count).toBe(5);
    expect((await db.chapters.get(5)).word_count_version).toBe(WORD_COUNT_CACHE_VERSION);
    expect(result.chapterWordCounts.get(5)).toBe(5);
  });

  it('reuses verified scene caches without scanning prose during reconciliation', async () => {
    const guardedText = { replace: null };
    const db = createDb({
      scenes: [{
        id: 1,
        project_id: 9,
        chapter_id: 5,
        draft_text: guardedText,
        final_text: '',
        word_count: 2,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      }],
      chapters: [{
        id: 5,
        project_id: 9,
        actual_word_count: 2,
        word_count_version: WORD_COUNT_CACHE_VERSION,
      }],
    });

    const result = await reconcileProjectWordCounts({
      db,
      projectId: 9,
      chapters: [...db.chapters.records.values()],
      scenes: [...db.scenes.records.values()],
      waitForIdle: async () => undefined,
    });

    expect(result.chapterWordCounts.get(5)).toBe(2);
  });

  it('repairs a stale total on a legacy chapter that has no scenes', async () => {
    const chapters = [{ id: 5, project_id: 9, actual_word_count: 99 }];
    const db = createDb({ scenes: [], chapters });

    const result = await reconcileProjectWordCounts({
      db,
      projectId: 9,
      chapters,
      scenes: [],
      waitForIdle: async () => undefined,
    });

    expect((await db.chapters.get(5)).actual_word_count).toBe(0);
    expect((await db.chapters.get(5)).word_count_version).toBe(WORD_COUNT_CACHE_VERSION);
    expect(result.chapterWordCounts.get(5)).toBe(0);
  });

  it('does not overwrite a scene or chapter total when content changed after the snapshot', async () => {
    const db = createDb({
      scenes: [{ id: 1, project_id: 9, chapter_id: 5, draft_text: 'bản cũ', final_text: '' }],
      chapters: [{ id: 5, project_id: 9, actual_word_count: 7 }],
    });
    const snapshot = [...db.scenes.records.values()].map((scene) => ({ ...scene }));

    const result = await reconcileProjectWordCounts({
      db,
      projectId: 9,
      scenes: snapshot,
      waitForIdle: async () => {
        await db.scenes.update(1, { draft_text: 'nội dung vừa autosave' });
      },
    });

    expect((await db.scenes.get(1)).word_count).toBeUndefined();
    expect((await db.chapters.get(5)).actual_word_count).toBe(7);
    expect(result.dirtyChapterIds).toEqual(new Set([5]));
  });
});
