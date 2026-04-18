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

async function loadCanonEngine(seed, sendImpl = null) {
  vi.resetModules();
  const db = createMockDb(seed);
  const sendMock = sendImpl
    ? vi.fn(sendImpl)
    : vi.fn(({ onError }) => onError(new Error('model offline')));
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

  it('keeps extraction runtime fallback as warning in draft mode', async () => {
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

    const validation = await engine.validateRevision(31, 'draft');

    expect(sendMock).toHaveBeenCalled();
    expect(validation.hasErrors).toBe(false);
    expect(validation.candidateOps).toEqual([]);
    expect(validation.reports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK')).toBe(true);

    const persistedReports = await db.validator_reports.toArray();
    expect(persistedReports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK')).toBe(true);
    warnSpy.mockRestore();
  });

  it('does not block canonicalize when canon extraction runtime fails without real canon conflicts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, engine } = await loadCanonEngine({
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

    expect(validation.hasErrors).toBe(false);
    expect(validation.candidateOps).toEqual([]);
    expect(validation.reports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK' && item.severity === 'info')).toBe(true);
    expect(validation.reports.some((item) => item.rule_code === 'NO_COMMITTABLE_CANON_OPS')).toBe(false);

    const persistedReports = await db.validator_reports.toArray();
    expect(persistedReports.some((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK' && item.severity === 'info')).toBe(true);
    warnSpy.mockRestore();
  });

  it('records clearer evidence when AI returns empty canon extract response', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { engine } = await loadCanonEngine({
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
    }, ({ onComplete }) => onComplete(''));

    const validation = await engine.validateRevision(31, 'canonicalize');
    const fallbackReport = validation.reports.find((item) => item.rule_code === 'CANON_EXTRACT_FALLBACK');

    expect(fallbackReport).toBeTruthy();
    expect(fallbackReport.severity).toBe('info');
    expect(fallbackReport.evidence).toContain('AI canon extract returned empty response');
    warnSpy.mockRestore();
  });

  it('does not warn for plain text mentions of dead characters in draft validation', async () => {
    const { engine } = await loadCanonEngine({
      projects: [{ id: 1, title: 'Dead mention', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lan nho ve Minh trong giac mo.' }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lan nho ve Minh trong giac mo.',
        candidate_ops: '[]',
        created_at: 1,
        updated_at: 1,
      }],
      characters: [{ id: 7, project_id: 1, name: 'Minh', current_status: 'Da chet' }],
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
    }, ({ onComplete }) => onComplete('{"ops":[]}'));

    const validation = await engine.validateRevision(31, 'draft');

    expect(validation.reports.some((item) => item.rule_code === 'DRAFT_MENTIONS_DEAD_CHARACTER')).toBe(false);
  });

  it('uses AI adjudication to dismiss validator warning false positives', async () => {
    const { db, engine, sendMock } = await loadCanonEngine({
      projects: [{ id: 1, title: 'Warning adjudication', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lan nghe loi don ve than phan that cua hoang toc.' }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lan nghe loi don ve than phan that cua hoang toc.',
        candidate_ops: '[]',
        created_at: 1,
        updated_at: 1,
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [{ id: 7, project_id: 1, description: 'than phan that cua hoang toc', fact_type: 'secret' }],
      objects: [],
      relationships: [],
      chapter_commits: [],
      chapter_snapshots: [],
      story_events: [],
      memory_evidence: [],
      validator_reports: [],
    }, ({ taskType, onComplete }) => {
      if (taskType === 'canon_adjudicate_warnings') {
        onComplete(JSON.stringify({
          decisions: [{
            warning_index: 0,
            verdict: 'false_positive',
            confidence: 0.92,
            reason: 'Doan nay chi noi ve loi don, khong xac nhan bi mat bi lo.',
            suggested_action: 'dismiss_report',
          }],
        }));
        return;
      }
      onComplete('{"ops":[]}');
    });

    const validation = await engine.validateRevision(31, 'draft');
    const persistedReports = await db.validator_reports.toArray();

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'canon_adjudicate_warnings' }));
    expect(validation.reports.some((item) => item.rule_code === 'DRAFT_TOUCHES_HIDDEN_SECRET')).toBe(false);
    expect(persistedReports.some((item) => item.rule_code === 'DRAFT_TOUCHES_HIDDEN_SECRET')).toBe(false);
  });

  it('downgrades seeded legacy item states without classification to review warnings', async () => {
    const { engine } = await loadCanonEngine({
      projects: [{ id: 1, title: 'Legacy items', genre_primary: 'fantasy' }],
      chapters: [
        { id: 10, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 11, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lam Phong lai nuot Huyet Lien Dan.' }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lam Phong lai nuot Huyet Lien Dan.',
        candidate_ops: JSON.stringify([{
          op_type: 'OBJECT_CONSUMED',
          chapter_id: 11,
          scene_id: 21,
          object_id: 8,
          object_name: 'Huyet Lien Dan',
          evidence: 'Lam Phong lai nuot Huyet Lien Dan.',
          payload: {},
        }]),
        created_at: 1,
        updated_at: 1,
      }],
      objects: [{ id: 8, project_id: 1, name: 'Huyet Lien Dan' }],
      chapter_snapshots: [{
        id: 41,
        project_id: 1,
        chapter_id: 10,
        revision_id: 20,
        snapshot_json: JSON.stringify({
          itemStates: [{ object_id: 8, availability: 'consumed', is_consumed: true }],
        }),
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      relationships: [],
      chapter_commits: [],
      story_events: [],
      memory_evidence: [],
      validator_reports: [],
    }, ({ onComplete }) => onComplete('{"ops":[]}'));

    const validation = await engine.validateRevision(31, 'draft');

    expect(validation.reports.some((item) => item.rule_code === 'ITEM_UNAVAILABLE_REUSED')).toBe(false);
    expect(validation.reports.some((item) => item.rule_code === 'ITEM_REUSE_NEEDS_REVIEW')).toBe(true);
  });

  it('does not send system warnings like missing scene links to AI adjudication', async () => {
    const { engine, sendMock } = await loadCanonEngine({
      projects: [{ id: 1, title: 'System warnings', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lan lap muc tieu moi.' }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lan lap muc tieu moi.',
        candidate_ops: JSON.stringify([{
          op_type: 'GOAL_CHANGED',
          chapter_id: 11,
          scene_id: null,
          subject_id: 5,
          subject_name: 'Lan',
          payload: { new_goal: 'Bao ve gia toc' },
          evidence: 'Lan lap muc tieu moi.',
        }]),
        created_at: 1,
        updated_at: 1,
      }],
      characters: [{ id: 5, project_id: 1, name: 'Lan' }],
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
    }, ({ onComplete }) => onComplete('{"ops":[]}'));

    const validation = await engine.validateRevision(31, 'draft');

    expect(validation.reports.some((item) => item.rule_code === 'MISSING_SCENE_LINK')).toBe(true);
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'canon_adjudicate_warnings' }));
  });
});
