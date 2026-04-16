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

function matchesField(row, field, expected) {
  if (field.startsWith('[') && field.endsWith(']')) {
    const keys = field.slice(1, -1).split('+');
    return keys.every((key, index) => row?.[key] === expected[index]);
  }
  return row?.[field] === expected;
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
      this._rows().filter((row) => matchesField(row, this.field, expected))
    );
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
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0) + 1;
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }

  async toArray() {
    return clone(this.rows);
  }

  async add(record) {
    const next = clone(record);
    if (next.id == null) {
      next.id = this.nextId++;
    }
    this.rows.push(next);
    return next.id;
  }

  async update(id, changes) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(changes) };
    return 1;
  }

  async bulkDelete(ids) {
    const idSet = new Set(ids);
    this.rows = this.rows.filter((row) => !idSet.has(row.id));
  }

  async bulkAdd(records) {
    for (const record of records) {
      await this.add(record);
    }
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'projects',
    'chapters',
    'scenes',
    'characters',
    'locations',
    'plotThreads',
    'canonFacts',
    'objects',
    'relationships',
    'chapter_revisions',
    'validator_reports',
    'chapter_commits',
    'chapter_snapshots',
    'story_events',
    'memory_evidence',
  ];

  const db = {};
  tableNames.forEach((name) => {
    db[name] = new MemoryTable(seed[name] || []);
  });
  db.transaction = async (_mode, ...args) => {
    const fn = args[args.length - 1];
    return fn();
  };
  return db;
}

async function loadCanonEngine(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  const sendMock = vi.fn(({ onError }) => onError(new Error('model offline')));
  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/ai/client', () => ({
    default: { send: sendMock },
  }));
  vi.doMock('../../services/ai/promptBuilder', () => ({
    buildPrompt: vi.fn(() => []),
  }));
  const engine = await import('../../services/canon/engine');
  return { db, engine, sendMock };
}

describe('phase10 canon extraction fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to heuristic validation when canon extraction runtime fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, engine, sendMock } = await loadCanonEngine({
      projects: [{ id: 1, title: 'Canon fallback', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lan buoc vao thanh.' }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lan buoc vao thanh.',
        candidate_ops: '[]',
        created_at: 1,
        updated_at: 1,
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
      relationships: [],
      chapter_commits: [],
      chapter_snapshots: [],
      story_events: [],
      memory_evidence: [],
      validator_reports: [],
    });

    const validation = await engine.validateRevision(31, 'canonicalize');

    expect(sendMock).toHaveBeenCalled();
    expect(validation.hasErrors).toBe(false);
    expect(validation.candidateOps).toEqual([]);
    expect(validation.reports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK')).toBe(true);

    const persistedReports = await db.validator_reports.toArray();
    expect(persistedReports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK')).toBe(true);
    warnSpy.mockRestore();
  });
});
