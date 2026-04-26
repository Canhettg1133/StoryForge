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
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
    );
  }

  async toArray() {
    return this._rows();
  }

  async first() {
    return this._rows()[0] || null;
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1;
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async add(row) {
    const record = { ...clone(row), id: row.id || this.nextId++ };
    this.rows.push(record);
    return record.id;
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(patch) };
    return 1;
  }

  async toArray() {
    return clone(this.rows);
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'characters',
    'locations',
    'objects',
    'worldTerms',
    'factions',
    'relationships',
    'timelineEvents',
    'canonFacts',
    'stylePacks',
    'chapters',
    'chapterMeta',
  ];
  const db = {};
  tableNames.forEach((name) => {
    db[name] = new MemoryTable(seed[name] || []);
  });
  db.transaction = async (_mode, ...args) => {
    const callback = args[args.length - 1];
    return callback();
  };
  return db;
}

async function loadMaterializer(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  vi.doMock('../../services/db/database.js', () => ({ default: db }));
  vi.doMock('../../services/db/database', () => ({ default: db }));
  return {
    db,
    materializer: await import('../../services/labLite/materializeCanonPack.js'),
  };
}

describe('Lab Lite Phase 6 - materialization edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes locations, objects, terms, and factions by normalized identity before writing', async () => {
    const { materializer } = await loadMaterializer({
      locations: [{ id: 1, project_id: 9, name: 'Đền Cũ', normalized_name: 'den cu', identity_key: 'location:den cu', alias_keys: ['den cu'] }],
      objects: [{ id: 2, project_id: 9, name: 'Ấn Ngọc', normalized_name: 'an ngoc', identity_key: 'object:an ngoc', alias_keys: ['an ngoc'] }],
      worldTerms: [{ id: 3, project_id: 9, name: 'Linh lực', normalized_name: 'linh luc', identity_key: 'world_term:linh luc', alias_keys: ['linh luc'] }],
      factions: [{ id: 4, project_id: 9, name: 'Thanh Vân Tông', normalized_name: 'thanh van tong', identity_key: 'world_term:thanh van tong', alias_keys: ['thanh van tong'] }],
    });

    const plan = await materializer.buildMaterializationPlan({
      projectId: 9,
      canonPack: {
        id: 'pack_world',
        title: 'World Pack',
        characterCanon: [],
        chapterCanon: [],
        canonRestrictions: [],
        globalCanon: { worldRules: [] },
        metadata: {
          worldUpdates: [
            { type: 'location', name: 'Den Cu', description: 'Một địa điểm đã có.' },
            { type: 'object', name: 'An Ngoc', description: 'Một vật phẩm đã có.' },
            { type: 'term', name: 'Linh luc', description: 'Một thuật ngữ đã có.' },
            { type: 'faction', name: 'Thanh Van Tong', description: 'Một thế lực đã có.' },
          ],
        },
      },
    });

    expect(plan.actions.find((action) => action.type === 'location').action).toBe('update');
    expect(plan.actions.find((action) => action.type === 'object').action).toBe('update');
    expect(plan.actions.find((action) => action.type === 'world_term').action).toBe('update');
    expect(plan.actions.find((action) => action.type === 'faction').action).toBe('update');
    expect(plan.summary.update).toBe(4);
  });

  it('plans chapterMeta records only when a matching project chapter exists', async () => {
    const { materializer } = await loadMaterializer({
      chapters: [
        { id: 101, project_id: 5, order_index: 0, title: 'Chương 1' },
        { id: 102, project_id: 5, order_index: 1, title: 'Chương 2' },
      ],
      chapterMeta: [{ id: 201, project_id: 5, chapter_id: 101, summary: 'Cũ' }],
    });

    const plan = await materializer.buildMaterializationPlan({
      projectId: 5,
      canonPack: {
        id: 'pack_chapter',
        title: 'Chapter Pack',
        characterCanon: [],
        canonRestrictions: [],
        globalCanon: {},
        metadata: {},
        chapterCanon: [
          { chapterIndex: 1, summary: 'Tóm tắt mới.', mainEvents: ['Gặp nhau'], stateChanges: ['Lan đổi ý'] },
          { chapterIndex: 2, summary: 'Chương hai.', mainEvents: ['Rời đền'] },
          { chapterIndex: 99, summary: 'Không có chương tương ứng.' },
        ],
      },
    });

    const metaActions = plan.actions.filter((action) => action.type === 'chapter_meta');
    expect(metaActions.map((action) => action.action)).toEqual(['update', 'create']);
    expect(metaActions[0]).toEqual(expect.objectContaining({ existingId: 201 }));
    expect(metaActions[0].payload.summary).toBe('Tóm tắt mới.');
    expect(metaActions[1].payload.chapter_id).toBe(102);
    expect(plan.actions.some((action) => action.source?.chapterIndex === 99)).toBe(false);
  });

  it('maps relationship canon only after both characters can be resolved', async () => {
    const { materializer } = await loadMaterializer({
      characters: [
        { id: 10, project_id: 8, name: 'Lan', normalized_name: 'lan', identity_key: 'character:lan', alias_keys: ['lan'] },
        { id: 11, project_id: 8, name: 'Kha', normalized_name: 'kha', identity_key: 'character:kha', alias_keys: ['kha'] },
      ],
      relationships: [{ id: 20, project_id: 8, character_a_id: 10, character_b_id: 11, relation_type: 'ally' }],
    });

    const plan = await materializer.buildMaterializationPlan({
      projectId: 8,
      canonPack: {
        id: 'pack_rel',
        title: 'Relationship Pack',
        characterCanon: [],
        chapterCanon: [],
        canonRestrictions: [],
        globalCanon: {},
        metadata: {},
        relationshipCanon: [
          { characterA: 'Lan', characterB: 'Kha', relation: 'đồng minh', change: 'Tin tưởng hơn.' },
          { characterA: 'Lan', characterB: 'Người chưa có', relation: 'bí ẩn', change: 'Cần xác nhận.' },
        ],
      },
    });

    const relationshipActions = plan.actions.filter((action) => action.type === 'relationship');
    expect(relationshipActions.map((action) => action.action)).toEqual(['update', 'needs_review']);
    expect(relationshipActions[0].existingId).toBe(20);
    expect(relationshipActions[0].payload).toEqual(expect.objectContaining({
      character_a_id: 10,
      character_b_id: 11,
      relation_type: 'đồng minh',
      description: 'Tin tưởng hơn.',
    }));
    expect(plan.summary.needs_review).toBe(1);
  });

  it('applies create and update actions to project DB tables while skipping dry-run skip actions', async () => {
    const { db, materializer } = await loadMaterializer({
      characters: [
        { id: 1, project_id: 7, name: 'Lan', normalized_name: 'lan', identity_key: 'character:lan', alias_keys: ['lan'] },
        { id: 2, project_id: 7, name: 'Kha', normalized_name: 'kha', identity_key: 'character:kha', alias_keys: ['kha'] },
      ],
      chapters: [{ id: 30, project_id: 7, order_index: 0, title: 'Chương 1' }],
    });

    const plan = await materializer.buildMaterializationPlan({
      projectId: 7,
      canonPack: {
        id: 'pack_apply',
        title: 'Apply Pack',
        characterCanon: [
          { name: 'Lan', status: 'đã thức tỉnh' },
          { name: 'Kha', status: 'đã quay lại' },
          { name: 'Mộc', status: 'mất tích' },
        ],
        relationshipCanon: [{ characterA: 'Lan', characterB: 'Kha', relation: 'đồng minh', change: 'Cùng giữ bí mật.' }],
        chapterCanon: [{ chapterIndex: 1, summary: 'Lan thức tỉnh.', mainEvents: ['Lan nhận ấn'] }],
        canonRestrictions: ['Không hồi sinh mentor.'],
        globalCanon: { worldRules: ['Ấn ngọc không thể sửa.'], hardRestrictions: [] },
        styleCanon: { observations: ['Nhịp nhanh.'] },
        metadata: {
          worldUpdates: [{ type: 'location', name: 'Đền Cũ', description: 'Nơi mở đầu.' }],
        },
      },
    });

    const applied = await materializer.applyMaterializationPlan(plan);

    expect(applied.appliedCount).toBe(plan.actions.filter((action) => ['create', 'update'].includes(action.action)).length);
    expect((await db.characters.toArray()).find((item) => item.name === 'Lan').current_status).toBe('đã thức tỉnh');
    expect((await db.characters.toArray()).some((item) => item.name === 'Mộc')).toBe(true);
    expect(await db.relationships.toArray()).toHaveLength(1);
    expect(await db.locations.toArray()).toHaveLength(1);
    expect(await db.worldTerms.toArray()).toHaveLength(1);
    expect(await db.timelineEvents.toArray()).toHaveLength(1);
    expect(await db.canonFacts.toArray()).toHaveLength(1);
    expect(await db.stylePacks.toArray()).toHaveLength(1);
    expect(await db.chapterMeta.toArray()).toHaveLength(1);
  });

  it('does not plan writes to canon projection owner tables', async () => {
    const { materializer } = await loadMaterializer({});
    const plan = await materializer.buildMaterializationPlan({
      projectId: 1,
      canonPack: {
        id: 'pack_safe',
        characterCanon: [{ name: 'Lan' }],
        chapterCanon: [{ chapterIndex: 1, summary: 'No matching chapter.' }],
        canonRestrictions: [],
        globalCanon: {},
        metadata: {},
      },
    });

    expect(plan.actions.map((action) => action.type)).not.toContain('story_events');
    expect(plan.actions.map((action) => action.type)).not.toContain('entity_state_current');
  });
});
