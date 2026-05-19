import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  aiResponses,
  buildPromptMock,
  captured,
  createSuggestionsMock,
  dbRows,
  dbMocks,
  keyManagerMock,
  suggestionStoreMock,
} = vi.hoisted(() => {
  const createSuggestionsMock = vi.fn(async () => {});
  return {
    aiResponses: [],
    buildPromptMock: vi.fn(() => [{ role: 'user', content: 'relationship batch' }]),
    captured: { sendOptions: [] },
    createSuggestionsMock,
    dbRows: {
      projects: [],
      chapters: [],
      scenes: [],
      chapterMeta: [],
      characters: [],
      relationships: [],
      relationshipStates: [],
      storyEvents: [],
      suggestions: [],
    },
    dbMocks: {
      storyEventsAdd: vi.fn(async () => 1),
      storyEventsBulkAdd: vi.fn(async () => 1),
    },
    keyManagerMock: {
      getTotalKeys: vi.fn(() => 1),
    },
    suggestionStoreMock: {
      getState: vi.fn(() => ({ createSuggestions: createSuggestionsMock })),
    },
  };
});

function makeTable(rowsKey, indexedField) {
  const rows = () => dbRows[rowsKey];
  return {
    where: vi.fn((field) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => rows().filter((row) => row[field] === value)),
        sortBy: vi.fn(async (sortField) => (
          rows()
            .filter((row) => row[field] === value)
            .slice()
            .sort((a, b) => (a[sortField] || 0) - (b[sortField] || 0))
        )),
        first: vi.fn(async () => rows().find((row) => row[field] === value) || null),
      })),
    })),
    add: vi.fn(async (record) => {
      const id = record.id || rows().reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
      rows().push({ id, ...record });
      return id;
    }),
    update: vi.fn(async (id, patch) => {
      const index = rows().findIndex((row) => row.id === id);
      if (index >= 0) rows()[index] = { ...rows()[index], ...patch };
      return 1;
    }),
    bulkAdd: vi.fn(async (records) => {
      records.forEach((record) => rows().push({ id: rows().length + 1, ...record }));
      return records.length;
    }),
  };
}

vi.mock('../../services/ai/client', () => ({
  default: {
    setRouter: vi.fn(),
    send: vi.fn((options) => {
      captured.sendOptions.push(options);
      const response = aiResponses.shift() || { chapters: [] };
      options.onComplete(typeof response === 'string' ? response : JSON.stringify(response));
      return { abort: vi.fn() };
    }),
    abort: vi.fn(),
  },
}));

vi.mock('../../services/ai/promptBuilder', () => ({
  buildPrompt: buildPromptMock,
}));

vi.mock('../../services/ai/keyManager', () => ({
  default: keyManagerMock,
}));

vi.mock('../../stores/suggestionStore', () => ({
  default: suggestionStoreMock,
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: {
      get: vi.fn(async (id) => dbRows.projects.find((project) => project.id === id) || null),
    },
    chapters: makeTable('chapters', 'project_id'),
    scenes: makeTable('scenes', 'project_id'),
    chapterMeta: makeTable('chapterMeta', 'project_id'),
    characters: makeTable('characters', 'project_id'),
    relationships: makeTable('relationships', 'project_id'),
    relationship_state_current: makeTable('relationshipStates', 'project_id'),
    story_events: {
      ...makeTable('storyEvents', 'project_id'),
      add: dbMocks.storyEventsAdd,
      bulkAdd: dbMocks.storyEventsBulkAdd,
    },
    suggestions: makeTable('suggestions', 'project_id'),
  },
}));

async function loadAIStore() {
  vi.resetModules();
  captured.sendOptions = [];
  const module = await import('../../stores/aiStore.js');
  return module.default;
}

function resetRows() {
  dbRows.projects = [{ id: 1, title: 'Dự án thử', nsfw_mode: false, super_nsfw_mode: false }];
  dbRows.chapters = [
    { id: 7, project_id: 1, order_index: 0, title: 'Chương 7' },
    { id: 8, project_id: 1, order_index: 1, title: 'Chương 8' },
  ];
  dbRows.scenes = [
    { id: 70, project_id: 1, chapter_id: 7, order_index: 0, title: 'Cảnh 1', draft_text: '<p>Lan trao thư cho Kha.</p>' },
    { id: 80, project_id: 1, chapter_id: 8, order_index: 0, title: 'Cảnh 1', draft_text: '<p>Kha giữ im lặng.</p>' },
  ];
  dbRows.chapterMeta = [];
  dbRows.characters = [
    { id: 1, project_id: 1, name: 'Lan' },
    { id: 2, project_id: 1, name: 'Kha' },
  ];
  dbRows.relationships = [
    { id: 10, project_id: 1, character_a_id: 1, character_b_id: 2, relation_type: 'friend' },
  ];
  dbRows.relationshipStates = [];
  dbRows.storyEvents = [];
  dbRows.suggestions = [];
}

describe('phase10 relationship analysis batch store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRows();
    aiResponses.length = 0;
    buildPromptMock.mockClear();
    createSuggestionsMock.mockClear();
    suggestionStoreMock.getState.mockClear();
    keyManagerMock.getTotalKeys.mockClear();
    dbMocks.storyEventsAdd.mockClear();
    dbMocks.storyEventsBulkAdd.mockClear();
  });

  it('creates relationship_update suggestions for multiple chapters and marks empty chapters analyzed', async () => {
    aiResponses.push({
      chapters: [
        {
          chapter_id: 7,
          relationship_updates: [{
            chapter_id: 7,
            character_a_name: 'Lan',
            character_b_name: 'Kha',
            change_type: 'secret',
            relationship_type: 'friend',
            secrecy_state: 'secret',
            status_summary: 'Lan và Kha giấu một thỏa thuận mới.',
            emotional_aftermath: 'Căng nhưng còn tin nhau.',
            reasoning: 'Hai người trao thư rồi né tránh câu hỏi.',
            evidence: 'Lan trao thư cho Kha.',
          }],
        },
        { chapter_id: 8, relationship_updates: [] },
      ],
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().analyzeNeededRelationshipChapters({ projectId: 1 });

    expect(result).toMatchObject({
      status: 'completed',
      analyzedChapterCount: 2,
      requestCount: 1,
      createdCount: 1,
      skippedDuplicateCount: 0,
      failedChapterIds: [],
    });
    expect(buildPromptMock).toHaveBeenCalledWith('relationship_analyze_batch', expect.objectContaining({
      relationshipAnalysisChapters: expect.arrayContaining([
        expect.objectContaining({ chapterId: 7 }),
        expect.objectContaining({ chapterId: 8 }),
      ]),
    }));
    expect(createSuggestionsMock).toHaveBeenCalledTimes(1);
    expect(createSuggestionsMock.mock.calls[0][1][0]).toMatchObject({
      type: 'relationship_update',
      source_chapter_id: 7,
      target_id: 1,
      target_name: 'Lan / Kha',
      suggested_value: 'Lan và Kha giấu một thỏa thuận mới.',
      candidate_op: {
        op_type: 'RELATIONSHIP_SECRET_CHANGED',
        chapter_id: 7,
        subject_id: 1,
        target_id: 2,
        payload: {
          secrecy_state: 'secret',
          emotional_aftermath: 'Căng nhưng còn tin nhau.',
        },
      },
    });
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 7)).toMatchObject({
      relationship_analysis_status: 'analyzed',
      relationship_suggestion_count: 1,
    });
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 8)).toMatchObject({
      relationship_analysis_status: 'analyzed',
      relationship_suggestion_count: 0,
    });
    expect(dbMocks.storyEventsAdd).not.toHaveBeenCalled();
    expect(dbMocks.storyEventsBulkAdd).not.toHaveBeenCalled();
  });

  it('marks a chapter failed when the AI omits it from the batch output', async () => {
    aiResponses.push({
      chapters: [
        { chapter_id: 7, relationship_updates: [] },
      ],
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().analyzeNeededRelationshipChapters({ projectId: 1 });

    expect(result.status).toBe('completed');
    expect(result.failedChapterIds).toEqual([8]);
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 7)).toMatchObject({
      relationship_analysis_status: 'analyzed',
    });
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 8)).toMatchObject({
      relationship_analysis_status: 'failed',
    });
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 8).relationship_analysis_error)
      .toContain('AI không trả kết quả');
  });

  it('skips duplicate relationship suggestions by chapter, pair, operation and summary', async () => {
    dbRows.suggestions = [{
      id: 99,
      project_id: 1,
      status: 'pending',
      type: 'relationship_update',
      source_chapter_id: 7,
      candidate_op: JSON.stringify({
        op_type: 'RELATIONSHIP_STATUS_CHANGED',
        chapter_id: 7,
        subject_id: 1,
        target_id: 2,
        summary: 'Lan và Kha giấu một thỏa thuận mới.',
      }),
    }];
    aiResponses.push({
      chapters: [
        {
          chapter_id: 7,
          relationship_updates: [{
            chapter_id: 7,
            character_a_name: 'Lan',
            character_b_name: 'Kha',
            change_type: 'status',
            relationship_type: 'friend',
            status_summary: 'Lan và Kha giấu một thỏa thuận mới.',
            evidence: 'Lan trao thư cho Kha.',
          }],
        },
        { chapter_id: 8, relationship_updates: [] },
      ],
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().analyzeNeededRelationshipChapters({ projectId: 1 });

    expect(result).toMatchObject({
      status: 'completed',
      createdCount: 0,
      skippedDuplicateCount: 1,
    });
    expect(createSuggestionsMock).not.toHaveBeenCalled();
  });

  it('forces analysis for a selected chapter that was already analyzed', async () => {
    const {
      buildRelationshipAnalysisChapterText,
      buildRelationshipAnalysisSignature,
    } = await import('../../services/ai/relationshipAnalysisPlanner.js');
    const chapter7Text = buildRelationshipAnalysisChapterText(
      dbRows.scenes.filter((scene) => scene.chapter_id === 7)
    );
    dbRows.chapterMeta = [{
      id: 30,
      project_id: 1,
      chapter_id: 7,
      relationship_analysis_signature: buildRelationshipAnalysisSignature(chapter7Text),
      relationship_analysis_status: 'analyzed',
      relationship_suggestion_count: 0,
    }];
    aiResponses.push({
      chapters: [
        { chapter_id: 7, relationship_updates: [] },
      ],
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().analyzeRelationshipChapters({
      projectId: 1,
      chapterIds: [7],
      force: true,
    });

    expect(result).toMatchObject({
      status: 'completed',
      analyzedChapterCount: 1,
      requestCount: 1,
      createdCount: 0,
    });
    expect(buildPromptMock).toHaveBeenCalledWith('relationship_analyze_batch', expect.objectContaining({
      relationshipAnalysisChapters: [
        expect.objectContaining({ chapterId: 7 }),
      ],
    }));
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 7)).toMatchObject({
      relationship_analysis_status: 'analyzed',
    });
  });

  it('keeps a split chapter failed if any request part is missing from the AI output', async () => {
    dbRows.chapters = [
      { id: 7, project_id: 1, order_index: 0, title: 'Chương dài' },
    ];
    dbRows.scenes = [
      { id: 70, project_id: 1, chapter_id: 7, order_index: 0, title: 'Cảnh 1', draft_text: 'Lan '.repeat(300) },
      { id: 71, project_id: 1, chapter_id: 7, order_index: 1, title: 'Cảnh 2', draft_text: 'Kha '.repeat(300) },
    ];
    aiResponses.push(
      { chapters: [] },
      {
        chapters: [{
          chapter_id: 7,
          relationship_updates: [{
            chapter_id: 7,
            character_a_name: 'Lan',
            character_b_name: 'Kha',
            change_type: 'status',
            status_summary: 'Lan và Kha căng thẳng hơn.',
            evidence: 'Kha im lặng.',
          }],
        }],
      },
    );
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().analyzeNeededRelationshipChapters({
      projectId: 1,
      maxEstimatedInputTokens: 3200,
    });

    expect(result).toMatchObject({
      status: 'failed',
      analyzedChapterCount: 0,
      requestCount: 2,
      createdCount: 0,
      failedChapterIds: [7],
    });
    expect(createSuggestionsMock).not.toHaveBeenCalled();
    expect(dbRows.chapterMeta.find((meta) => meta.chapter_id === 7)).toMatchObject({
      relationship_analysis_status: 'failed',
    });
  });
});
