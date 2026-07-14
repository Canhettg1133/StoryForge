import { describe, expect, it, vi } from 'vitest';
import {
  buildExistingDuplicateShortlist,
  runExistingDuplicateAudit,
} from '../../services/codex/duplicateAuditService.js';

class Table {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.nextId = 1; }
  where(field) {
    return {
      equals: (value) => ({
        toArray: async () => this.rows.filter((row) => row[field] === value).map((row) => ({ ...row })),
        filter: (predicate) => ({
          toArray: async () => this.rows.filter((row) => row[field] === value && predicate(row)).map((row) => ({ ...row })),
        }),
      }),
    };
  }
  async toArray() { return this.rows.map((row) => ({ ...row })); }
  async add(row) { const id = row.id || this.nextId++; this.rows.push({ ...row, id }); return id; }
  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...patch };
  }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async bulkAdd(rows) { for (const row of rows) await this.add(row); }
}

function emptyAuditDb() {
  const db = {
    characters: new Table([]),
    locations: new Table([]),
    objects: new Table([]),
    worldTerms: new Table([]),
    suggestions: new Table([]),
    aiJobs: new Table([]),
  };
  db.transaction = async (_mode, ...args) => args[args.length - 1]();
  return db;
}

describe('existing Story Bible duplicate audit shortlist', () => {
  it('uses code only to build a broad same-kind shortlist without deciding merges', () => {
    const shortlist = buildExistingDuplicateShortlist([
      { id: 1, entity_kind: 'character', name: 'Lan', aliases: [] },
      { id: 2, entity_kind: 'character', name: 'A Lan', aliases: [] },
      { id: 1, entity_kind: 'object', name: 'Ấn Ngọc', aliases: [] },
      { id: 2, entity_kind: 'object', name: 'Ngọc Ấn', aliases: [] },
      { id: 1, entity_kind: 'world_term', name: 'Linh lực', aliases: [] },
      { id: 2, entity_kind: 'world_term', name: 'Hệ thống Linh lực', aliases: [] },
      { id: 3, entity_kind: 'world_term', name: 'Kiếm ý', aliases: [] },
    ]);

    expect(shortlist.map((item) => item.pair_key)).toEqual(expect.arrayContaining([
      'character:1:2',
      'object:1:2',
      'world_term:1:2',
    ]));
    expect(shortlist.some((item) => item.pair_key === 'world_term:1:3')).toBe(false);
    expect(shortlist.every((item) => !Object.hasOwn(item, 'decision'))).toBe(true);
  });

  it('completes an empty audit without making a model request or creating a review item', async () => {
    const db = emptyAuditDb();
    const runAgent = vi.fn();

    const job = await runExistingDuplicateAudit({ projectId: 1, db, runAgent });

    expect(runAgent).not.toHaveBeenCalled();
    expect(job.status).toBe('completed');
    expect(job.suggestion_count).toBe(0);
    expect(await db.suggestions.toArray()).toEqual([]);
  });

  it('analyzes only one bounded batch and resumes after pairs recorded by an earlier audit', async () => {
    const db = emptyAuditDb();
    db.characters = new Table([
      { id: 1, project_id: 1, name: 'Lan', aliases: [] },
      { id: 2, project_id: 1, name: 'A Lan', aliases: [] },
      { id: 3, project_id: 1, name: 'Minh', aliases: [] },
      { id: 4, project_id: 1, name: 'Tieu Minh', aliases: [] },
      { id: 5, project_id: 1, name: 'Hoa', aliases: [] },
      { id: 6, project_id: 1, name: 'A Hoa', aliases: [] },
    ]);
    await db.aiJobs.add({
      project_id: 1,
      job_type: 'codex_duplicate_audit',
      status: 'completed',
      audited_pair_keys_json: JSON.stringify(['character:1:2']),
    });
    const analyzedKeys = [];
    const runAgent = vi.fn(async ({ runtime }) => {
      const context = runtime.execute('load_codex_analysis_context', {});
      const paragraph = context.chapter.items[0];
      const candidateKey = paragraph.id.replace(/^audit:/u, '');
      analyzedKeys.push(candidateKey);
      return {
        turns: { resolver: 2, critic: 1, total: 3 },
        plan: {
          source_hash: context.source_hash,
          catalog_revision: context.catalog_revision,
          decisions: [{
            candidate_key: candidateKey,
            entity_kind: 'character',
            extracted_name: 'candidate',
            decision: 'ambiguous',
            target_entity_ids: [],
            canonical_name: null,
            aliases: [],
            role_hint: null,
            proposed_changes: [],
            evidence: [{ paragraph_id: paragraph.id, quote: paragraph.text }],
            reasoning: 'Needs human review.',
            risk_flags: ['possible_duplicate'],
            critic: { decision: 'review', reasoning: 'Insufficient evidence.', risk_flags: [] },
          }],
        },
      };
    });

    const job = await runExistingDuplicateAudit({
      projectId: 1,
      db,
      runAgent,
      batchSize: 1,
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(analyzedKeys).toEqual(['character:3:4']);
    expect(job).toMatchObject({
      shortlist_count: 3,
      already_reviewed_count: 1,
      analyzed_count: 1,
      remaining_count: 1,
      shortlist_truncated: true,
      audited_pair_keys_json: JSON.stringify(['character:3:4']),
    });
  });

  it('rejects a duplicate-audit decision that changes the shortlisted entity kind', async () => {
    const db = emptyAuditDb();
    db.characters = new Table([
      { id: 1, project_id: 1, name: 'Lan', aliases: [] },
      { id: 2, project_id: 1, name: 'A Lan', aliases: [] },
    ]);
    const runAgent = vi.fn(async ({ runtime }) => {
      const context = runtime.execute('load_codex_analysis_context', {});
      const paragraph = context.chapter.items[0];
      return {
        turns: { resolver: 2, critic: 1, total: 3 },
        plan: {
          source_hash: context.source_hash,
          catalog_revision: context.catalog_revision,
          decisions: [{
            candidate_key: 'character:1:2',
            entity_kind: 'object',
            extracted_name: 'Lan',
            decision: 'ambiguous',
            target_entity_ids: [],
            canonical_name: null,
            aliases: [],
            role_hint: null,
            proposed_changes: [],
            evidence: [{ paragraph_id: paragraph.id, quote: paragraph.text }],
            reasoning: 'Invalid cross-kind decision.',
            risk_flags: [],
            critic: { decision: 'review', reasoning: 'Invalid.', risk_flags: [] },
          }],
        },
      };
    });

    const job = await runExistingDuplicateAudit({ projectId: 1, db, runAgent });

    expect(job.status).toBe('retryable_error');
    expect(await db.suggestions.toArray()).toEqual([]);
  });
});
