import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class MemoryQuery {
  constructor(table, field = null, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _rows() {
    return this.rows ? clone(this.rows) : clone(this.table.rows);
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
    );
  }

  filter(predicate) {
    return new MemoryQuery(this.table, this.field, this._rows().filter(predicate));
  }

  async toArray() {
    return this._rows();
  }

  async first() {
    return this._rows()[0];
  }

  async sortBy(field) {
    return this._rows().sort(compareByField(field));
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
    this.readCount = 0;
  }

  where(field) {
    this.readCount += 1;
    return new MemoryQuery(this, field);
  }

  async update(id, changes) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(changes) };
    return 1;
  }
}

function createMockDb(seed = {}) {
  return {
    characters: new MemoryTable(seed.characters || []),
    locations: new MemoryTable(seed.locations || []),
    objects: new MemoryTable(seed.objects || []),
    worldTerms: new MemoryTable(seed.worldTerms || []),
    factions: new MemoryTable(seed.factions || []),
    taboos: new MemoryTable(seed.taboos || []),
    canonFacts: new MemoryTable(seed.canonFacts || []),
    chapterMeta: new MemoryTable(seed.chapterMeta || []),
    entity_state_current: new MemoryTable(seed.entity_state_current || []),
  };
}

async function loadCodexStore(seed = {}) {
  vi.resetModules();
  const db = createMockDb(seed);

  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/canon/state', () => ({
    buildCharacterStateSummary: vi.fn(() => 'summary'),
  }));
  vi.doMock('../../services/entityIdentity/index.js', () => ({
    normalizeEntityIdentity: vi.fn((_kind, input = {}) => ({
      normalized_name: String(input?.name || '').toLowerCase(),
      alias_keys: [],
      identity_key: String(input?.name || '').toLowerCase(),
    })),
  }));
  vi.doMock('../../services/entityIdentity/factIdentity.js', () => ({
    normalizeCanonFactRecord: vi.fn((input = {}) => ({
      fact_fingerprint: input.fact_fingerprint || String(input.description || ''),
    })),
  }));
  vi.doMock('../../utils/proseBuffer', () => ({
    buildProseBuffer: vi.fn(() => ''),
  }));
  vi.doMock('../../utils/characterIdentity', () => ({
    findCharacterIdentityMatch: vi.fn(() => null),
    mergeCharacterPatch: vi.fn(() => ({})),
  }));

  const module = await import('../../stores/codexStore.js');
  return { store: module.default, db };
}

describe('phase10 codex store resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores stale loadCodex responses that finish after a newer project load', async () => {
    const { store, db } = await loadCodexStore({
      characters: [
        { id: 1, project_id: 1, name: 'Old Hero' },
        { id: 2, project_id: 2, name: 'New Hero' },
      ],
      locations: [
        { id: 10, project_id: 1, name: 'Old Place' },
        { id: 20, project_id: 2, name: 'New Place' },
      ],
    });

    const project1Characters = createDeferred();
    const project2Characters = createDeferred();
    const originalWhere = db.characters.where.bind(db.characters);

    db.characters.where = vi.fn((field) => {
      const query = originalWhere(field);
      return {
        equals(projectId) {
          if (field === 'project_id' && projectId === 1) {
            return {
              toArray: () => project1Characters.promise,
            };
          }
          if (field === 'project_id' && projectId === 2) {
            return {
              toArray: () => project2Characters.promise,
            };
          }
          return query.equals(projectId);
        },
      };
    });

    const firstLoad = store.getState().loadCodex(1);
    const secondLoad = store.getState().loadCodex(2);

    project2Characters.resolve([{ id: 2, project_id: 2, name: 'New Hero' }]);
    await secondLoad;

    expect(store.getState().characters.map((item) => item.name)).toEqual(['New Hero']);
    expect(store.getState().locations.map((item) => item.name)).toEqual(['New Place']);

    project1Characters.resolve([{ id: 1, project_id: 1, name: 'Old Hero' }]);
    await firstLoad;

    expect(store.getState().characters.map((item) => item.name)).toEqual(['New Hero']);
    expect(store.getState().locations.map((item) => item.name)).toEqual(['New Place']);
    expect(store.getState().loading).toBe(false);
  });

  it('renders a same-project Codex cache immediately and revalidates without a blocking loader', async () => {
    const { store, db } = await loadCodexStore({
      characters: [{ id: 1, project_id: 1, name: 'Bản đã tải' }],
    });
    await store.getState().loadCodex(1);
    db.characters.rows = [{ id: 1, project_id: 1, name: 'Bản mới trong DB' }];
    const loadingStates = [];
    const unsubscribe = store.subscribe((state) => loadingStates.push(state.loading));

    await store.getState().loadCodex(1, { preferCache: true });

    expect(loadingStates).not.toContain(true);
    expect(store.getState().characters[0].name).toBe('Bản đã tải');
    await vi.waitFor(() => {
      expect(store.getState().characters[0].name).toBe('Bản mới trong DB');
    });
    unsubscribe();
  });

  it('does not let a scheduled background revalidation overwrite a newer project load', async () => {
    const { store, db } = await loadCodexStore({
      characters: [
        { id: 1, project_id: 1, name: 'Project cũ' },
        { id: 2, project_id: 2, name: 'Project mới' },
      ],
    });
    await store.getState().loadCodex(1);
    db.characters.rows = [
      { id: 1, project_id: 1, name: 'Project cũ đã đổi' },
      { id: 2, project_id: 2, name: 'Project mới' },
    ];

    await store.getState().loadCodex(1, { preferCache: true });
    await store.getState().loadCodex(2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.getState().loadedProjectId).toBe(2);
    expect(store.getState().characters.map((item) => item.name)).toEqual(['Project mới']);
  });

  it('does not dedupe a forced refresh onto an older background revalidation', async () => {
    const { store, db } = await loadCodexStore({
      characters: [{ id: 1, project_id: 1, name: 'Bản ban đầu' }],
    });
    await store.getState().loadCodex(1);

    const backgroundCharacters = createDeferred();
    const originalWhere = db.characters.where.bind(db.characters);
    let projectCharacterReads = 0;
    db.characters.where = vi.fn((field) => {
      const query = originalWhere(field);
      return {
        equals(projectId) {
          if (field === 'project_id' && projectId === 1) {
            projectCharacterReads += 1;
            if (projectCharacterReads === 1) {
              return { toArray: () => backgroundCharacters.promise };
            }
          }
          return query.equals(projectId);
        },
      };
    });

    await store.getState().loadCodex(1, { preferCache: true });
    await vi.waitFor(() => expect(projectCharacterReads).toBe(1));

    db.characters.rows = [{ id: 1, project_id: 1, name: 'Bản vừa mutation' }];
    const forcedRefresh = store.getState().loadCodex(1);

    expect(projectCharacterReads).toBe(2);
    await forcedRefresh;
    backgroundCharacters.resolve([{ id: 1, project_id: 1, name: 'Bản nền cũ' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().characters.map((item) => item.name)).toEqual(['Bản vừa mutation']);
  });

  it('contains background revalidation failures and keeps the cached Codex usable', async () => {
    const { store, db } = await loadCodexStore({
      characters: [{ id: 1, project_id: 1, name: 'Bản an toàn' }],
    });
    await store.getState().loadCodex(1);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalWhere = db.characters.where.bind(db.characters);
    db.characters.where = vi.fn((field) => {
      const query = originalWhere(field);
      return {
        equals(projectId) {
          if (field === 'project_id' && projectId === 1) {
            return { toArray: async () => { throw new Error('background read failed'); } };
          }
          return query.equals(projectId);
        },
      };
    });

    await store.getState().loadCodex(1, { preferCache: true });

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(
        '[CodexStore] Background revalidation failed:',
        expect.any(Error),
      );
    });
    expect(store.getState().characters.map((item) => item.name)).toEqual(['Bản an toàn']);
    warning.mockRestore();
  });
});
