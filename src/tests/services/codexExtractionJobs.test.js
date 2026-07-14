import { describe, expect, it } from 'vitest';
import {
  buildCodexAnalysisSnapshot,
  enqueueCodexExtractionJob,
  resumeCodexExtractionJobs,
  runCodexExtractionJob,
  stageCodexResolutionPlan,
} from '../../services/codex/codexExtractionJobs.js';

class MemoryTable {
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  }

  where(field) {
    return {
      equals: (value) => ({
        toArray: async () => this.rows.filter((row) => row[field] === value).map((row) => ({ ...row })),
        filter: (predicate) => ({
          toArray: async () => this.rows.filter((row) => row[field] === value && predicate(row)).map((row) => ({ ...row })),
          delete: async () => {
            this.rows = this.rows.filter((row) => row[field] !== value || !predicate(row));
          },
        }),
      }),
    };
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? { ...row } : undefined;
  }

  async add(row) {
    const id = row.id || this.nextId++;
    this.rows.push({ ...row, id });
    return id;
  }

  async bulkAdd(rows, _keys, options = {}) {
    const ids = [];
    for (const row of rows) ids.push(await this.add(row));
    return options.allKeys ? ids : ids[ids.length - 1];
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...patch };
  }

  async toArray() {
    return this.rows.map((row) => ({ ...row }));
  }
}

function createDb(overrides = {}) {
  const db = {
    chapters: new MemoryTable([{ id: 11, project_id: 1, title: 'Chuong 1' }]),
    scenes: new MemoryTable([
      { id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: '<p>Lan buoc vao.</p><p>A Lan dung day.</p>' },
    ]),
    characters: new MemoryTable([{ id: 1, project_id: 1, name: 'Lan', aliases: [], role: 'supporting', updated_at: 1 }]),
    locations: new MemoryTable([]),
    objects: new MemoryTable([{ id: 2, project_id: 1, name: 'Ngoc An', aliases: ['An Ngoc'], owner_character_id: 1, updated_at: 1 }]),
    worldTerms: new MemoryTable([]),
    relationships: new MemoryTable([]),
    entityTimeline: new MemoryTable([]),
    entity_state_current: new MemoryTable([]),
    item_state_current: new MemoryTable([]),
    story_events: new MemoryTable([]),
    canonFacts: new MemoryTable([]),
    memory_evidence: new MemoryTable([]),
    aiJobs: new MemoryTable([]),
    entity_resolution_candidates: new MemoryTable([]),
    suggestions: new MemoryTable([]),
    ...overrides,
  };
  let transactionTail = Promise.resolve();
  db.transaction = async (_mode, ...args) => {
    const fn = args[args.length - 1];
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return db;
}

describe('Codex extraction jobs', () => {
  it('builds stable local hashes and paragraph IDs without Supabase access', async () => {
    const db = createDb();
    const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });

    expect(snapshot.paragraphs).toEqual([
      { id: 'scene-21:p-1', text: 'Lan buoc vao.' },
      { id: 'scene-21:p-2', text: 'A Lan dung day.' },
    ]);
    expect(snapshot.entities.find((item) => item.id === 2)?.aliases).toEqual(['An Ngoc']);
    expect(snapshot.sourceHash).toMatch(/^sha256:/);
    expect(snapshot.catalogRevision).toMatch(/^sha256:/);

    await db.scenes.update(21, { draft_text: '<p>Noi dung da doi.</p>' });
    const changed = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });
    expect(changed.sourceHash).not.toBe(snapshot.sourceHash);
    expect(changed.catalogRevision).toBe(snapshot.catalogRevision);

    await db.canonFacts.add({
      project_id: 1,
      subject_type: 'object',
      subject_id: 2,
      description: 'Ngoc An khong the bi pha huy.',
    });
    const canonChanged = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });
    expect(canonChanged.catalogRevision).not.toBe(changed.catalogRevision);
  });

  it('keeps entity context type-safe when different Story Bible tables reuse the same numeric ID', async () => {
    const db = createDb({
      story_events: new MemoryTable([
        { id: 41, project_id: 1, op_type: 'CHARACTER_STATUS_CHANGED', subject_id: 2, summary: 'character-only' },
        { id: 42, project_id: 1, op_type: 'OBJECT_FOUND', object_id: 2, summary: 'object-only' },
      ]),
      entityTimeline: new MemoryTable([
        { id: 51, project_id: 1, entity_id: 2, entity_type: 'character', description: 'character timeline' },
        { id: 52, project_id: 1, entity_id: 2, entity_type: 'object', description: 'object timeline' },
      ]),
      canonFacts: new MemoryTable([
        { id: 61, project_id: 1, subject_id: 2, subject_type: 'character', description: 'character fact' },
        { id: 62, project_id: 1, subject_id: 2, subject_type: 'object', description: 'object fact' },
      ]),
      memory_evidence: new MemoryTable([
        { id: 71, project_id: 1, target_id: 2, target_type: 'character', evidence_text: 'character evidence' },
        { id: 72, project_id: 1, target_id: 2, target_type: 'object', evidence_text: 'object evidence' },
      ]),
    });

    const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });
    const object = snapshot.entities.find((item) => item.entity_kind === 'object' && item.id === 2);

    expect(object.history.map((item) => item.id)).toEqual([52, 42]);
    expect(object.canon_facts.map((item) => item.id)).toEqual([62]);
    expect(object.source_appearances.map((item) => item.id)).toEqual([72]);
  });

  it('splits unusually long scene paragraphs into bounded stable tool paragraphs', async () => {
    const longParagraph = Array.from({ length: 1500 }, (_, index) => `word${index}`).join(' ');
    const db = createDb({
      scenes: new MemoryTable([
        { id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: `<p>${longParagraph}</p>` },
      ]),
    });

    const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });

    expect(snapshot.paragraphs.length).toBeGreaterThan(1);
    expect(snapshot.paragraphs.every((paragraph) => paragraph.text.length <= 4000)).toBe(true);
    expect(snapshot.paragraphs[0].id).toBe('scene-21:p-1:c-1');
  });

  it('stages every AI decision for review without creating or mutating entities', async () => {
    const db = createDb();
    const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });
    const characterBefore = await db.characters.toArray();
    const plan = {
      source_hash: snapshot.sourceHash,
      catalog_revision: snapshot.catalogRevision,
      decisions: [{
        candidate_key: 'character:a-lan',
        entity_kind: 'character',
        extracted_name: 'A Lan',
        decision: 'create_new',
        target_entity_ids: [],
        canonical_name: 'A Lan',
        aliases: ['Lan con'],
        role_hint: 'protagonist',
        proposed_changes: [{ field: 'appearance', value: 'Ao xanh' }],
        evidence: [{ paragraph_id: 'scene-21:p-2', quote: 'A Lan dung day.' }],
        reasoning: 'Named in the chapter.',
        risk_flags: ['possible_alias'],
        match_tier: 'semantic_candidate',
        protected_field_changes: ['role:protagonist'],
        review_safety: 'manual_review',
        quick_approve: false,
        review_reasons: ['not_existing_match'],
        critic: { decision: 'review', reasoning: 'Could be Lan.', risk_flags: ['possible_alias'] },
      }],
    };

    const result = await stageCodexResolutionPlan({
      db,
      job: { id: 7, project_id: 1, chapter_id: 11, revision_id: 91 },
      snapshot,
      plan,
    });

    expect(result).toEqual({ candidateCount: 1, suggestionCount: 1 });
    expect(await db.characters.toArray()).toEqual(characterBefore);
    const candidates = await db.entity_resolution_candidates.toArray();
    expect(candidates[0]).toEqual(expect.objectContaining({
      resolution_status: 'pending_review',
      job_id: 7,
    }));
    expect(JSON.parse(candidates[0].payload_json)).toEqual(expect.objectContaining({
      role_hint: 'protagonist',
      aliases: ['Lan con'],
      appearance: 'Ao xanh',
    }));
    const suggestions = await db.suggestions.toArray();
    expect(suggestions).toHaveLength(1);
    expect(JSON.parse(suggestions[0].candidate_op)).toEqual(expect.objectContaining({
      canonical_name: 'A Lan',
      aliases: ['Lan con'],
      role_hint: 'protagonist',
      proposed_changes: [{ field: 'appearance', value: 'Ao xanh' }],
    }));
  });

  it('rechecks source and catalog inside the staging transaction', async () => {
    const db = createDb();
    const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: 1, chapterId: 11 });
    const plan = {
      source_hash: snapshot.sourceHash,
      catalog_revision: snapshot.catalogRevision,
      decisions: [],
    };

    await expect(stageCodexResolutionPlan({
      db,
      job: { id: 7, project_id: 1, chapter_id: 11, revision_id: 91 },
      snapshot,
      plan,
      verifySnapshotBuilder: async () => ({
        ...snapshot,
        sourceHash: 'sha256:changed-during-stage',
      }),
    })).rejects.toMatchObject({ code: 'CODEX_JOB_STALE' });

    expect(await db.entity_resolution_candidates.toArray()).toEqual([]);
    expect(await db.suggestions.toArray()).toEqual([]);
  });

  it('keeps a canon-blocked job waiting without starting model work', async () => {
    const db = createDb();
    const job = await enqueueCodexExtractionJob({
      projectId: 1,
      chapterId: 11,
      revisionId: 90,
      canonPassed: false,
    }, { db, schedule: false });

    expect(job.status).toBe('waiting_canon');
    expect(await db.entity_resolution_candidates.toArray()).toHaveLength(0);
    expect(await db.suggestions.toArray()).toHaveLength(0);
  });

  it('persists a retryable job when the local analysis snapshot cannot be built', async () => {
    const db = createDb();
    const buildSnapshot = async () => {
      const error = new Error('IndexedDB read failed');
      error.code = 'CODEX_SNAPSHOT_FAILED';
      throw error;
    };

    const job = await enqueueCodexExtractionJob({
      projectId: 1,
      chapterId: 11,
      revisionId: 91,
      canonPassed: true,
    }, { db, schedule: false, buildSnapshot });

    expect(job.status).toBe('retryable_error');
    expect(job.error_code).toBe('CODEX_SNAPSHOT_FAILED');
    expect((await db.aiJobs.toArray())).toHaveLength(1);
  });

  it('atomically claims a queued job so two tabs cannot run the same analysis', async () => {
    const db = createDb();
    const queued = await enqueueCodexExtractionJob({
      projectId: 1,
      chapterId: 11,
      revisionId: 91,
      canonPassed: true,
    }, { db, schedule: false });
    let agentCalls = 0;
    const runAgent = async () => {
      agentCalls += 1;
      return {
        turns: { resolver: 2, critic: 1, total: 3 },
        plan: {
          source_hash: queued.source_hash,
          catalog_revision: queued.catalog_revision,
          decisions: [{
            candidate_key: 'character:lan',
            entity_kind: 'character',
            extracted_name: 'Lan',
            decision: 'match_existing',
            target_entity_ids: [1],
            canonical_name: null,
            aliases: [],
            role_hint: null,
            proposed_changes: [],
            evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan buoc vao.' }],
            reasoning: 'Exact grounded match.',
            risk_flags: [],
            match_tier: 'exact_normalized_name',
            protected_field_changes: [],
            review_safety: 'quick_approve',
            quick_approve: true,
            review_reasons: [],
            critic: { decision: 'agree', reasoning: 'Exact.', risk_flags: [] },
          }],
        },
      };
    };

    await Promise.all([
      runCodexExtractionJob(queued.id, { db, runAgent }),
      runCodexExtractionJob(queued.id, { db, runAgent }),
    ]);

    expect(agentCalls).toBe(1);
    expect((await db.aiJobs.get(queued.id)).status).toBe('awaiting_review');
    expect(await db.suggestions.toArray()).toHaveLength(1);
  });

  it('marks a valid empty resolution plan completed instead of leaving a zero-item review job', async () => {
    const db = createDb();
    const queued = await enqueueCodexExtractionJob({
      projectId: 1,
      chapterId: 11,
      revisionId: 91,
      canonPassed: true,
    }, { db, schedule: false });
    const runAgent = async () => ({
      turns: { resolver: 2, critic: 0, total: 2 },
      plan: {
        source_hash: queued.source_hash,
        catalog_revision: queued.catalog_revision,
        decisions: [],
      },
    });

    const result = await runCodexExtractionJob(queued.id, { db, runAgent });

    expect(result.status).toBe('completed');
    expect(result.suggestion_count).toBe(0);
    expect(await db.suggestions.toArray()).toEqual([]);
  });

  it('resumes queued and interrupted jobs after a browser reload without auto-running stale work', async () => {
    const now = Date.now();
    const db = createDb({
      aiJobs: new MemoryTable([
        { id: 1, project_id: 1, job_type: 'codex_entity_resolution', status: 'queued' },
        { id: 2, project_id: 1, job_type: 'codex_entity_resolution', status: 'running', started_at: now - 181_000 },
        { id: 3, project_id: 1, job_type: 'codex_entity_resolution', status: 'stale' },
        { id: 4, project_id: 2, job_type: 'codex_entity_resolution', status: 'queued' },
      ]),
    });
    const schedule = vi.fn();

    const resumed = await resumeCodexExtractionJobs(1, { db, schedule, now });

    expect(resumed.map((job) => job.id)).toEqual([1, 2]);
    expect(schedule.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect((await db.aiJobs.get(2)).status).toBe('queued');
    expect((await db.aiJobs.get(2)).error_code).toBe('CODEX_JOB_INTERRUPTED');
    expect((await db.aiJobs.get(3)).status).toBe('stale');
    expect((await db.aiJobs.get(4)).status).toBe('queued');
  });
});
