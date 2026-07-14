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

class MemoryQuery {
  constructor(table, field = null, rows = null, reversed = false) {
    this.table = table;
    this.field = field;
    this.rows = rows;
    this.reversed = reversed;
  }

  _baseRows() {
    const rows = this.rows ? clone(this.rows) : clone(this.table.rows);
    return this.reversed ? rows.reverse() : rows;
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => row?.[this.field] === expected),
      false
    );
  }

  filter(predicate) {
    return new MemoryQuery(this.table, this.field, this._baseRows().filter(predicate), false);
  }

  reverse() {
    return new MemoryQuery(this.table, this.field, this._baseRows(), true);
  }

  async toArray() {
    return this._baseRows();
  }

  async sortBy(field) {
    return this._baseRows().sort(compareByField(field));
  }

  async delete() {
    await this.table.bulkDelete(this._baseRows().map((row) => row.id).filter(Boolean));
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

  async bulkAdd(records) {
    for (const record of records) {
      await this.add(record);
    }
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
}

async function loadSuggestionStore(seedSuggestions = [], { applyImpl } = {}) {
  vi.resetModules();
  const db = { suggestions: new MemoryTable(seedSuggestions) };
  const canonicalizeCandidateOps = vi.fn(async () => ({ ok: true, revisionId: 777, reports: [] }));
  const applyEntityResolutionSuggestion = vi.fn(applyImpl || (async () => ({ revisionId: null })));
  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/canon/workflow', () => ({ canonicalizeCandidateOps }));
  vi.doMock('../../services/entityIdentity/index.js', () => ({ applyEntityResolutionSuggestion }));

  const module = await import('../../stores/suggestionStore');
  return {
    db,
    store: module.default,
    buildSuggestionCandidateOp: module.buildSuggestionCandidateOp,
    canonicalizeCandidateOps,
    applyEntityResolutionSuggestion,
  };
}

describe('phase10 canon review suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses canon_op_review candidate_op as the reviewed canon operation', async () => {
    const candidateOp = {
      op_type: 'CHARACTER_DIED',
      chapter_id: 11,
      scene_id: 21,
      subject_id: 10,
      subject_name: 'Lan',
      summary: 'Lan hy sinh ở cổng thành.',
      evidence: 'Lan hy sinh ở cổng thành.',
      confidence: 0.92,
      payload: {},
    };
    const { buildSuggestionCandidateOp } = await loadSuggestionStore();

    expect(buildSuggestionCandidateOp({
      type: 'canon_op_review',
      candidate_op: JSON.stringify(candidateOp),
    })).toEqual(candidateOp);
  });

  it('acceptAll commits pending canon review ops by chapter through canonicalizeCandidateOps', async () => {
    const deathOp = {
      op_type: 'CHARACTER_DIED',
      chapter_id: 11,
      scene_id: 21,
      subject_id: 10,
      subject_name: 'Lan',
      summary: 'Lan hy sinh ở cổng thành.',
      evidence: 'Lan hy sinh ở cổng thành.',
      confidence: 0.92,
      payload: {},
    };
    const consumedOp = {
      op_type: 'OBJECT_CONSUMED',
      chapter_id: 11,
      scene_id: 22,
      object_id: 30,
      object_name: 'Ngọc An Hồn',
      summary: 'Ngọc An Hồn đã dùng hết.',
      evidence: 'Ngọc An Hồn đã dùng hết.',
      confidence: 0.9,
      payload: { availability: 'consumed' },
    };
    const { db, store, canonicalizeCandidateOps } = await loadSuggestionStore([
      {
        id: 1,
        project_id: 1,
        type: 'canon_op_review',
        status: 'pending',
        source_chapter_id: 11,
        candidate_op: JSON.stringify(deathOp),
        created_at: 1,
      },
      {
        id: 2,
        project_id: 1,
        type: 'canon_op_review',
        status: 'pending',
        source_chapter_id: 11,
        candidate_op: JSON.stringify(consumedOp),
        created_at: 2,
      },
    ]);

    await store.getState().loadSuggestions(1);
    await store.getState().acceptAll(1);

    expect(canonicalizeCandidateOps).toHaveBeenCalledTimes(1);
    expect(canonicalizeCandidateOps.mock.calls[0][0]).toMatchObject({
      projectId: 1,
      chapterId: 11,
      sourceType: 'suggestion_inbox',
    });
    expect(canonicalizeCandidateOps.mock.calls[0][0].candidateOps.map((op) => op.op_type)).toEqual([
      'CHARACTER_DIED',
      'OBJECT_CONSUMED',
    ]);

    const rows = await db.suggestions.toArray();
    expect(rows.every((row) => row.status === 'accepted')).toBe(true);
    expect(rows.every((row) => row.applied_revision_id === 777)).toBe(true);
  });

  it('quick approval applies only safe entity resolutions and leaves risky items pending', async () => {
    const { db, store, applyEntityResolutionSuggestion } = await loadSuggestionStore([
      {
        id: 1,
        project_id: 1,
        type: 'entity_resolution',
        status: 'pending',
        source_chapter_id: 11,
        quick_approve: true,
        candidate_op: JSON.stringify({
          candidate_ids: [101],
          review_safety: 'quick_approve',
          quick_approve: true,
          risk_flags: [],
          protected_field_changes: [],
          critic: { decision: 'agree' },
        }),
        created_at: 1,
      },
      {
        id: 2,
        project_id: 1,
        type: 'entity_resolution',
        status: 'pending',
        source_chapter_id: 11,
        quick_approve: false,
        candidate_op: JSON.stringify({
          candidate_ids: [102],
          review_safety: 'manual_review',
          quick_approve: false,
          risk_flags: ['possible_alias'],
        }),
        created_at: 2,
      },
    ]);

    await store.getState().loadSuggestions(1);
    await store.getState().acceptAll(1);

    expect(applyEntityResolutionSuggestion).toHaveBeenCalledTimes(1);
    expect(applyEntityResolutionSuggestion).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: 1 }));
    const rows = await db.suggestions.toArray();
    expect(rows.find((row) => row.id === 1)?.status).toBe('accepted');
    expect(rows.find((row) => row.id === 2)?.status).toBe('pending');
  });

  it('quickApproveSafe leaves canon review items pending because they have no resolver-critic safety proof', async () => {
    const { db, store, canonicalizeCandidateOps } = await loadSuggestionStore([
      {
        id: 1,
        project_id: 1,
        type: 'canon_op_review',
        status: 'pending',
        source_chapter_id: 11,
        candidate_op: JSON.stringify({
          op_type: 'CHARACTER_DIED',
          chapter_id: 11,
          subject_id: 9,
          subject_name: 'Lan',
          summary: 'Lan tử vong.',
          evidence: 'Lan tử vong.',
          confidence: 0.9,
          payload: {},
        }),
        created_at: 1,
      },
    ]);

    await store.getState().loadSuggestions(1);
    const result = await store.getState().quickApproveSafe(1);

    expect(canonicalizeCandidateOps).not.toHaveBeenCalled();
    expect((await db.suggestions.get(1)).status).toBe('pending');
    expect(result).toEqual({ acceptedCount: 0, heldCount: 1 });
  });

  it('never sends duplicate-review suggestions through quick approval or the canon batch', async () => {
    const { db, store, canonicalizeCandidateOps, applyEntityResolutionSuggestion } = await loadSuggestionStore([
      {
        id: 3,
        project_id: 1,
        type: 'entity_duplicate_review',
        status: 'pending',
        source_chapter_id: null,
        quick_approve: false,
        candidate_op: JSON.stringify({
          pair_key: 'character:1:2',
          entity_kind: 'character',
          entity_ids: [1, 2],
        }),
        created_at: 3,
      },
    ]);

    await store.getState().loadSuggestions(1);
    const result = await store.getState().acceptAll(1);

    expect(canonicalizeCandidateOps).not.toHaveBeenCalled();
    expect(applyEntityResolutionSuggestion).not.toHaveBeenCalled();
    expect((await db.suggestions.get(3)).status).toBe('pending');
    expect(result).toEqual({ acceptedCount: 0, heldCount: 1 });
  });

  it('keeps later safe suggestions pending when an earlier approval makes their catalog revision stale', async () => {
    let calls = 0;
    const applyImpl = async () => {
      calls += 1;
      if (calls === 2) {
        const error = new Error('Story Bible changed');
        error.code = 'CODEX_CATALOG_STALE';
        throw error;
      }
      return { revisionId: null };
    };
    const safeCandidate = (id) => ({
      id,
      project_id: 1,
      type: 'entity_resolution',
      status: 'pending',
      source_chapter_id: 11,
      quick_approve: true,
      candidate_op: JSON.stringify({
        candidate_ids: [100 + id],
        review_safety: 'quick_approve',
        quick_approve: true,
        risk_flags: [],
        protected_field_changes: [],
        critic: { decision: 'agree' },
      }),
      created_at: id,
    });
    const { db, store } = await loadSuggestionStore([
      safeCandidate(1),
      safeCandidate(2),
    ], { applyImpl });

    await store.getState().loadSuggestions(1);
    const result = await store.getState().acceptAll(1);

    expect(result).toEqual({ acceptedCount: 1, heldCount: 1 });
    expect((await db.suggestions.get(1)).status).toBe('accepted');
    expect((await db.suggestions.get(2)).status).toBe('pending');
    expect((await db.suggestions.get(2)).last_error).toBe('CODEX_CATALOG_STALE');
  });
});
