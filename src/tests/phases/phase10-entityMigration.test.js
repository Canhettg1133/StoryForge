import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryQuery {
  constructor(table, field, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _rows() {
    return this.rows ? this.rows : this.table.rows;
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
    );
  }

  async modify(mutator) {
    for (const row of this._rows()) {
      mutator(row);
    }
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async toArray() {
    return clone(this.rows);
  }

  async delete(id) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

function createTx(seed) {
  const tables = {};
  Object.entries(seed).forEach(([name, rows]) => {
    tables[name] = new MemoryTable(rows);
  });
  return {
    table(name) {
      return tables[name];
    },
    tables,
  };
}

vi.mock('dexie', () => ({
  default: class Dexie {
    version() {
      return {
        stores: () => ({
          upgrade: () => this,
        }),
      };
    }

    on() {}
  },
}));

const databaseModule = await import('../../services/db/database.js');

describe('phase10 entity migration helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repairs exact duplicate characters and rewrites character references', async () => {
    const tx = createTx({
      characters: [
        { id: 1, project_id: 1, name: 'Ly Mac', normalized_name: 'ly mac', created_at: 1, notes: 'du lieu day du' },
        { id: 2, project_id: 1, name: 'Ly Mac', normalized_name: 'ly mac', created_at: 2, notes: '' },
      ],
      relationships: [{ id: 11, project_id: 1, character_a_id: 2, character_b_id: 9 }],
      objects: [{ id: 12, project_id: 1, owner_character_id: 2 }],
      taboos: [{ id: 13, project_id: 1, character_id: 2 }],
      voicePacks: [{ id: 14, project_id: 1, character_id: 2 }],
      scenes: [{ id: 15, project_id: 1, pov_character_id: 2, characters_present: '[2,9]' }],
      story_events: [{ id: 16, project_id: 1, subject_id: 2, target_id: 2 }],
      entity_state_current: [{ id: 17, project_id: 1, entity_type: 'character', entity_id: 2 }],
    });

    const affected = await databaseModule.repairEntityTableDuplicates(tx, 'characters', 'character');

    expect(affected).toEqual([1]);
    expect(tx.tables.characters.rows).toHaveLength(1);
    expect(tx.tables.relationships.rows[0].character_a_id).toBe(1);
    expect(tx.tables.objects.rows[0].owner_character_id).toBe(1);
    expect(tx.tables.taboos.rows[0].character_id).toBe(1);
    expect(tx.tables.voicePacks.rows[0].character_id).toBe(1);
    expect(tx.tables.scenes.rows[0].pov_character_id).toBe(1);
    expect(tx.tables.scenes.rows[0].characters_present).toBe('[1,9]');
    expect(tx.tables.story_events.rows[0].subject_id).toBe(1);
    expect(tx.tables.story_events.rows[0].target_id).toBe(1);
    expect(tx.tables.entity_state_current.rows[0].entity_id).toBe(1);
  });

  it('repairs duplicate canon facts and rewrites event fact references', async () => {
    const tx = createTx({
      canonFacts: [
        { id: 1, project_id: 1, fact_fingerprint: 'fact|lang co loi nguyen|global', created_at: 1, description: 'Lang co loi nguyen' },
        { id: 2, project_id: 1, fact_fingerprint: 'fact|lang co loi nguyen|global', created_at: 2, description: 'Lang co loi nguyen.' },
      ],
      story_events: [{ id: 21, project_id: 1, fact_id: 2 }],
    });

    const affected = await databaseModule.repairCanonFactDuplicates(tx);

    expect(affected).toEqual([1]);
    expect(tx.tables.canonFacts.rows).toHaveLength(1);
    expect(tx.tables.story_events.rows[0].fact_id).toBe(1);
  });
});
