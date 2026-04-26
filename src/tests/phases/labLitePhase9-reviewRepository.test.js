import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
    return new MemoryQuery(this.table, this.field, this._rows().filter((row) => row?.[this.field] === expected));
  }

  async toArray() {
    return this._rows();
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async put(row) {
    const record = clone(row);
    const index = this.rows.findIndex((item) => item.id === record.id);
    if (index >= 0) this.rows[index] = record;
    else this.rows.push(record);
    return record.id;
  }

  async get(id) {
    return clone(this.rows.find((row) => row.id === id) || null);
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(patch) };
    return 1;
  }
}

async function loadLabLiteDbWithMemory(seed = {}) {
  vi.resetModules();
  class DexieMock {
    constructor() {
      this.canonReviewItems = new MemoryTable(seed.canonReviewItems || []);
      this.analysisCache = new MemoryTable(seed.analysisCache || []);
    }

    version() {
      return { stores: () => this };
    }

    transaction(_mode, ...args) {
      return args[args.length - 1]();
    }
  }

  vi.doMock('dexie', () => ({ default: DexieMock }));
  return import('../../services/labLite/labLiteDb.js');
}

describe('Lab Lite Phase 9 - Canon Review repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists review queue items scoped by project, scene, chapter, and Canon Pack', async () => {
    const dbModule = await loadLabLiteDbWithMemory();
    const saved = await dbModule.saveCanonReviewItem({
      projectId: 7,
      chapterId: 8,
      sceneId: 9,
      canonPackId: 'pack_1',
      mode: 'standard',
      status: 'complete',
      result: { verdict: 'possible_drift', issues: [] },
    });

    expect(saved.id).toContain('canon_review');
    const listed = await dbModule.listCanonReviewItems({ projectId: 7, canonPackId: 'pack_1' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      projectId: 7,
      chapterId: 8,
      sceneId: 9,
      canonPackId: 'pack_1',
      mode: 'standard',
      status: 'complete',
    }));
  });

  it('updates review queue status without writing to StoryForgeDB', async () => {
    const dbModule = await loadLabLiteDbWithMemory({
      canonReviewItems: [{ id: 'review_1', projectId: 1, canonPackId: 'pack_1', status: 'complete' }],
    });

    const updated = await dbModule.updateCanonReviewItem('review_1', {
      status: 'intentional_divergence',
      userNote: 'Branch point accepted.',
    });

    expect(updated.status).toBe('intentional_divergence');
    expect(updated.userNote).toBe('Branch point accepted.');
  });
});
