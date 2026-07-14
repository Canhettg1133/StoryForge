import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../services/db/database.js';
import { applyEntityResolutionSuggestion } from '../../services/entityIdentity/index.js';

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

describe('entity resolution apply transaction', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('keeps the existing canonical identity when matching an extracted alias', async () => {
    const characterId = await db.characters.add({
      project_id: 1,
      name: 'Lan',
      aliases: ['A Lan'],
      role: 'supporting',
      normalized_name: 'lan',
      alias_keys: ['a lan'],
      identity_key: 'character:lan',
      created_at: 1,
    });
    const candidateId = await db.entity_resolution_candidates.add({
      project_id: 1,
      chapter_id: 11,
      job_id: 7,
      entity_kind: 'character',
      raw_name: 'A Lan',
      aliases: ['A Lan'],
      normalized_name: 'a lan',
      identity_key: 'character:a lan',
      payload_json: JSON.stringify({
        name: 'A Lan',
        aliases: ['A Lan'],
        role_hint: 'protagonist',
      }),
      resolution_status: 'pending_review',
      created_at: 1,
      updated_at: 1,
    });
    const suggestionId = await db.suggestions.add({
      project_id: 1,
      type: 'entity_resolution',
      status: 'pending',
      job_id: 7,
      source_chapter_id: 11,
      candidate_op: JSON.stringify({
        candidate_ids: [candidateId],
        entity_kind: 'character',
        recommended_action: 'match_existing',
        recommended_target_id: characterId,
      }),
      created_at: 1,
    });

    await applyEntityResolutionSuggestion({
      suggestionId,
      resolutionAction: 'match_existing',
      targetEntityId: characterId,
    });

    const character = await db.characters.get(characterId);
    expect(character.name).toBe('Lan');
    expect(character.normalized_name).toBe('lan');
    expect(character.identity_key).toBe('character:lan');
    expect(character.role).toBe('supporting');
  });

  it('applies explicitly reviewed blank object fields without overwriting existing values', async () => {
    const ownerId = await db.characters.add({ project_id: 1, name: 'Lan', role: 'supporting' });
    const objectId = await db.objects.add({
      project_id: 1,
      name: 'Ngoc An',
      aliases: [],
      description: '',
      properties: 'Khong the vo',
      owner_character_id: null,
      holder_character_id: null,
      normalized_name: 'ngoc an',
      alias_keys: [],
      identity_key: 'object:ngoc an',
    });
    const candidateId = await db.entity_resolution_candidates.add({
      project_id: 1,
      chapter_id: 11,
      entity_kind: 'object',
      raw_name: 'Ngoc An',
      aliases: ['An Ngoc'],
      payload_json: JSON.stringify({
        name: 'Ngoc An',
        aliases: ['An Ngoc'],
        description: 'Mot bao vat co dai',
        properties: 'Gia tri AI khong duoc ghi de',
        owner_character_id: ownerId,
        holder_character_id: ownerId,
      }),
      resolution_status: 'pending_review',
    });
    const suggestionId = await db.suggestions.add({
      project_id: 1,
      type: 'entity_resolution',
      status: 'pending',
      source_chapter_id: 11,
      candidate_op: JSON.stringify({
        candidate_ids: [candidateId],
        entity_kind: 'object',
        recommended_action: 'match_existing',
        recommended_target_id: objectId,
      }),
    });

    await applyEntityResolutionSuggestion({
      suggestionId,
      resolutionAction: 'match_existing',
      targetEntityId: objectId,
    });

    const object = await db.objects.get(objectId);
    expect(object.aliases).toContain('An Ngoc');
    expect(object.description).toBe('Mot bao vat co dai');
    expect(object.properties).toBe('Khong the vo');
    expect(object.owner_character_id).toBe(ownerId);
    expect(object.holder_character_id).toBe(ownerId);
  });

  it('creates a new central character as supporting unless the hinted role is confirmed separately', async () => {
    const createSuggestion = async (name) => {
      const candidateId = await db.entity_resolution_candidates.add({
        project_id: 1,
        chapter_id: 11,
        entity_kind: 'character',
        raw_name: name,
        aliases: [],
        payload_json: JSON.stringify({ name, aliases: [], role_hint: 'protagonist' }),
        resolution_status: 'pending_review',
      });
      return db.suggestions.add({
        project_id: 1,
        type: 'entity_resolution',
        status: 'pending',
        source_chapter_id: 11,
        candidate_op: JSON.stringify({
          candidate_ids: [candidateId],
          entity_kind: 'character',
          role_hint: 'protagonist',
          recommended_action: 'create_new',
          recommended_target_id: null,
        }),
      });
    };

    const defaultSuggestionId = await createSuggestion('A Lan');
    const defaultResult = await applyEntityResolutionSuggestion({
      suggestionId: defaultSuggestionId,
      resolutionAction: 'create_new',
    });
    const defaultCharacter = await db.characters.get(defaultResult.createdEntries.characters[0].id);
    expect(defaultCharacter.role).toBe('supporting');

    const confirmedSuggestionId = await createSuggestion('B Lan');
    const confirmedResult = await applyEntityResolutionSuggestion({
      suggestionId: confirmedSuggestionId,
      resolutionAction: 'create_new',
      confirmedRole: 'protagonist',
    });
    const confirmedCharacter = await db.characters.get(confirmedResult.createdEntries.characters[0].id);
    expect(confirmedCharacter.role).toBe('protagonist');
  });
});
