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
  constructor(table, field = null, rows = null, reversed = false) {
    this.table = table;
    this.field = field;
    this.rows = rows;
    this.reversed = reversed;
  }

  _baseRows() {
    const source = this.rows ? clone(this.rows) : clone(this.table.rows);
    return this.reversed ? source.reverse() : source;
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => matchesField(row, this.field, expected)),
      false
    );
  }

  anyOf(values) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => values.includes(row?.[this.field])),
      false
    );
  }

  filter(predicate) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter(predicate),
      false
    );
  }

  reverse() {
    return new MemoryQuery(this.table, this.field, this._baseRows(), true);
  }

  async toArray() {
    return this._baseRows();
  }

  async first() {
    return this._baseRows()[0];
  }

  async sortBy(field) {
    return this._baseRows().sort(compareByField(field));
  }

  async delete() {
    const ids = this._baseRows().map((row) => row.id).filter(Boolean);
    await this.table.bulkDelete(ids);
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

  filter(predicate) {
    return new MemoryQuery(this, null, this.rows.filter(predicate));
  }

  async toArray() {
    return clone(this.rows);
  }

  async sortBy(field) {
    return clone(this.rows).sort(compareByField(field));
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }

  async add(record) {
    const next = clone(record);
    if (next.id == null) {
      next.id = this.nextId++;
    } else {
      this.nextId = Math.max(this.nextId, Number(next.id) + 1);
    }
    this.rows.push(next);
    return next.id;
  }

  async bulkAdd(records) {
    for (const record of records) {
      await this.add(record);
    }
  }

  async bulkPut(records) {
    for (const record of records) {
      if (record?.id != null && this.rows.some((row) => row.id === record.id)) {
        await this.update(record.id, record);
      } else {
        await this.add(record);
      }
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

  async delete(id) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'projects',
    'chapters',
    'scenes',
    'characters',
    'characterStates',
    'relationships',
    'locations',
    'objects',
    'canonFacts',
    'plotThreads',
    'threadBeats',
    'timelineEvents',
    'stylePacks',
    'voicePacks',
    'styleJobs',
    'genrePacks',
    'aiJobs',
    'revisions',
    'qaReports',
    'worldTerms',
    'taboos',
    'chapterMeta',
    'suggestions',
    'entityTimeline',
    'factions',
    'macro_arcs',
    'arcs',
    'story_events',
    'entity_state_current',
    'plot_thread_state',
    'validator_reports',
    'memory_evidence',
    'chapter_revisions',
    'chapter_commits',
    'chapter_snapshots',
    'item_state_current',
    'relationship_state_current',
    'canon_purge_archives',
  ];

  const db = {};
  for (const name of tableNames) {
    db[name] = new MemoryTable(seed[name] || []);
  }
  db.transaction = async (_mode, ...args) => {
    const fn = args[args.length - 1];
    return fn();
  };
  return db;
}

async function loadModules(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/ai/client', () => ({
    default: { send: vi.fn(), abort: vi.fn(), setRouter: vi.fn() },
  }));
  vi.doMock('../../services/ai/promptBuilder', () => ({
    buildPrompt: vi.fn(() => []),
  }));
  vi.doMock('../../services/ai/router', () => ({
    TASK_TYPES: {},
    QUALITY_MODES: {},
    PROVIDERS: {},
  }));
  const engine = await import('../../services/canon/engine');
  const exportImport = await import('../../services/db/exportImport');
  return { db, engine, exportImport };
}

describe('phase10 canon integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates downstream canon and rebuilds projection from surviving canonical chain', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Canon Test' }],
      chapters: [
        { id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 2, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      characters: [
        { id: 10, project_id: 1, name: 'Lam', current_status: 'Con song' },
      ],
      plotThreads: [],
      canonFacts: [],
      chapter_revisions: [
        { id: 101, project_id: 1, chapter_id: 1, revision_number: 1, status: 'canonical' },
        { id: 102, project_id: 1, chapter_id: 2, revision_number: 1, status: 'canonical' },
      ],
      chapter_commits: [
        { id: 201, project_id: 1, chapter_id: 1, current_revision_id: 101, canonical_revision_id: 101, status: 'canonical' },
        { id: 202, project_id: 1, chapter_id: 2, current_revision_id: 102, canonical_revision_id: 102, status: 'canonical' },
      ],
      story_events: [
        {
          id: 301,
          project_id: 1,
          chapter_id: 1,
          revision_id: 101,
          scene_id: 1,
          op_type: 'GOAL_CHANGED',
          subject_id: 10,
          summary: 'Bao ve em gai',
          payload: { new_goal: 'Bao ve em gai' },
          created_at: 1,
          status: 'committed',
        },
        {
          id: 302,
          project_id: 1,
          chapter_id: 2,
          revision_id: 102,
          scene_id: 2,
          op_type: 'GOAL_CHANGED',
          subject_id: 10,
          summary: 'Phuc vu nha vua',
          payload: { new_goal: 'Phuc vu nha vua' },
          created_at: 2,
          status: 'committed',
        },
      ],
    });

    const invalidated = await engine.invalidateFromChapter(1, 1);
    expect(invalidated).toEqual([2]);

    const rebuild = await engine.rebuildCanonFromChapter(1);
    expect(rebuild.entityStates).toHaveLength(1);
    expect(rebuild.entityStates[0].goals_active).toEqual(['Bao ve em gai']);
    expect(rebuild.entityStates[0].goals_active).not.toContain('Phuc vu nha vua');

    const commit2 = await db.chapter_commits.get(202);
    const revision2 = await db.chapter_revisions.get(102);
    expect(commit2.status).toBe('invalidated');
    expect(revision2.status).toBe('invalidated');

    const snapshots = await db.chapter_snapshots.toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].chapter_id).toBe(1);
  });

  it('rebuilds canon projection without mutating legacy codex tables', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Projection Isolation' }],
      chapters: [{ id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      characters: [
        { id: 10, project_id: 1, name: 'Lam', current_status: 'Con song' },
        { id: 11, project_id: 1, name: 'Ha', current_status: 'Con song' },
      ],
      plotThreads: [{ id: 20, project_id: 1, title: 'Bi mat', state: 'active', description: 'Dang mo' }],
      objects: [{ id: 30, project_id: 1, name: 'La thu', owner_character_id: null, description: 'Cu' }],
      relationships: [{ id: 40, project_id: 1, character_a_id: 10, character_b_id: 11, relation_type: 'friend', description: 'Ban cu' }],
      canonFacts: [],
      chapter_revisions: [{ id: 101, project_id: 1, chapter_id: 1, revision_number: 1, status: 'canonical' }],
      chapter_commits: [{ id: 201, project_id: 1, chapter_id: 1, current_revision_id: 101, canonical_revision_id: 101, status: 'canonical' }],
      story_events: [
        { id: 301, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'CHARACTER_DIED', subject_id: 10, payload: { status_summary: 'Da chet trong ham' }, summary: 'Lam chet', status: 'committed', created_at: 1 },
        { id: 302, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'THREAD_RESOLVED', thread_id: 20, payload: { summary: 'Bi mat da giai' }, summary: 'Thread dong', status: 'committed', created_at: 2 },
        { id: 303, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'OBJECT_TRANSFERRED', object_id: 30, target_id: 10, payload: { status_summary: 'La thu ve tay Lam' }, summary: 'Chuyen vat', status: 'committed', created_at: 3 },
        { id: 304, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'RELATIONSHIP_STATUS_CHANGED', subject_id: 10, target_id: 11, payload: { relationship_type: 'enemy', status_summary: 'Tro thanh ke thu' }, summary: 'Doi quan he', status: 'committed', created_at: 4 },
        { id: 305, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'FACT_REGISTERED', fact_description: 'Lang co loi nguyen', payload: { description: 'Lang co loi nguyen', fact_type: 'fact' }, summary: 'Fact moi', status: 'committed', created_at: 5 },
      ],
    });

    const rebuild = await engine.rebuildCanonFromChapter(1);

    expect(rebuild.entityStates.find((state) => state.entity_id === 10).alive_status).toBe('dead');
    expect(rebuild.threadStates.find((state) => state.thread_id === 20).state).toBe('resolved');
    expect(rebuild.itemStates.find((state) => state.object_id === 30).owner_character_id).toBe(10);
    expect(rebuild.relationshipStates.find((state) => state.pair_key === '10:11').relationship_type).toBe('enemy');
    expect(rebuild.factStates.some((fact) => fact.description === 'Lang co loi nguyen')).toBe(true);

    expect((await db.characters.get(10)).current_status).toBe('Con song');
    expect((await db.plotThreads.get(20)).state).toBe('active');
    expect((await db.objects.get(30)).owner_character_id).toBe(null);
    expect((await db.relationships.get(40)).relation_type).toBe('friend');
    expect(await db.canonFacts.toArray()).toEqual([]);
  });

  it('cleans only conflicting legacy character projection summaries when requested', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Legacy cleanup' }],
      chapters: [],
      characters: [
        { id: 10, project_id: 1, name: 'Ngoc Anh', current_status: 'Da chet | Muc tieu: Giai ma cai chet cua ba | Con song' },
        { id: 11, project_id: 1, name: 'Ba', current_status: 'Da chet' },
      ],
      plotThreads: [],
      canonFacts: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
    });

    await engine.rebuildCanonFromChapter(1, null, { cleanLegacyProjection: true });

    const ngocAnh = await db.characters.get(10);
    const ba = await db.characters.get(11);
    expect(ngocAnh.current_status).toContain('Con song');
    expect(ngocAnh.current_status).toContain('Giai ma cai chet cua ba');
    expect(ngocAnh.current_status).not.toContain('Da chet');
    expect(ba.current_status).toBe('Da chet');
  });

  it('filters low-confidence suggestion ops without creating story events', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Low confidence' }],
      chapters: [{ id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      characters: [{ id: 10, project_id: 1, name: 'Lam', current_status: 'Con song' }],
      plotThreads: [],
      canonFacts: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
    });

    const result = await engine.canonicalizeCandidateOps({
      projectId: 1,
      chapterId: 1,
      candidateOps: [{
        op_type: 'GOAL_CHANGED',
        chapter_id: 1,
        subject_id: 10,
        subject_name: 'Lam',
        confidence: 0.3,
        payload: { new_goal: 'Bao ve em gai' },
        evidence: 'Mo ho',
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.reports.some((report) => report.rule_code === 'LOW_CONFIDENCE_CANON_OP_FILTERED')).toBe(true);
    expect(result.reports.some((report) => report.rule_code === 'NO_COMMITTABLE_CANON_OPS')).toBe(true);
    expect(await db.story_events.toArray()).toEqual([]);
  });

  it('deduplicates appended candidate ops by semantic fingerprint', async () => {
    const baseOp = {
      op_type: 'GOAL_CHANGED',
      chapter_id: 1,
      scene_id: 9,
      subject_id: 10,
      subject_name: 'Lam',
      confidence: 0.6,
      summary: 'Muc tieu cu',
      payload: { new_goal: 'Bao ve em gai' },
      evidence: 'Bang chung cu',
    };
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Dedupe' }],
      chapters: [{ id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      characters: [{ id: 10, project_id: 1, name: 'Lam', current_status: 'Con song' }],
      plotThreads: [],
      canonFacts: [],
      chapter_revisions: [{ id: 101, project_id: 1, chapter_id: 1, revision_number: 1, status: 'canonical', candidate_ops: JSON.stringify([baseOp]) }],
      chapter_commits: [{ id: 201, project_id: 1, chapter_id: 1, current_revision_id: 101, canonical_revision_id: 101, status: 'canonical' }],
      story_events: [{ id: 301, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'GOAL_CHANGED', subject_id: 10, status: 'committed', created_at: 1 }],
    });

    const result = await engine.canonicalizeCandidateOps({
      projectId: 1,
      chapterId: 1,
      candidateOps: [{
        ...baseOp,
        confidence: 0.8,
        summary: 'Muc tieu moi ro hon',
        evidence: 'Bang chung moi',
      }],
    });

    expect(result.ok).toBe(true);
    const currentRevision = (await db.chapter_revisions.toArray()).find((revision) => revision.id === result.revisionId);
    const persistedOps = JSON.parse(currentRevision.candidate_ops);
    const committedEvents = (await db.story_events.toArray()).filter((event) => event.revision_id === result.revisionId);
    expect(persistedOps).toHaveLength(1);
    expect(persistedOps[0].summary).toBe('Muc tieu moi ro hon');
    expect(committedEvents).toHaveLength(1);
  });

  it('purges canon artifacts and archives deleted chapter payload without removing legacy codex rows', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Purge Test' }],
      chapters: [
        { id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' },
      ],
      chapter_revisions: [
        { id: 101, project_id: 1, chapter_id: 1, revision_number: 1, status: 'canonical' },
      ],
      chapter_commits: [
        { id: 201, project_id: 1, chapter_id: 1, current_revision_id: 101, canonical_revision_id: 101, status: 'canonical' },
      ],
      story_events: [
        { id: 301, project_id: 1, chapter_id: 1, revision_id: 101, op_type: 'FACT_REGISTERED', created_at: 1 },
      ],
      validator_reports: [
        { id: 401, project_id: 1, chapter_id: 1, revision_id: 101, severity: 'warning', message: 'Can review' },
      ],
      memory_evidence: [
        { id: 501, project_id: 1, chapter_id: 1, revision_id: 101, target_type: 'chapter_revision', evidence_text: 'proof' },
      ],
      chapter_snapshots: [
        { id: 601, project_id: 1, chapter_id: 1, revision_id: 101, snapshot_json: '{}' },
      ],
      canonFacts: [
        { id: 701, project_id: 1, description: 'Auto fact', source_chapter_id: 1, status: 'active', fact_type: 'fact' },
      ],
      characters: [
        { id: 801, project_id: 1, name: 'Auto Character', source_chapter_id: 1, source_kind: 'chapter_extract' },
        { id: 802, project_id: 1, name: 'Legacy Character' },
      ],
      locations: [
        { id: 901, project_id: 1, name: 'Auto Place', source_chapter_id: 1, source_kind: 'chapter_extract' },
      ],
      worldTerms: [
        { id: 1001, project_id: 1, name: 'Auto Term', source_chapter_id: 1, source_kind: 'chapter_extract' },
      ],
      objects: [
        { id: 1101, project_id: 1, name: 'Auto Relic', source_chapter_id: 1, source_kind: 'chapter_extract' },
        { id: 1102, project_id: 1, name: 'Manual Relic' },
      ],
    });

    const archivePayload = await engine.purgeChapterCanonState(1, 1);

    expect(archivePayload.chapter.title).toBe('Chuong 1');
    expect((await db.chapter_commits.toArray())).toHaveLength(0);
    expect((await db.chapter_revisions.toArray())).toHaveLength(0);
    expect((await db.story_events.toArray())).toHaveLength(0);
    expect((await db.validator_reports.toArray())).toHaveLength(0);
    expect((await db.memory_evidence.toArray())).toHaveLength(0);
    expect((await db.chapter_snapshots.toArray())).toHaveLength(0);
    expect((await db.canonFacts.toArray())).toHaveLength(0);
    expect((await db.characters.toArray()).map((item) => item.id)).toEqual([802]);
    expect((await db.objects.toArray()).map((item) => item.id)).toEqual([1102]);

    const archives = await db.canon_purge_archives.toArray();
    expect(archives).toHaveLength(1);
    expect(archives[0].removed_counts.revisions).toBe(1);
    expect(archives[0].removed_counts.characters).toBe(1);
    expect(archives[0].warnings[0]).toContain('Manual or legacy codex entries');
  });

  it('saves repair suggestions as draft revisions with source metadata', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Repair Test' }],
      chapters: [{ id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      chapter_revisions: [
        {
          id: 101,
          project_id: 1,
          chapter_id: 1,
          revision_number: 1,
          status: 'blocked',
          chapter_text: 'Ban cu',
          created_at: 1,
        },
      ],
      validator_reports: [
        {
          id: 401,
          project_id: 1,
          chapter_id: 1,
          revision_id: 101,
          severity: 'error',
          message: 'Mau thuan',
          created_at: 2,
        },
      ],
    });

    const saved = await engine.saveRepairDraftRevision({
      projectId: 1,
      chapterId: 1,
      revisionId: 101,
      reportId: 401,
      chapterText: 'Ban da sua',
    });

    expect(saved.id).toBeTruthy();
    expect(saved.revision_number).toBe(2);
    expect(saved.status).toBe('draft');
    expect(saved.chapter_text).toBe('Ban da sua');
    expect(saved.source_revision_id).toBe(101);
    expect(saved.source_report_id).toBe(401);

    const revisions = await db.chapter_revisions.where('[project_id+chapter_id]').equals([1, 1]).toArray();
    expect(revisions).toHaveLength(2);
  });

  it('exports and imports canon tables with remapped references', async () => {
    const seed = {
      projects: [{ id: 1, title: 'Export Test', created_at: 1, updated_at: 1 }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', pov_character_id: 31, location_id: 41, characters_present: '[31]' }],
      characters: [
        { id: 31, project_id: 1, name: 'Lan', current_status: 'Con song' },
        { id: 32, project_id: 1, name: 'Kha', current_status: 'Con song' },
      ],
      locations: [{ id: 41, project_id: 1, name: 'Thanh co' }],
      objects: [],
      worldTerms: [],
      taboos: [],
      relationships: [],
      canonFacts: [{ id: 51, project_id: 1, description: 'Than phan that cua Lan', fact_type: 'secret', status: 'active' }],
      chapterMeta: [],
      plotThreads: [{ id: 61, project_id: 1, title: 'Bi mat hoang toc', state: 'active' }],
      threadBeats: [],
      factions: [],
      suggestions: [],
      entityTimeline: [],
      macro_arcs: [],
      arcs: [],
      chapter_revisions: [{ id: 71, project_id: 1, chapter_id: 11, revision_number: 1, status: 'canonical' }],
      chapter_commits: [{ id: 72, project_id: 1, chapter_id: 11, current_revision_id: 71, canonical_revision_id: 71, status: 'canonical' }],
      story_events: [{
        id: 81,
        project_id: 1,
        chapter_id: 11,
        revision_id: 71,
        scene_id: 21,
        op_type: 'FACT_REGISTERED',
        subject_id: 31,
        thread_id: 61,
        fact_id: 51,
        fact_description: 'Than phan that cua Lan',
        payload: { description: 'Than phan that cua Lan', fact_type: 'secret' },
        created_at: 2,
        status: 'committed',
      }],
      entity_state_current: [{
        id: 91,
        project_id: 1,
        entity_id: 31,
        entity_type: 'character',
        alive_status: 'alive',
        last_event_id: 81,
        source_revision_id: 71,
      }],
      plot_thread_state: [{
        id: 92,
        project_id: 1,
        thread_id: 61,
        state: 'active',
        focus_entity_ids: [31],
        last_event_id: 81,
        source_revision_id: 71,
      }],
      validator_reports: [{
        id: 101,
        project_id: 1,
        chapter_id: 11,
        revision_id: 71,
        scene_id: 21,
        severity: 'warning',
        related_entity_ids: [31],
        related_thread_ids: [61],
        related_event_ids: [81],
        status: 'active',
        created_at: 3,
      }],
      memory_evidence: [{
        id: 111,
        project_id: 1,
        chapter_id: 11,
        revision_id: 71,
        scene_id: 21,
        target_type: 'story_event',
        target_id: 81,
        source_type: 'chapter_text',
        evidence_text: 'Lan nhan ra than phan that.',
        created_at: 4,
      }],
      chapter_snapshots: [{
        id: 121,
        project_id: 1,
        chapter_id: 11,
        revision_id: 71,
        snapshot_json: JSON.stringify({
          entityStates: [{ entity_id: 31, entity_type: 'character', last_event_id: 81, source_revision_id: 71 }],
          threadStates: [{ thread_id: 61, focus_entity_ids: [31], last_event_id: 81, source_revision_id: 71 }],
          factStates: [{ id: 51, subject_type: 'character', subject_id: 31, description: 'Than phan that cua Lan' }],
          itemStates: [{ object_id: 71, owner_character_id: 31, last_event_id: 81, source_revision_id: 71 }],
          relationshipStates: [{ pair_key: '31:32', character_a_id: 31, character_b_id: 32, last_event_id: 81, source_revision_id: 71 }],
        }),
      }],
      objects: [{ id: 71, project_id: 1, name: 'Ngoc Hoa An', owner_character_id: 31 }],
      item_state_current: [{
        id: 131,
        project_id: 1,
        object_id: 71,
        owner_character_id: 31,
        availability: 'available',
        last_event_id: 81,
        source_revision_id: 71,
      }],
      relationship_state_current: [{
        id: 141,
        project_id: 1,
        pair_key: '31:32',
        character_a_id: 31,
        character_b_id: 32,
        relationship_type: 'lover',
        intimacy_level: 'medium',
        consent_state: 'mutual',
        last_event_id: 81,
        source_revision_id: 71,
      }],
    };

    const { db, exportImport } = await loadModules(seed);
    const json = await exportImport.exportProject(1);
    const newProjectId = await exportImport.importProject(json);

    expect(newProjectId).not.toBe(1);

    const importedChapters = (await db.chapters.where('project_id').equals(newProjectId).toArray());
    const importedCharacters = (await db.characters.where('project_id').equals(newProjectId).toArray());
    const importedThreads = (await db.plotThreads.where('project_id').equals(newProjectId).toArray());
    const importedFacts = (await db.canonFacts.where('project_id').equals(newProjectId).toArray());
    const importedEvents = (await db.story_events.where('project_id').equals(newProjectId).toArray());
    const importedStates = (await db.entity_state_current.where('project_id').equals(newProjectId).toArray());
    const importedCommits = (await db.chapter_commits.where('project_id').equals(newProjectId).toArray());
    const importedSnapshots = (await db.chapter_snapshots.where('project_id').equals(newProjectId).toArray());
    const importedItemStates = (await db.item_state_current.where('project_id').equals(newProjectId).toArray());
    const importedRelationshipStates = (await db.relationship_state_current.where('project_id').equals(newProjectId).toArray());

    expect(importedChapters).toHaveLength(1);
    expect(importedCharacters).toHaveLength(2);
    expect(importedThreads).toHaveLength(1);
    expect(importedFacts).toHaveLength(1);
    expect(importedEvents).toHaveLength(1);
    expect(importedStates).toHaveLength(1);
    expect(importedCommits).toHaveLength(1);
    expect(importedSnapshots).toHaveLength(1);
    expect(importedItemStates).toHaveLength(1);
    expect(importedRelationshipStates).toHaveLength(1);

    const importedEvent = importedEvents[0];
    expect(importedEvent.chapter_id).toBe(importedChapters[0].id);
    expect(importedEvent.subject_id).toBe(importedCharacters[0].id);
    expect(importedEvent.thread_id).toBe(importedThreads[0].id);
    expect(importedEvent.fact_id).toBe(importedFacts[0].id);

    const importedState = importedStates[0];
    expect(importedState.entity_id).toBe(importedCharacters[0].id);
    expect(importedState.last_event_id).toBe(importedEvent.id);

    const snapshot = JSON.parse(importedSnapshots[0].snapshot_json);
    expect(snapshot.entityStates[0].entity_id).toBe(importedCharacters[0].id);
    expect(snapshot.threadStates[0].thread_id).toBe(importedThreads[0].id);
    expect(snapshot.factStates[0].id).toBe(importedFacts[0].id);
    expect(snapshot.itemStates[0].object_id).toBeDefined();
    expect(snapshot.relationshipStates[0].pair_key).toContain(':');
  });

  it('builds near-memory retrieval with recent chapters, item states, and relationship states', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Near Memory Test' }],
      chapters: [
        { id: 1, project_id: 1, order_index: 0, title: 'Chuong 1', summary: 'Khoi dau' },
        { id: 2, project_id: 1, order_index: 1, title: 'Chuong 2', summary: 'Xung dot lon dan' },
        { id: 3, project_id: 1, order_index: 2, title: 'Chuong 3', summary: 'Canh hien tai' },
      ],
      scenes: [
        { id: 21, chapter_id: 1, order_index: 0, title: 'Canh 1', final_text: 'Lan gap Kha.' },
        { id: 22, chapter_id: 2, order_index: 0, title: 'Canh 2', final_text: 'Lan dung Ngoc Hoa An mot lan duy nhat.' },
        { id: 23, project_id: 1, chapter_id: 3, order_index: 0, title: 'Canh 3', pov_character_id: 31, characters_present: '[31,32]' },
      ],
      characters: [
        { id: 31, project_id: 1, name: 'Lan' },
        { id: 32, project_id: 1, name: 'Kha' },
        { id: 33, project_id: 1, name: 'Minh' },
      ],
      objects: [{ id: 41, project_id: 1, name: 'Ngoc Hoa An', owner_character_id: 31 }],
      chapterMeta: [
        { id: 51, project_id: 1, chapter_id: 1, summary: 'Lan gap Kha lan dau', last_prose_buffer: 'Anh mat giao nhau.', emotional_state: { mood: 'hoi hop' } },
        { id: 52, project_id: 1, chapter_id: 2, summary: 'Lan da dung Ngoc Hoa An', last_prose_buffer: 'Du am nang ne.', emotional_state: { mood: 'cang thang' } },
      ],
      entity_state_current: [
        { id: 61, project_id: 1, entity_id: 31, entity_type: 'character', alive_status: 'alive' },
        { id: 62, project_id: 1, entity_id: 33, entity_type: 'character', alive_status: 'dead' },
      ],
      plot_thread_state: [],
      canonFacts: [],
      plotThreads: [],
      chapter_commits: [],
      item_state_current: [{ id: 71, project_id: 1, object_id: 41, availability: 'consumed', is_consumed: true, owner_character_id: 31 }],
      relationship_state_current: [{ id: 81, project_id: 1, pair_key: '31:32', character_a_id: 31, character_b_id: 32, relationship_type: 'lover', intimacy_level: 'high', consent_state: 'mutual', emotional_aftermath: 'ngai ngung nhung gan gui hon' }],
      memory_evidence: [{ id: 91, project_id: 1, chapter_id: 2, revision_id: 1, target_type: 'story_event', target_id: 1, evidence_text: 'Lan dung Ngoc Hoa An mot lan duy nhat.' }],
      story_events: [{ id: 101, project_id: 1, chapter_id: 2, revision_id: 1, scene_id: 22, op_type: 'OBJECT_CONSUMED', summary: 'Ngoc Hoa An da dung het', status: 'committed' }],
    });

    const packet = await engine.buildRetrievalPacket({
      projectId: 1,
      chapterId: 3,
      sceneId: 23,
      detectedCharacterIds: [31, 32],
      detectedObjectIds: [41],
    });

    expect(packet.recentChapterMemory).toHaveLength(2);
    expect(packet.relevantItemStates[0].availability).toBe('consumed');
    expect(packet.relevantRelationshipStates[0].intimacy_level).toBe('high');
    expect(packet.criticalConstraints.unavailableItems).toHaveLength(1);
    expect(packet.criticalConstraints.deadCharacters).toContain(33);
  });

  it('supports retrieval modes with deeper near-memory and evidence caps', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Retrieval Modes Test' }],
      chapters: [
        { id: 1, project_id: 1, order_index: 0, title: 'Chuong 1', summary: 'Khoi dau' },
        { id: 2, project_id: 1, order_index: 1, title: 'Chuong 2', summary: 'Bien co 1' },
        { id: 3, project_id: 1, order_index: 2, title: 'Chuong 3', summary: 'Bien co 2' },
        { id: 4, project_id: 1, order_index: 3, title: 'Chuong 4', summary: 'Bien co 3' },
        { id: 5, project_id: 1, order_index: 4, title: 'Chuong 5', summary: 'Canh hien tai' },
      ],
      scenes: [
        { id: 21, chapter_id: 1, order_index: 0, final_text: 'Chuong mot.' },
        { id: 22, chapter_id: 2, order_index: 0, final_text: 'Chuong hai.' },
        { id: 23, chapter_id: 3, order_index: 0, final_text: 'Chuong ba.' },
        { id: 24, chapter_id: 4, order_index: 0, final_text: 'Chuong bon.' },
        { id: 25, project_id: 1, chapter_id: 5, order_index: 0, pov_character_id: 31, characters_present: '[31]' },
      ],
      characters: [{ id: 31, project_id: 1, name: 'Lan' }],
      chapterMeta: [
        { id: 51, project_id: 1, chapter_id: 2, summary: 'Tom tat 2', last_prose_buffer: 'Du am 2.' },
        { id: 52, project_id: 1, chapter_id: 3, summary: 'Tom tat 3', last_prose_buffer: 'Du am 3.' },
        { id: 53, project_id: 1, chapter_id: 4, summary: 'Tom tat 4', last_prose_buffer: 'Du am 4.' },
      ],
      entity_state_current: [{ id: 61, project_id: 1, entity_id: 31, entity_type: 'character', alive_status: 'alive' }],
      plot_thread_state: [],
      canonFacts: [],
      plotThreads: [],
      chapter_commits: [],
      item_state_current: [],
      relationship_state_current: [],
      memory_evidence: [
        { id: 91, project_id: 1, chapter_id: 2, revision_id: 1, target_type: 'story_event', target_id: 1, evidence_text: 'Bang chung 2', created_at: 2 },
        { id: 92, project_id: 1, chapter_id: 3, revision_id: 1, target_type: 'story_event', target_id: 2, evidence_text: 'Bang chung 3', created_at: 3 },
        { id: 93, project_id: 1, chapter_id: 4, revision_id: 1, target_type: 'story_event', target_id: 3, evidence_text: 'Bang chung 4', created_at: 4 },
      ],
      story_events: [
        { id: 101, project_id: 1, chapter_id: 2, revision_id: 1, scene_id: 22, op_type: 'GOAL_CHANGED', summary: 'Su kien 2', status: 'committed' },
        { id: 102, project_id: 1, chapter_id: 3, revision_id: 1, scene_id: 23, op_type: 'GOAL_CHANGED', summary: 'Su kien 3', status: 'committed' },
        { id: 103, project_id: 1, chapter_id: 4, revision_id: 1, scene_id: 24, op_type: 'GOAL_CHANGED', summary: 'Su kien 4', status: 'committed' },
      ],
    });

    const packet = await engine.buildRetrievalPacket({
      projectId: 1,
      chapterId: 5,
      sceneId: 25,
      detectedCharacterIds: [31],
      mode: 'near_memory_3',
    });

    expect(packet.retrievalMode).toBe('near_memory_3');
    expect(packet.recentChapterMemory).toHaveLength(3);
    expect(packet.relevantEvidence).toHaveLength(3);
    expect(packet.recentChapterMemory[0].prose).toBeTruthy();
  });

  it('filters obsolete spent-item reports from loaded canon state', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Spent item stale report' }],
      chapters: [
        { id: 10, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 11, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        draft_text: 'Tai sao, ngay ca Huyet Lien Dan cung mang mot khi tuc tuong dong voi han?',
      }],
      objects: [{ id: 41, project_id: 1, name: 'Huyet Lien Dan' }],
      chapter_snapshots: [{
        id: 51,
        project_id: 1,
        chapter_id: 10,
        revision_id: 50,
        snapshot_json: {
          itemStates: [{ object_id: 41, availability: 'consumed', is_consumed: true }],
          entityStates: [],
          threadStates: [],
          factStates: [],
        },
      }],
      chapter_revisions: [{
        id: 61,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'validated',
        chapter_text: 'Tai sao, ngay ca Huyet Lien Dan cung mang mot khi tuc tuong dong voi han?',
      }],
      chapter_commits: [{
        id: 62,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 61,
        canonical_revision_id: 61,
        status: 'has_warnings',
        warning_count: 1,
        error_count: 0,
      }],
      validator_reports: [{
        id: 63,
        project_id: 1,
        chapter_id: 11,
        revision_id: 61,
        severity: 'warning',
        rule_code: 'DRAFT_REFERENCES_SPENT_ITEM',
        message: 'Draft dang goi lai vat pham Huyet Lien Dan, trong khi canon hien tai ghi nhan vat pham nay khong con dung duoc.',
        status: 'active',
        created_at: 1,
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      relationships: [],
      story_events: [],
      memory_evidence: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
    });

    const canonState = await engine.getChapterCanonState(1, 11);

    expect(canonState.reports.some((report) => report.rule_code === 'DRAFT_REFERENCES_SPENT_ITEM')).toBe(false);
    expect(canonState.warningCount).toBe(0);
    expect(canonState.status).toBe('canonical');
  });
});
