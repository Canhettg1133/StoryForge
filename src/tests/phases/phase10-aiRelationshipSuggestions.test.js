import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  captured,
  createSuggestionsMock,
  dbRows,
  keyManagerMock,
  suggestionStoreMock,
} = vi.hoisted(() => {
  const createSuggestionsMock = vi.fn(async () => {});
  return {
    captured: { sendOptions: null },
    createSuggestionsMock,
    dbRows: {
      scenes: [],
      characters: [],
      canonFacts: [],
      project: null,
    },
    keyManagerMock: {
      getTotalKeys: vi.fn(() => 1),
    },
    suggestionStoreMock: {
      getState: vi.fn(() => ({ createSuggestions: createSuggestionsMock })),
    },
  };
});

function makeWhereTable(getRows, fieldName) {
  return {
    where: vi.fn((field) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => (
          field === fieldName
            ? getRows().filter((row) => row[field] === value)
            : getRows()
        )),
        sortBy: vi.fn(async (sortField) => (
          getRows()
            .filter((row) => row[field] === value)
            .slice()
            .sort((a, b) => (a[sortField] || 0) - (b[sortField] || 0))
        )),
        first: vi.fn(async () => getRows().find((row) => row[field] === value) || null),
      })),
    })),
  };
}

vi.mock('../../services/ai/client', () => ({
  default: {
    setRouter: vi.fn(),
    send: vi.fn((options) => {
      captured.sendOptions = options;
      options.onComplete(JSON.stringify({
        character_updates: [],
        new_canon_facts: [],
        relationship_updates: [{
          character_a_name: 'Lan',
          character_b_name: 'Kha',
          change_type: 'secret',
          relationship_type: 'friend',
          secrecy_state: 'secret',
          status_summary: 'Lan và Kha giấu một thỏa thuận mới.',
          emotional_aftermath: 'Căng nhưng còn tin nhau.',
          reasoning: 'Hai người trao thư rồi né tránh câu hỏi.',
          confidence: 0.82,
        }],
      }));
      return { abort: vi.fn() };
    }),
    abort: vi.fn(),
  },
}));

vi.mock('../../services/ai/promptBuilder', () => ({
  buildPrompt: vi.fn(() => [{ role: 'user', content: 'suggest' }]),
}));

vi.mock('../../services/ai/keyManager', () => ({
  default: keyManagerMock,
}));

vi.mock('../../stores/suggestionStore', () => ({
  default: suggestionStoreMock,
}));

vi.mock('../../services/db/database', () => ({
  default: {
    scenes: makeWhereTable(() => dbRows.scenes, 'chapter_id'),
    characters: makeWhereTable(() => dbRows.characters, 'project_id'),
    canonFacts: makeWhereTable(() => dbRows.canonFacts, 'project_id'),
    projects: {
      get: vi.fn(async () => dbRows.project),
    },
    chapterMeta: makeWhereTable(() => [], 'chapter_id'),
  },
}));

async function loadAIStore() {
  vi.resetModules();
  captured.sendOptions = null;
  const module = await import('../../stores/aiStore.js');
  return module.default;
}

describe('phase10 AI relationship suggestions', () => {
  beforeEach(() => {
    localStorage.clear();
    createSuggestionsMock.mockClear();
    suggestionStoreMock.getState.mockClear();
    keyManagerMock.getTotalKeys.mockClear();
    dbRows.project = { id: 1, title: 'Dự án', nsfw_mode: false };
    dbRows.scenes = [
      { id: 10, chapter_id: 7, order_index: 0, draft_text: '<p>Lan trao thư cho Kha.</p>' },
    ];
    dbRows.characters = [
      { id: 1, project_id: 1, name: 'Lan' },
      { id: 2, project_id: 1, name: 'Kha' },
    ];
    dbRows.canonFacts = [];
  });

  it('maps AI relationship_updates into relationship_update candidate ops instead of writing canon directly', async () => {
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().generateSuggestions({
      projectId: 1,
      chapterId: 7,
      genre: 'fantasy',
    });

    expect(result.status).toBe('created');
    expect(createSuggestionsMock).toHaveBeenCalledTimes(1);

    const [projectId, suggestions] = createSuggestionsMock.mock.calls[0];
    expect(projectId).toBe(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
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
        confidence: 0.82,
        payload: {
          relationship_type: 'friend',
          secrecy_state: 'secret',
          emotional_aftermath: 'Căng nhưng còn tin nhau.',
        },
      },
    });
  });
});
