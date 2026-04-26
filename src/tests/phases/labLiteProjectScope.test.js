import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getLabLiteCorpusBundle,
  labLiteDb,
  listIngestBatches,
  listLabLiteCorpuses,
  saveIngestBatch,
  saveParsedCorpus,
} from '../../services/labLite/labLiteDb.js';
import useLabLiteStore from '../../stores/labLiteStore.js';
import { makeParsedCorpus, resetLabLiteDb } from '../helpers/labLiteTestUtils.js';

describe('Lab Lite project-scoped local data', () => {
  beforeEach(async () => {
    await resetLabLiteDb(labLiteDb);
    useLabLiteStore.setState(useLabLiteStore.getInitialState(), true);
  });

  afterEach(async () => {
    useLabLiteStore.setState(useLabLiteStore.getInitialState(), true);
    await labLiteDb.delete();
  });

  it('lists only corpuses that belong to the requested project', async () => {
    await saveParsedCorpus({ ...makeParsedCorpus({ id: 'corpus_project_a', title: 'Dữ liệu dự án A' }), projectId: 'project_a' });
    await saveParsedCorpus({ ...makeParsedCorpus({ id: 'corpus_project_b', title: 'Dữ liệu dự án B' }), projectId: 'project_b' });
    await saveParsedCorpus(makeParsedCorpus({ id: 'corpus_legacy', title: 'Dữ liệu chưa gắn dự án' }));

    const allCorpuses = await listLabLiteCorpuses();
    const projectAOnly = await listLabLiteCorpuses({ projectId: 'project_a', includeUnscoped: false });
    const projectAWithLegacy = await listLabLiteCorpuses({ projectId: 'project_a', includeUnscoped: true });

    expect(allCorpuses.map((corpus) => corpus.id).sort()).toEqual([
      'corpus_legacy',
      'corpus_project_a',
      'corpus_project_b',
    ]);
    expect(projectAOnly.map((corpus) => corpus.id)).toEqual(['corpus_project_a']);
    expect(projectAWithLegacy.map((corpus) => corpus.id).sort()).toEqual(['corpus_legacy', 'corpus_project_a']);
  });

  it('blocks loading a corpus bundle through the wrong project scope', async () => {
    await saveParsedCorpus({ ...makeParsedCorpus({ id: 'corpus_guard_a', chapterCount: 2 }), projectId: 'project_a' });
    await saveIngestBatch({
      corpusId: 'corpus_guard_a',
      projectId: 'project_a',
      type: 'source_story',
      status: 'imported',
    });

    const allowedBundle = await getLabLiteCorpusBundle('corpus_guard_a', { projectId: 'project_a', allowUnscoped: false });
    const blockedBundle = await getLabLiteCorpusBundle('corpus_guard_a', { projectId: 'project_b', allowUnscoped: false });
    const projectBIngest = await listIngestBatches({ projectId: 'project_b' });

    expect(allowedBundle.corpus).toEqual(expect.objectContaining({ id: 'corpus_guard_a', projectId: 'project_a' }));
    expect(allowedBundle.chapters).toHaveLength(2);
    expect(blockedBundle).toEqual(expect.objectContaining({ corpus: null, chapters: [] }));
    expect(projectBIngest).toEqual([]);
  });

  it('resets stale current corpus when switching to a project with no Lab Lite data', async () => {
    await saveParsedCorpus({ ...makeParsedCorpus({ id: 'corpus_store_a', chapterCount: 2 }), projectId: 'project_a' });
    await saveParsedCorpus({ ...makeParsedCorpus({ id: 'corpus_store_b', chapterCount: 1 }), projectId: 'project_b' });

    await useLabLiteStore.getState().initialize({ projectId: 'project_a' });
    expect(useLabLiteStore.getState()).toEqual(expect.objectContaining({
      activeProjectId: 'project_a',
      currentCorpusId: 'corpus_store_a',
    }));
    expect(useLabLiteStore.getState().chapters).toHaveLength(2);

    await useLabLiteStore.getState().initialize({ projectId: 'project_new' });
    expect(useLabLiteStore.getState()).toEqual(expect.objectContaining({
      activeProjectId: 'project_new',
      currentCorpusId: null,
      currentCorpus: null,
      corpuses: [],
      chapters: [],
    }));

    await useLabLiteStore.getState().initialize({ projectId: 'project_b' });
    expect(useLabLiteStore.getState()).toEqual(expect.objectContaining({
      activeProjectId: 'project_b',
      currentCorpusId: 'corpus_store_b',
    }));
    expect(useLabLiteStore.getState().chapters).toHaveLength(1);
  });
});
