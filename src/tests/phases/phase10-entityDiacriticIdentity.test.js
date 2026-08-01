import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../services/db/database.js';
import {
  finalizePreparedEntityCandidates,
  prepareEntityCandidatesForCanon,
  resolveChapterExtractCandidate,
  stageExtractedEntityCandidates,
} from '../../services/entityIdentity/index.js';

const PROJECT_ID = 43100;
const CHAPTER_ID = 43101;

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

describe('phase10 chapter entity identity with Vietnamese diacritics', () => {
  beforeEach(async () => {
    await clearDatabase();
    await db.characters.bulkAdd([
      { id: 43111, project_id: PROJECT_ID, name: 'Đỗ Lam', aliases: ['Lam'] },
      { id: 43112, project_id: PROJECT_ID, name: 'Đỗ Lâm', aliases: ['Lâm'] },
    ]);
  });

  afterAll(async () => {
    await clearDatabase();
    db.close();
  });

  it('keeps explicit existing identities separate when names differ only by accents', async () => {
    const staged = await stageExtractedEntityCandidates({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey: 'diacritic-existing-identities',
      sourceType: 'chapter_extract',
      extracted: {
        characters: [
          {
            identity_action: 'existing',
            existing_entity_id: 43111,
            name: 'Đỗ Lam',
            aliases: ['Lam'],
          },
          {
            identity_action: 'existing',
            existing_entity_id: 43112,
            name: 'Đỗ Lâm',
            aliases: ['Lâm'],
          },
        ],
        locations: [],
        objects: [],
        terms: [],
      },
    });

    expect(staged.stagedCount).toBe(2);
    expect(staged.rows.map((row) => JSON.parse(row.payload_json).existing_entity_id))
      .toEqual([43111, 43112]);

    const prepared = await prepareEntityCandidatesForCanon({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey: 'diacritic-existing-identities',
    });

    expect(prepared.ok).toBe(true);
    expect(prepared.stats).toEqual(expect.objectContaining({
      matched_existing: 2,
      rejected: 0,
      skipped_ai_identity: 0,
    }));
  });

  it('keeps two explicit new identities separate when names differ only by accents', async () => {
    const staged = await stageExtractedEntityCandidates({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey: 'diacritic-new-identities',
      sourceType: 'chapter_extract',
      extracted: {
        characters: [
          {
            identity_action: 'new',
            existing_entity_id: null,
            name: 'Hà Mi',
            aliases: [],
          },
          {
            identity_action: 'new',
            existing_entity_id: null,
            name: 'Hạ Mi',
            aliases: [],
          },
        ],
        locations: [],
        objects: [],
        terms: [],
      },
    });

    expect(staged.stagedCount).toBe(2);

    const prepared = await prepareEntityCandidatesForCanon({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey: 'diacritic-new-identities',
    });

    expect(prepared.ok).toBe(true);
    expect(prepared.stats).toEqual(expect.objectContaining({
      created_new: 2,
      rejected: 0,
    }));
    expect((await db.characters.where('project_id').equals(PROJECT_ID).toArray()).map((item) => item.name))
      .toEqual(expect.arrayContaining(['Hà Mi', 'Hạ Mi']));
  });

  it('does not match an AI-new accented name to a differently accented existing name', () => {
    const resolution = resolveChapterExtractCandidate(
      {
        identity_action: 'new',
        existing_entity_id: null,
        name: 'Đỗ Làm',
        aliases: [],
      },
      [{ id: 43112, name: 'Đỗ Lâm', aliases: ['Lâm'] }],
      'character',
    );

    expect(resolution.status).toBe('created_new');
    expect(resolution.matchedEntityId).toBeNull();
  });

  it('does not assign chapter-extract provenance to a matched baseline profile', async () => {
    const sessionKey = 'matched-profile-provenance';
    await stageExtractedEntityCandidates({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey,
      sourceType: 'chapter_extract',
      extracted: {
        characters: [
          {
            identity_action: 'existing',
            existing_entity_id: 43111,
            name: 'Đỗ Lam',
            aliases: ['Lam', 'Nhà âm học'],
          },
          {
            identity_action: 'new',
            existing_entity_id: null,
            name: 'Từ Dạ',
            aliases: ['Người Gõ Nhịp'],
          },
        ],
        locations: [],
        objects: [],
        terms: [],
      },
    });
    const prepared = await prepareEntityCandidatesForCanon({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey,
    });
    const finalized = await finalizePreparedEntityCandidates({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      sessionKey,
      revisionId: 99,
    });

    const baseline = await db.characters.get(43111);
    const created = await db.characters.where('project_id').equals(PROJECT_ID)
      .filter((character) => character.name === 'Từ Dạ')
      .first();
    expect(prepared.ok).toBe(true);
    expect(finalized.stats.matched_existing).toBe(1);
    expect(baseline.aliases).toContain('Nhà âm học');
    expect(baseline.source_kind).toBeUndefined();
    expect(baseline.source_chapter_id).toBeUndefined();
    expect(created).toMatchObject({
      source_kind: 'chapter_extract',
      source_chapter_id: CHAPTER_ID,
    });
  });
});
