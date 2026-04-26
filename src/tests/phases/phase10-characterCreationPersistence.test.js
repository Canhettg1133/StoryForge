import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import db from '../../services/db/database.js';
import useCodexStore from '../../stores/codexStore.js';

async function createProject() {
  return db.projects.add({
    title: 'Character persistence test',
    genre_primary: 'modern',
    status: 'draft',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
  useCodexStore.setState({
    characters: [],
    locations: [],
    objects: [],
    worldTerms: [],
    factions: [],
    taboos: [],
    canonFacts: [],
    chapterMetas: [],
    loading: false,
  });
}

describe('phase10 character creation persistence', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
  });

  it('persists Ong Tu Lua after Thim Tu Hanh through the shared create path', async () => {
    const projectId = await createProject();
    const store = useCodexStore.getState();

    await store.createCharacter({
      project_id: projectId,
      name: 'Thím Tư Hạnh',
      role: 'supporting',
    });
    const id = await store.createCharacter({
      project_id: projectId,
      name: 'Ông Tư Lúa',
      role: 'supporting',
    });

    const characters = await db.characters.where('project_id').equals(projectId).toArray();
    expect(id).toBeGreaterThan(0);
    expect(characters.map((character) => character.name)).toEqual([
      'Thím Tư Hạnh',
      'Ông Tư Lúa',
    ]);
    expect(useCodexStore.getState().characters.map((character) => character.name)).toEqual([
      'Thím Tư Hạnh',
      'Ông Tư Lúa',
    ]);
  });

  it('persists every approved batch character and refreshes the store once per creation', async () => {
    const projectId = await createProject();
    const store = useCodexStore.getState();
    const seedNames = Array.from({ length: 17 }, (_, index) => `Nhân vật ${index + 1}`);

    for (const name of [...seedNames, 'Thím Tư Hạnh']) {
      await store.createCharacter({ project_id: projectId, name, role: 'supporting' });
    }

    const generatedNames = [
      'Ông Tư Lúa',
      'Bảy Gạo',
      'Cô Năm Sen',
      'Anh Ba Đời',
    ];
    for (const name of generatedNames) {
      await store.createCharacter({ project_id: projectId, name, role: 'supporting' });
    }

    const storedNames = (await db.characters.where('project_id').equals(projectId).toArray())
      .map((character) => character.name);
    for (const name of generatedNames) {
      expect(storedNames).toContain(name);
    }
    expect(storedNames).toHaveLength(22);
    expect(useCodexStore.getState().characters.map((character) => character.name)).toEqual(storedNames);
  });

  it('lets explicit character-page creation bypass fuzzy dedupe', async () => {
    const projectId = await createProject();
    const store = useCodexStore.getState();

    await store.createCharacter({
      project_id: projectId,
      name: 'Tư Lúa',
      role: 'supporting',
      personality: 'Đã có trong canon cũ.',
    });
    await store.createCharacter({
      project_id: projectId,
      name: 'Ông Tư Lúa',
      role: 'supporting',
      personality: 'AI vừa tạo trong batch.',
    }, { dedupe: false });

    const storedNames = (await db.characters.where('project_id').equals(projectId).toArray())
      .map((character) => character.name);

    expect(storedNames).toEqual(['Tư Lúa', 'Ông Tư Lúa']);
    expect(useCodexStore.getState().characters.map((character) => character.name)).toEqual(storedNames);
  });
});
