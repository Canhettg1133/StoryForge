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

async function loadModules(seed, options = {}) {
  vi.resetModules();
  const db = createMockDb(seed);
  const sendMock = vi.fn(options.sendImpl || (() => {}));
  const buildPromptMock = vi.fn(() => []);
  const scheduleBackgroundCanonRebuild = vi.fn();
  vi.doMock('../../services/db/database', () => ({ default: db, scheduleBackgroundCanonRebuild }));
  vi.doMock('../../services/ai/client', () => ({
    default: { send: sendMock, abort: vi.fn(), setRouter: vi.fn() },
  }));
  vi.doMock('../../services/ai/promptBuilder', () => ({
    buildPrompt: buildPromptMock,
  }));
  vi.doMock('../../services/ai/router', () => ({
    TASK_TYPES: options.taskTypes || {},
    QUALITY_MODES: {},
    PROVIDERS: {},
  }));
  vi.doUnmock('../../services/canon/projection');
  if (options.rebuildCanonFromChapterImpl) {
    const actualProjection = await vi.importActual('../../services/canon/projection');
    vi.doMock('../../services/canon/projection', () => ({
      ...actualProjection,
      rebuildCanonFromChapter: vi.fn(options.rebuildCanonFromChapterImpl),
    }));
  }
  const engine = await import('../../services/canon/engine');
  const exportImport = await import('../../services/db/exportImport');
  const codexStore = options.includeCodexStore
    ? (await import('../../stores/codexStore')).default
    : null;
  return {
    db,
    engine,
    exportImport,
    sendMock,
    buildPromptMock,
    codexStore,
    scheduleBackgroundCanonRebuild,
  };
}

describe('phase10 canon integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes allowConcurrent from chapter canonicalization to canon extraction', async () => {
    const { engine, sendMock } = await loadModules({
      projects: [{ id: 1, title: 'Concurrent canon', genre_primary: 'fantasy' }],
      chapters: [
        { id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 12, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        title: 'Canh 1',
        draft_text: 'Lan buoc vao thanh.',
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      taskTypes: { CANON_EXTRACT_OPS: 'canon_extract_ops' },
      sendImpl: ({ onComplete }) => onComplete('{"ops":[]}'),
    });

    await engine.canonicalizeChapter(1, 11, { allowConcurrent: true });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'canon_extract_ops',
      allowConcurrent: true,
    }));
  });

  it('reports a valid empty extraction as a successful zero-op canonicalization', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Empty canon', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: 'Troi mua nhe.' }],
    }, {
      sendImpl: ({ onComplete }) => onComplete('{"ops":[]}'),
    });

    const result = await engine.canonicalizeChapter(1, 11);

    expect(result).toMatchObject({
      ok: true,
      extractionStatus: 'succeeded',
      extractedCount: 0,
      committedCount: 0,
      filteredCount: 0,
    });
  });

  it('blocks the revision and records a retryable error when projection rebuild fails after commit', async () => {
    const { db, engine, scheduleBackgroundCanonRebuild } = await loadModules({
      projects: [{ id: 1, title: 'Projection failure', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: 'Troi mua nhe.' }],
    }, {
      sendImpl: ({ onComplete }) => onComplete('{"ops":[]}'),
      rebuildCanonFromChapterImpl: async () => {
        throw new Error('projection storage unavailable');
      },
    });

    const result = await engine.canonicalizeChapter(1, 11);
    const revision = await db.chapter_revisions.get(result.revisionId);
    const commit = await db.chapter_commits.where('[project_id+chapter_id]').equals([1, 11]).first();
    const reports = await db.validator_reports.where('revision_id').equals(result.revisionId).toArray();

    expect(result).toMatchObject({
      ok: false,
      extractionStatus: 'succeeded',
      committedCount: 0,
    });
    expect(revision.status).toBe('blocked');
    expect(commit).toMatchObject({ status: 'blocked', error_count: 1 });
    expect(reports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        rule_code: 'CANON_PROJECTION_REBUILD_FAILED',
      }),
    ]));
    expect(scheduleBackgroundCanonRebuild).toHaveBeenCalledTimes(1);
  });

  it('counts typed ops that are filtered before commit, including unmapped entity references', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Filtered canon counts', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: 'Lan tu hua se bao ve ngoi lang. Khong co trong roster. Chi la tin don.' }],
      characters: [{ id: 30, project_id: 1, name: 'Lan', current_status: 'Con song.' }],
    }, {
      sendImpl: ({ onComplete }) => onComplete(JSON.stringify({
        ops: [
          {
            op_type: 'GOAL_CHANGED',
            subject_name: 'Lan',
            summary: 'Lan quyet dinh bao ve ngoi lang.',
            evidence: 'Lan tu hua se bao ve ngoi lang.',
            confidence: 0.95,
            payload: { new_goal: 'Bao ve ngoi lang' },
          },
          {
            op_type: 'CHARACTER_STATUS_CHANGED',
            subject_name: 'Nguoi Khong Ton Tai',
            summary: 'Tham chieu khong map duoc.',
            evidence: 'Khong co trong roster.',
            confidence: 0.95,
            payload: { status_summary: 'Khong hop le' },
          },
          {
            op_type: 'ALLEGIANCE_CHANGED',
            subject_name: 'Lan',
            summary: 'Tin don Lan doi phe.',
            evidence: 'Chi la tin don.',
            confidence: 0.4,
            payload: { allegiance: 'Hoi Suong' },
          },
        ],
      })),
    });

    const result = await engine.canonicalizeChapter(1, 11);

    expect(result).toMatchObject({
      ok: true,
      extractedCount: 3,
      committedCount: 1,
      filteredCount: 2,
    });
    expect(result.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        rule_code: 'CANON_OP_MISSING_REFERENCE_FILTERED',
        evidence: 'Khong co trong roster.',
      }),
    ]));
  });

  it('builds the typed extraction prompt from pre-chapter projected truth', async () => {
    const { engine, buildPromptMock } = await loadModules({
      projects: [{ id: 1, title: 'Projected truth', genre_primary: 'fantasy' }],
      chapters: [
        { id: 10, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 11, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, draft_text: 'Lan khong xuat hien.' }],
      characters: [{ id: 30, project_id: 1, name: 'Lan', current_status: 'Con song o lang.' }],
      canonFacts: [{ id: 40, project_id: 1, description: 'Su that nen', fact_type: 'fact' }],
      chapter_snapshots: [{
        id: 50,
        project_id: 1,
        chapter_id: 10,
        revision_id: 60,
        snapshot_json: JSON.stringify({
          entityStates: [{
            project_id: 1,
            entity_id: 30,
            entity_type: 'character',
            alive_status: 'dead',
            summary: 'Lan da qua doi.',
          }],
          factStates: [{
            id: 'derived:1',
            project_id: 1,
            description: 'Lan da hy sinh o cong thanh',
            fact_type: 'fact',
            source_chapter_id: 10,
          }],
          threadStates: [],
          itemStates: [],
          relationshipStates: [],
        }),
      }],
      chapter_commits: [{
        id: 70,
        project_id: 1,
        chapter_id: 10,
        current_revision_id: 60,
        canonical_revision_id: 60,
        status: 'canonical',
      }],
      chapter_revisions: [{
        id: 60,
        project_id: 1,
        chapter_id: 10,
        revision_number: 1,
        status: 'canonical',
      }],
    }, {
      sendImpl: ({ onComplete }) => onComplete('{"ops":[]}'),
    });

    await engine.canonicalizeChapter(1, 11);

    const promptContext = buildPromptMock.mock.calls[0][1];
    expect(promptContext.characters[0].current_status).toContain('Lan da qua doi');
    expect(promptContext.canonFacts.map((fact) => fact.description)).toContain('Lan da hy sinh o cong thanh');
    expect(promptContext.canonFacts.map((fact) => fact.description)).toContain('Su that nen');
  });

  it('passes allowConcurrent from revision validation to canon extraction', async () => {
    const { engine, sendMock } = await loadModules({
      projects: [{ id: 1, title: 'Concurrent validation', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        title: 'Canh 1',
        draft_text: 'Lan buoc vao thanh.',
      }],
      chapter_revisions: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'draft',
        chapter_text: 'Lan buoc vao thanh.',
        candidate_ops: '[]',
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
      relationships: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      taskTypes: { CANON_EXTRACT_OPS: 'canon_extract_ops' },
      sendImpl: ({ onComplete }) => onComplete('{"ops":[]}'),
    });

    await engine.validateRevision(31, 'draft', { allowConcurrent: true });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'canon_extract_ops',
      allowConcurrent: true,
    }));
  });

  it('passes allowConcurrent from candidate canonicalization to warning adjudication', async () => {
    const { engine, sendMock } = await loadModules({
      projects: [{ id: 1, title: 'Concurrent candidate ops', genre_primary: 'fantasy' }],
      chapters: [
        { id: 10, project_id: 1, order_index: 0, title: 'Chuong 0' },
        { id: 11, project_id: 1, order_index: 1, title: 'Chuong 1' },
      ],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        title: 'Canh 1',
        draft_text: 'Lan dung lai Ngoc An Hon.',
      }],
      characters: [{ id: 10, project_id: 1, name: 'Lan' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [{ id: 30, project_id: 1, name: 'Ngoc An Hon', description: 'Bao vat' }],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [{
        id: 51,
        project_id: 1,
        chapter_id: 10,
        snapshot_json: JSON.stringify({
          itemStates: [{
            project_id: 1,
            object_id: 30,
            availability: 'lost',
            item_category: '',
            is_consumed: false,
          }],
        }),
      }],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      taskTypes: { CANON_ADJUDICATE_WARNINGS: 'canon_adjudicate_warnings' },
      sendImpl: ({ taskType, onComplete }) => {
        if (taskType === 'canon_adjudicate_warnings') {
          onComplete(JSON.stringify({
            decisions: [{
              warning_index: 0,
              verdict: 'needs_review',
              confidence: 0.8,
              reason: 'Can nguoi doc xac nhan vat pham co duoc tim lai hay khong.',
              suggested_action: 'keep_warning',
            }],
          }));
        }
      },
    });

    await engine.canonicalizeCandidateOps({
      projectId: 1,
      chapterId: 11,
      allowConcurrent: true,
      candidateOps: [{
        op_type: 'OBJECT_CONSUMED',
        chapter_id: 11,
        scene_id: 21,
        subject_id: 10,
        subject_name: 'Lan',
        object_id: 30,
        object_name: 'Ngoc An Hon',
        confidence: 0.8,
        evidence: 'Lan dung lai Ngoc An Hon.',
      }],
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'canon_adjudicate_warnings',
      allowConcurrent: true,
    }));
  });

  it('passes allowConcurrent from scene draft validation to warning adjudication', async () => {
    const { engine, sendMock } = await loadModules({
      projects: [{ id: 1, title: 'Concurrent scene validation', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        title: 'Canh 1',
        draft_text: '',
      }],
      characters: [],
      locations: [],
      plotThreads: [],
      canonFacts: [{ id: 7, project_id: 1, description: 'than phan that cua hoang toc', fact_type: 'secret' }],
      objects: [],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      taskTypes: { CANON_ADJUDICATE_WARNINGS: 'canon_adjudicate_warnings' },
      sendImpl: ({ taskType, onComplete }) => {
        if (taskType === 'canon_adjudicate_warnings') {
          onComplete(JSON.stringify({
            decisions: [{
              warning_index: 0,
              verdict: 'needs_review',
              confidence: 0.8,
              reason: 'Doan van co nhac toi bi mat can kiem tra.',
              suggested_action: 'keep_warning',
            }],
          }));
        }
      },
    });

    await engine.validateSceneDraft({
      projectId: 1,
      chapterId: 11,
      sceneId: 21,
      sceneText: 'Lan noi ve than phan that cua hoang toc.',
      allowConcurrent: true,
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'canon_adjudicate_warnings',
      allowConcurrent: true,
    }));
  });

  it('commits character death during chapter canonicalization and exposes it to the next chapter', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Canon review', genre_primary: 'fantasy' }],
      chapters: [
        { id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' },
        { id: 12, project_id: 1, order_index: 1, title: 'Chuong 2' },
      ],
      scenes: [
        {
          id: 21,
          project_id: 1,
          chapter_id: 11,
          order_index: 0,
          title: 'Canh 1',
          draft_text: 'Lan hy sinh o cong thanh. Minh the bao ve thanh.',
        },
        {
          id: 22,
          project_id: 1,
          chapter_id: 12,
          order_index: 0,
          title: 'Canh 2',
          draft_text: '',
        },
      ],
      characters: [
        { id: 10, project_id: 1, name: 'Lan', current_status: 'Con song' },
        { id: 12, project_id: 1, name: 'Minh', current_status: 'Con song' },
      ],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      sendImpl: ({ onComplete }) => onComplete(JSON.stringify({
        ops: [
          {
            op_type: 'CHARACTER_DIED',
            scene_index: 1,
            subject_name: 'Lan',
            summary: 'Lan hy sinh ở cổng thành.',
            evidence: 'Lan hy sinh ở cổng thành.',
            confidence: 0.92,
          },
          {
            op_type: 'GOAL_CHANGED',
            scene_index: 1,
            subject_name: 'Minh',
            summary: 'Minh thề bảo vệ thành.',
            evidence: 'Minh thề bảo vệ thành.',
            confidence: 0.84,
            payload: { new_goal: 'Bảo vệ thành' },
          },
        ],
      })),
    });

    const result = await engine.canonicalizeChapter(1, 11);

    expect(result.ok).toBe(true);
    expect(result.extractionStatus).toBe('succeeded');
    expect(result.extractedCount).toBe(2);
    expect(result.committedCount).toBe(2);
    expect(result.filteredCount).toBe(0);

    const events = await db.story_events.toArray();
    expect(events.some((event) => event.op_type === 'CHARACTER_DIED')).toBe(true);
    expect(events.some((event) => event.op_type === 'GOAL_CHANGED')).toBe(true);

    const lanState = (await db.entity_state_current.toArray()).find((state) => state.entity_id === 10);
    expect(lanState.alive_status).toBe('dead');

    const suggestions = await db.suggestions.toArray();
    expect(suggestions).toEqual([]);

    const packet = await engine.buildRetrievalPacket({
      projectId: 1,
      chapterId: 12,
      sceneId: 22,
      detectedCharacterIds: [10],
    });
    expect(packet.criticalConstraints.deadCharacters).toContain(10);
  });

  it('commits consumed and risky object status ops without manual review', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Object review', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{
        id: 21,
        project_id: 1,
        chapter_id: 11,
        order_index: 0,
        title: 'Canh 1',
        draft_text: 'Ngọc An Hồn đã dùng hết. Kiếm Vô Ảnh bị thất lạc.',
      }],
      characters: [{ id: 10, project_id: 1, name: 'Lan' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [
        { id: 30, project_id: 1, name: 'Ngoc An Hon', description: 'Bao vat' },
        { id: 31, project_id: 1, name: 'Kiem Vo Anh', description: 'Kiem' },
      ],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [],
    }, {
      sendImpl: ({ onComplete }) => onComplete(JSON.stringify({
        ops: [
          {
            op_type: 'OBJECT_CONSUMED',
            scene_index: 1,
            subject_name: 'Lan',
            object_name: 'Ngoc An Hon',
            summary: 'Ngọc An Hồn đã dùng hết.',
            evidence: 'Ngọc An Hồn đã dùng hết.',
            confidence: 0.9,
            payload: { availability: 'consumed', status_summary: 'Đã dùng hết' },
          },
          {
            op_type: 'OBJECT_STATUS_CHANGED',
            scene_index: 1,
            subject_name: 'Lan',
            object_name: 'Kiem Vo Anh',
            summary: 'Kiếm Vô Ảnh bị thất lạc.',
            evidence: 'Kiếm Vô Ảnh bị thất lạc.',
            confidence: 0.88,
            payload: { availability: 'lost', status_summary: 'Bị thất lạc' },
          },
        ],
      })),
    });

    const result = await engine.canonicalizeChapter(1, 11);

    expect(result.ok).toBe(true);
    expect(result.committedCount).toBe(2);
    expect((await db.story_events.toArray()).map((event) => event.op_type)).toEqual([
      'OBJECT_CONSUMED',
      'OBJECT_STATUS_CHANGED',
    ]);

    const itemStates = await db.item_state_current.toArray();
    expect(itemStates.find((state) => state.object_id === 30).availability).toBe('consumed');
    expect(itemStates.find((state) => state.object_id === 31).availability).toBe('lost');

    expect(await db.suggestions.toArray()).toEqual([]);
  });

  it('supersedes pending legacy canon suggestions after canonicalization succeeds', async () => {
    const duplicateOp = {
      op_type: 'CHARACTER_DIED',
      chapter_id: 11,
      scene_id: 21,
      subject_id: 10,
      subject_name: 'Lan',
      summary: 'Lan hy sinh ở cổng thành.',
      evidence: 'Lan hy sinh ở cổng thành.',
      confidence: 0.92,
      payload: {},
      mapping_errors: [],
    };
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Canon review dedupe', genre_primary: 'fantasy' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 21, project_id: 1, chapter_id: 11, order_index: 0, title: 'Canh 1', draft_text: 'Lan hy sinh o cong thanh.' }],
      characters: [{ id: 10, project_id: 1, name: 'Lan', current_status: 'Con song' }],
      locations: [],
      plotThreads: [],
      canonFacts: [],
      objects: [],
      relationships: [],
      chapter_revisions: [],
      chapter_commits: [],
      story_events: [],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [],
      relationship_state_current: [],
      suggestions: [{
        id: 501,
        project_id: 1,
        type: 'canon_op_review',
        status: 'pending',
        source_chapter_id: 11,
        source_scene_id: 21,
        target_id: 10,
        target_name: 'Lan',
        suggested_value: 'Lan hy sinh ở cổng thành.',
        reasoning: 'Lan hy sinh ở cổng thành.',
        candidate_op: JSON.stringify(duplicateOp),
        created_at: 1,
      }],
    }, {
      sendImpl: ({ onComplete }) => onComplete(JSON.stringify({ ops: [duplicateOp] })),
    });

    const result = await engine.canonicalizeChapter(1, 11);

    expect(result.ok).toBe(true);
    const suggestions = await db.suggestions.toArray();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].status).toBe('superseded');
    expect((await db.story_events.toArray()).some((event) => event.op_type === 'CHARACTER_DIED')).toBe(true);
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

  it('rebuilds legacy inferred-dead projection as unknown without changing character text', async () => {
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
      entity_state_current: [
        { id: 301, project_id: 1, entity_id: 10, entity_type: 'character', alive_status: 'dead' },
        { id: 302, project_id: 1, entity_id: 11, entity_type: 'character', alive_status: 'dead' },
      ],
    });

    const rebuild = await engine.rebuildCanonFromChapter(1, null, { cleanLegacyProjection: true });

    const ngocAnh = await db.characters.get(10);
    const ba = await db.characters.get(11);
    expect(rebuild.entityStates.find((state) => state.entity_id === 10).alive_status).toBe('unknown');
    expect(rebuild.entityStates.find((state) => state.entity_id === 11).alive_status).toBe('unknown');
    expect((await db.entity_state_current.toArray()).every((state) => state.alive_status === 'unknown')).toBe(true);
    expect(ngocAnh.current_status).toContain('Con song');
    expect(ngocAnh.current_status).toContain('Giai ma cai chet cua ba');
    expect(ngocAnh.current_status).toContain('Da chet');
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

  it('commits relationship candidate ops through story events and clears rebuild dirty flag after projection rebuild', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Relationship suggestions', canon_rebuild_required: false }],
      chapters: [{ id: 1, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      characters: [
        { id: 10, project_id: 1, name: 'Lan' },
        { id: 11, project_id: 1, name: 'Kha' },
      ],
      relationships: [{ id: 40, project_id: 1, character_a_id: 10, character_b_id: 11, relation_type: 'friend', description: 'Ban cu' }],
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
        op_type: 'RELATIONSHIP_STATUS_CHANGED',
        chapter_id: 1,
        subject_id: 10,
        subject_name: 'Lan',
        target_id: 11,
        target_name: 'Kha',
        confidence: 0.8,
        summary: 'Lan va Kha tro thanh ke thu',
        evidence: 'Lan rut kiem chan Kha.',
        payload: {
          relationship_type: 'enemy',
          status_summary: 'Tro thanh ke thu sau man phan boi',
        },
      }],
    });

    expect(result.ok).toBe(true);
    const events = await db.story_events.toArray();
    expect(events.some((event) => event.op_type === 'RELATIONSHIP_STATUS_CHANGED')).toBe(true);
    const state = (await db.relationship_state_current.toArray()).find((item) => item.pair_key === '10:11');
    expect(state.relationship_type).toBe('enemy');
    expect((await db.projects.get(1)).canon_rebuild_required).toBe(false);
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
      scenes: [{
        id: 11,
        project_id: 1,
        chapter_id: 1,
        order_index: 0,
        title: 'Canh 1',
        draft_text: 'Noi dung dang mo trong editor',
      }],
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
      chapter_commits: [{
        id: 201,
        project_id: 1,
        chapter_id: 1,
        current_revision_id: 101,
        canonical_revision_id: null,
        status: 'blocked',
      }],
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
    expect((await db.scenes.get(11)).draft_text).toBe('Noi dung dang mo trong editor');

    const commit = await db.chapter_commits.get(201);
    expect(commit.current_revision_id).toBe(saved.id);
    expect(commit.canonical_revision_id).toBeNull();
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

  it('uses the pre-chapter snapshot instead of latest global state for writing retrieval', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Pre chapter retrieval state' }],
      chapters: [
        { id: 9, project_id: 1, order_index: 8, title: 'Chuong 9', summary: 'Ket thuc o son coc' },
        { id: 10, project_id: 1, order_index: 9, title: 'Chuong 10', summary: 'Canh hien tai' },
      ],
      scenes: [
        { id: 110, project_id: 1, chapter_id: 10, order_index: 0, title: 'Canh 1', pov_character_id: 150, characters_present: '[150]' },
      ],
      characters: [{ id: 150, project_id: 1, name: 'Lam Phong' }],
      chapter_snapshots: [{
        id: 501,
        project_id: 1,
        chapter_id: 9,
        revision_id: 500,
        snapshot_json: {
          entityStates: [{
            project_id: 1,
            entity_id: 150,
            entity_type: 'character',
            alive_status: 'alive',
            current_location_name: 'Son coc la',
            status_summary: 'Trong thuong, bi nam U Minh Lang bao vay',
          }],
          threadStates: [],
          factStates: [],
          itemStates: [],
          relationshipStates: [],
        },
      }],
      entity_state_current: [{
        id: 601,
        project_id: 1,
        entity_id: 150,
        entity_type: 'character',
        alive_status: 'alive',
        current_location_name: 'Thanh Van Tong',
        status_summary: 'Da tro ve tong mon',
      }],
      plot_thread_state: [],
      canonFacts: [],
      plotThreads: [],
      objects: [],
      chapter_commits: [],
      item_state_current: [],
      relationship_state_current: [],
      chapterMeta: [],
      memory_evidence: [],
      story_events: [],
    });

    const packet = await engine.buildRetrievalPacket({
      projectId: 1,
      chapterId: 10,
      sceneId: 110,
      detectedCharacterIds: [150],
    });

    expect(packet.relevantEntityStates).toHaveLength(1);
    expect(packet.relevantEntityStates[0].current_location_name).toBe('Son coc la');
    expect(packet.relevantEntityStates[0].status_summary).toContain('U Minh Lang');
    expect(packet.criticalConstraints.locationAnchors).toEqual([{
      entity_id: 150,
      location_name: 'Son coc la',
    }]);
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

    const compactPacket = await engine.buildRetrievalPacket({
      projectId: 1,
      chapterId: 5,
      sceneId: 25,
      detectedCharacterIds: [31],
      mode: 'near_memory_3_compact',
    });

    expect(compactPacket.retrievalMode).toBe('near_memory_3_compact');
    expect(compactPacket.recentChapterMemory).toHaveLength(3);
    expect(compactPacket.recentChapterMemory.every((item) => item.prose === '')).toBe(true);
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

  it('uses only active current-revision reports in canon overview stats and recent warnings', async () => {
    const { db, engine } = await loadModules({
      projects: [{ id: 1, title: 'Overview active reports only' }],
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
      chapter_revisions: [
        {
          id: 61,
          project_id: 1,
          chapter_id: 11,
          revision_number: 1,
          status: 'validated',
          chapter_text: 'Tai sao, ngay ca Huyet Lien Dan cung mang mot khi tuc tuong dong voi han?',
        },
        {
          id: 62,
          project_id: 1,
          chapter_id: 11,
          revision_number: 2,
          status: 'superseded',
          chapter_text: 'Ban cu co warning',
        },
      ],
      chapter_commits: [{
        id: 63,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 61,
        canonical_revision_id: 61,
        status: 'has_warnings',
        warning_count: 2,
        error_count: 0,
      }],
      validator_reports: [
        {
          id: 71,
          project_id: 1,
          chapter_id: 11,
          revision_id: 61,
          severity: 'warning',
          rule_code: 'DRAFT_REFERENCES_SPENT_ITEM',
          message: 'Draft dang goi lai vat pham Huyet Lien Dan, trong khi canon hien tai ghi nhan vat pham nay khong con dung duoc.',
          status: 'active',
          created_at: 2,
        },
        {
          id: 72,
          project_id: 1,
          chapter_id: 11,
          revision_id: 62,
          severity: 'warning',
          rule_code: 'INTIMACY_CONSENT_UNSPECIFIED',
          message: 'Thay doi muc do than mat nhung chua co consent_state ro rang.',
          status: 'active',
          created_at: 1,
        },
      ],
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

    const overview = await engine.getProjectCanonOverview(1);
    const storedReports = await db.validator_reports.toArray();

    expect(overview.stats.warning_count).toBe(0);
    expect(overview.recentReports).toHaveLength(0);
    expect(overview.chapterCommits[0].status).toBe('canonical');
    expect(storedReports.some((report) => report.id === 71)).toBe(false);
    expect(storedReports.some((report) => report.id === 72)).toBe(true);
  });

  it('returns projected chapter facts from the latest active canon snapshot', async () => {
    const { engine } = await loadModules({
      projects: [{ id: 1, title: 'Derived facts' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      canonFacts: [{
        id: 30,
        project_id: 1,
        description: 'Su that nen',
        fact_type: 'fact',
        status: 'active',
      }],
      chapter_revisions: [{
        id: 40,
        project_id: 1,
        chapter_id: 11,
        revision_number: 1,
        status: 'canonical',
      }],
      chapter_commits: [{
        id: 50,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 40,
        canonical_revision_id: 40,
        status: 'canonical',
      }],
      chapter_snapshots: [{
        id: 60,
        project_id: 1,
        chapter_id: 11,
        revision_id: 40,
        snapshot_json: JSON.stringify({
          entityStates: [],
          threadStates: [],
          itemStates: [],
          relationshipStates: [],
          factStates: [
            {
              id: 30,
              project_id: 1,
              description: 'Su that nen',
              fact_type: 'fact',
              status: 'active',
            },
            {
              id: 'event:70',
              project_id: 1,
              description: 'Lan da hy sinh',
              fact_type: 'fact',
              status: 'active',
              source_chapter_id: 11,
            },
          ],
        }),
      }],
    });

    const overview = await engine.getProjectCanonOverview(1);

    expect(overview.factStates.map((fact) => fact.description)).toEqual([
      'Su that nen',
      'Lan da hy sinh',
    ]);
    expect(overview.factStates[1]).toMatchObject({
      source_chapter_id: 11,
      source_chapter_title: 'Chuong 1',
      derived_from_chapter: true,
    });
    expect(overview.stats.fact_count).toBe(2);
  });

  it('keeps hydrated canon state when applying a completion delta', async () => {
    const { db, codexStore } = await loadModules({
      projects: [{ id: 1, title: 'Hydration' }],
      characters: [{
        id: 10,
        project_id: 1,
        name: 'Lan',
        current_status: 'Ho so ban dau',
      }],
      entity_state_current: [{
        id: 20,
        project_id: 1,
        entity_id: 10,
        entity_type: 'character',
        alive_status: 'dead',
        summary: 'Lan da qua doi.',
      }],
      locations: [{ id: 30, project_id: 1, name: 'Thanh Co', description: 'Mo ta cu' }],
      objects: [{ id: 40, project_id: 1, name: 'La ban', description: 'Vat cu' }],
      worldTerms: [{ id: 50, project_id: 1, name: 'Cong Tro', definition: 'Dinh nghia cu' }],
      canonFacts: [],
      chapterMeta: [],
    }, { includeCodexStore: true });

    await codexStore.getState().loadCodex(1);
    await Promise.all([
      db.locations.update(30, { description: 'Mo ta moi tu chuong' }),
      db.objects.update(40, { description: 'Vat da cap nhat' }),
      db.worldTerms.update(50, { definition: 'Dinh nghia moi tu chuong' }),
    ]);
    await codexStore.getState().applyCompletionDelta({
      projectId: 1,
      chapterId: null,
      refreshProjection: true,
    });

    expect(codexStore.getState().characters[0]).toMatchObject({
      current_status: 'Ho so ban dau',
      canon_status_summary: expect.stringContaining('Lan da qua doi'),
      canon_state: expect.objectContaining({ alive_status: 'dead' }),
    });
    expect(codexStore.getState().locations[0].description).toBe('Mo ta moi tu chuong');
    expect(codexStore.getState().objects[0].description).toBe('Vat da cap nhat');
    expect(codexStore.getState().worldTerms[0].definition).toBe('Dinh nghia moi tu chuong');
    expect(codexStore.getState().storyBibleWorldCounts).toEqual({
      locations: 1,
      objects: 1,
      terms: 1,
    });
  });

  it('removes deleted objects from current truth and never resurrects them from canon history', async () => {
    const { db, engine, codexStore } = await loadModules({
      projects: [{ id: 1, title: 'Object deletion consistency' }],
      chapters: [{ id: 11, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [],
      characters: [],
      locations: [],
      objects: [
        { id: 30, project_id: 1, name: 'Ngoc boi' },
        { id: 31, project_id: 1, name: 'Kiem co' },
      ],
      worldTerms: [],
      factions: [],
      taboos: [],
      canonFacts: [],
      chapterMeta: [],
      plotThreads: [],
      relationships: [],
      chapter_revisions: [{ id: 101, project_id: 1, chapter_id: 11, status: 'canonical' }],
      chapter_commits: [{
        id: 201,
        project_id: 1,
        chapter_id: 11,
        current_revision_id: 101,
        canonical_revision_id: 101,
        status: 'canonical',
      }],
      story_events: [{
        id: 301,
        project_id: 1,
        chapter_id: 11,
        revision_id: 101,
        op_type: 'OBJECT_TRANSFERRED',
        object_id: 30,
        target_id: null,
        payload: { status_summary: 'Da chuyen giao' },
        summary: 'Chuyen vat',
        status: 'committed',
        created_at: 1,
      }],
      validator_reports: [],
      memory_evidence: [],
      chapter_snapshots: [],
      entity_state_current: [],
      plot_thread_state: [],
      item_state_current: [
        { id: 401, project_id: 1, object_id: 30, availability: 'available' },
        { id: 402, project_id: 1, object_id: 31, availability: 'available' },
        { id: 403, project_id: 1, object_id: 999, availability: 'available' },
      ],
      relationship_state_current: [],
    }, { includeCodexStore: true });

    const beforeDelete = await engine.getProjectCanonOverview(1);
    expect(beforeDelete.itemStates.map((item) => item.object_id)).toEqual([31, 30]);
    expect(beforeDelete.stats.item_count).toBe(2);

    await codexStore.getState().deleteObjects([30, 31], 1);

    expect(await db.objects.toArray()).toEqual([]);
    expect((await db.item_state_current.toArray()).map((item) => item.object_id)).toEqual([999]);

    const rebuilt = await engine.rebuildCanonFromChapter(1);
    expect(rebuilt.itemStates).toEqual([]);

    const afterDelete = await engine.getProjectCanonOverview(1);
    expect(afterDelete.itemStates).toEqual([]);
    expect(afterDelete.stats.item_count).toBe(0);
  });

  it('clears live references when deleting a location', async () => {
    const { db, engine, codexStore } = await loadModules({
      projects: [{ id: 1, title: 'Location deletion consistency' }],
      chapters: [{ id: 10, project_id: 1, order_index: 0, title: 'Chuong 1' }],
      scenes: [{ id: 11, project_id: 1, chapter_id: 10, location_id: 50 }],
      characters: [{ id: 20, project_id: 1, name: 'Lan' }],
      locations: [
        { id: 50, project_id: 1, name: 'Thanh co', parent_location_id: null },
        { id: 51, project_id: 1, name: 'Cong thanh', parent_location_id: 50 },
      ],
      objects: [{ id: 30, project_id: 1, name: 'Ngoc boi' }],
      worldTerms: [],
      factions: [],
      taboos: [],
      canonFacts: [],
      chapterMeta: [],
      plotThreads: [],
      relationships: [],
      chapter_revisions: [{ id: 101, project_id: 1, chapter_id: 10, status: 'canonical' }],
      chapter_commits: [{
        id: 201,
        project_id: 1,
        chapter_id: 10,
        current_revision_id: 101,
        canonical_revision_id: 101,
        status: 'canonical',
      }],
      story_events: [{
        id: 401,
        project_id: 1,
        chapter_id: 10,
        revision_id: 101,
        op_type: 'CHARACTER_LOCATION_CHANGED',
        subject_id: 20,
        location_id: 50,
        location_name: 'Thanh co',
        payload: {},
        status: 'committed',
        created_at: 1,
      }],
      entity_state_current: [{
        id: 201,
        project_id: 1,
        entity_id: 20,
        current_location_id: 50,
        current_location_name: 'Thanh co',
      }],
      item_state_current: [{
        id: 301,
        project_id: 1,
        object_id: 30,
        current_location_id: 50,
        current_location_name: 'Thanh co',
      }],
    }, { includeCodexStore: true });

    await codexStore.getState().deleteLocations([50], 1);

    expect((await db.locations.get(51)).parent_location_id).toBeNull();
    expect((await db.scenes.get(11)).location_id).toBeNull();
    expect((await db.entity_state_current.get(201))).toMatchObject({
      current_location_id: null,
      current_location_name: '',
    });
    expect((await db.item_state_current.get(301))).toMatchObject({
      current_location_id: null,
      current_location_name: '',
    });

    const rebuilt = await engine.rebuildCanonFromChapter(1);
    expect(rebuilt.entityStates[0]).toMatchObject({
      current_location_id: null,
      current_location_name: '',
    });
  });
});
