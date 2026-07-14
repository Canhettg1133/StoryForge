import { describe, expect, it, vi } from 'vitest';
import {
  mergeStoryBibleEntities,
  previewStoryBibleEntityMerge,
} from '../../services/codex/storyBibleMergeService.js';

class Table {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); }
  where(field) {
    return { equals: (value) => ({ toArray: async () => this.rows.filter((row) => row[field] === value).map((row) => ({ ...row })) }) };
  }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...patch };
  }
  async bulkPut(rows) {
    for (const row of rows) await this.update(row.id, row);
  }
  async delete(id) { this.rows = this.rows.filter((row) => row.id !== id); }
  async bulkDelete(ids) { this.rows = this.rows.filter((row) => !ids.includes(row.id)); }
  async toArray() { return this.rows.map((row) => ({ ...row })); }
}

function db() {
  const value = {
    characters: new Table([
      { id: 1, project_id: 1, name: 'Lan', aliases: [], role: 'supporting', personality: 'Can trong' },
      { id: 2, project_id: 1, name: 'A Lan', aliases: ['Lan con'], role: 'supporting', appearance: 'Ao xanh' },
      { id: 3, project_id: 1, name: 'Minh', aliases: [], role: 'supporting' },
    ]),
    locations: new Table([]),
    objects: new Table([{ id: 1, project_id: 1, name: 'Ngoc An', owner_character_id: 2 }]),
    characterStates: new Table([{ id: 1, project_id: 1, character_id: 2, scene_id: 1 }]),
    factions: new Table([{ id: 1, project_id: 1, name: 'Thanh Mon', leader_character_id: 2, base_location_id: 9 }]),
    taboos: new Table([{ id: 1, project_id: 1, character_id: 2 }]),
    voicePacks: new Table([{ id: 1, project_id: 1, character_id: 2 }]),
    worldTerms: new Table([]),
    relationships: new Table([
      { id: 1, project_id: 1, character_a_id: 2, character_b_id: 3, relation_type: 'ally', description: 'Ban' },
      { id: 2, project_id: 1, character_a_id: 1, character_b_id: 3, relation_type: 'enemy', description: 'Doi thu' },
    ]),
    scenes: new Table([{ id: 1, project_id: 1, characters_present: '[2,3]' }]),
    story_events: new Table([
      {
        id: 1,
        project_id: 1,
        op_type: 'OBJECT_TRANSFERRED',
        subject_id: 2,
        target_id: 3,
        payload: { owner_character_id: 2, holder_character_id: 2, return_to_character_id: 2 },
      },
      { id: 2, project_id: 1, op_type: 'FACT_REGISTERED', subject_id: 2, payload: { subject_type: 'object' } },
    ]),
    entityTimeline: new Table([
      { id: 1, project_id: 1, entity_id: 2, entity_type: 'character' },
      { id: 2, project_id: 1, entity_id: 2, entity_type: 'object' },
    ]),
    entity_state_current: new Table([
      { id: 1, project_id: 1, entity_id: 2, entity_type: 'character' },
      { id: 2, project_id: 1, entity_id: 2, entity_type: 'object' },
    ]),
    item_state_current: new Table([]),
    relationship_state_current: new Table([]),
    canonFacts: new Table([
      {
        id: 1,
        project_id: 1,
        subject_id: 2,
        subject_type: 'character',
        description: 'Lan giu bi mat',
        fact_type: 'secret',
        subject_scope: 'character:2',
        fact_fingerprint: 'secret|lan giu bi mat|character:2',
        related_entity_ids: [2, 3],
      },
      { id: 2, project_id: 1, subject_id: 2, subject_type: 'object', related_entity_ids: [2] },
    ]),
    memory_evidence: new Table([{ id: 1, project_id: 1, target_id: 2, target_type: 'character' }]),
    suggestions: new Table([]),
    entity_resolution_candidates: new Table([{
      id: 1,
      project_id: 1,
      entity_kind: 'character',
      matched_entity_id: 2,
      payload_json: JSON.stringify({
        target_entity_ids: [2],
        recommended_target_id: 2,
      }),
    }]),
    projects: new Table([{ id: 1, title: 'Test' }]),
  };
  value.transaction = async (_mode, ...args) => args[args.length - 1]();
  return value;
}

function mergeGuard(entity) {
  return {
    entity_kind: 'character',
    record: Object.keys(entity).sort().reduce((result, key) => {
      if (key !== 'project_id' && key !== 'entity_kind') result[key] = entity[key];
      return result;
    }, {}),
  };
}

describe('Story Bible merge service', () => {
  it('previews references and rewrites them before deleting the duplicate character', async () => {
    const database = db();
    const preview = await previewStoryBibleEntityMerge({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
    });
    expect(preview.reference_count).toBeGreaterThanOrEqual(6);
    expect(preview.merged.aliases).toEqual(expect.arrayContaining(['A Lan', 'Lan con']));

    await mergeStoryBibleEntities({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
      confirmed: true,
      rebuildProjection: false,
    });

    expect(await database.characters.get(2)).toBeUndefined();
    expect((await database.characters.get(1)).appearance).toBe('Ao xanh');
    expect((await database.objects.get(1)).owner_character_id).toBe(1);
    expect((await database.story_events.get(1)).subject_id).toBe(1);
    expect((await database.story_events.get(1)).payload).toEqual(expect.objectContaining({
      owner_character_id: 1,
      holder_character_id: 1,
      return_to_character_id: 1,
    }));
    expect((await database.story_events.get(2)).subject_id).toBe(2);
    expect((await database.entityTimeline.get(1)).entity_id).toBe(1);
    expect((await database.entityTimeline.get(2)).entity_id).toBe(2);
    expect((await database.entity_state_current.get(1)).entity_id).toBe(1);
    expect((await database.entity_state_current.get(2)).entity_id).toBe(2);
    expect((await database.canonFacts.get(1)).subject_id).toBe(1);
    expect((await database.canonFacts.get(1)).subject_scope).toBe('character:1');
    expect((await database.canonFacts.get(1)).fact_fingerprint).toContain('character:1');
    expect((await database.canonFacts.get(2)).subject_id).toBe(2);
    expect((await database.relationships.get(1)).character_a_id).toBe(1);
    expect((await database.relationships.toArray()).map((row) => row.relation_type).sort()).toEqual(['ally', 'enemy']);
    expect((await database.characterStates.get(1)).character_id).toBe(1);
    expect((await database.factions.get(1)).leader_character_id).toBe(1);
    expect((await database.taboos.get(1)).character_id).toBe(1);
    expect((await database.voicePacks.get(1)).character_id).toBe(1);
    expect(JSON.parse((await database.scenes.get(1)).characters_present)).toEqual([1, 3]);
    expect((await database.entity_resolution_candidates.get(1)).matched_entity_id).toBe(1);
    expect(JSON.parse((await database.entity_resolution_candidates.get(1)).payload_json)).toEqual(expect.objectContaining({
      target_entity_ids: [1],
      recommended_target_id: 1,
    }));
  });

  it('rejects a stale duplicate-review suggestion when either guarded entity changed', async () => {
    const database = db();
    const survivor = await database.characters.get(1);
    const duplicate = await database.characters.get(2);
    database.suggestions.rows.push({
      id: 10,
      project_id: 1,
      type: 'entity_duplicate_review',
      status: 'pending',
      candidate_op: JSON.stringify({
        entity_kind: 'character',
        entity_ids: [1, 2],
        entity_guards: {
          1: mergeGuard(survivor),
          2: mergeGuard(duplicate),
        },
      }),
    });
    await database.characters.update(2, { appearance: 'Da thay doi sau khi AI phan tich' });

    await expect(mergeStoryBibleEntities({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
      suggestionId: 10,
      confirmed: true,
      rebuildProjection: false,
    })).rejects.toMatchObject({ code: 'DUPLICATE_REVIEW_STALE' });

    expect(await database.characters.get(2)).toBeDefined();
    expect((await database.suggestions.get(10)).status).toBe('pending');
  });

  it('accepts the duplicate-review suggestion in the same transaction as the merge', async () => {
    const database = db();
    const survivor = await database.characters.get(1);
    const duplicate = await database.characters.get(2);
    database.suggestions.rows.push({
      id: 11,
      project_id: 1,
      type: 'entity_duplicate_review',
      status: 'pending',
      candidate_op: JSON.stringify({
        entity_kind: 'character',
        entity_ids: [1, 2],
        entity_guards: {
          1: mergeGuard(survivor),
          2: mergeGuard(duplicate),
        },
      }),
    });

    const result = await mergeStoryBibleEntities({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
      suggestionId: 11,
      confirmed: true,
      rebuildProjection: false,
    });

    expect(result.suggestionUpdated).toBe(true);
    expect((await database.suggestions.get(11)).status).toBe('accepted');
    expect(await database.characters.get(2)).toBeUndefined();
  });

  it('preserves an explicitly merged Vietnamese spelling variant as an alias', async () => {
    const database = db();
    database.characters = new Table([
      { id: 1, project_id: 1, name: 'Hòa', aliases: [], role: 'supporting' },
      { id: 2, project_id: 1, name: 'Hoa', aliases: [], role: 'supporting' },
    ]);

    await mergeStoryBibleEntities({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
      confirmed: true,
      rebuildProjection: false,
    });

    expect((await database.characters.get(1)).aliases).toContain('Hoa');
  });

  it('marks canon rebuild required inside the merge transaction and clears it only after rebuild succeeds', async () => {
    const database = db();
    const rebuildProjectionImpl = vi.fn(async () => {
      expect((await database.projects.get(1)).canon_rebuild_required).toBe(true);
    });

    await mergeStoryBibleEntities({
      db: database,
      projectId: 1,
      entityKind: 'character',
      survivorId: 1,
      duplicateId: 2,
      confirmed: true,
      rebuildProjection: true,
      rebuildProjectionImpl,
    });

    expect(rebuildProjectionImpl).toHaveBeenCalledWith(1, null);
    expect((await database.projects.get(1)).canon_rebuild_required).toBe(false);
  });
});
