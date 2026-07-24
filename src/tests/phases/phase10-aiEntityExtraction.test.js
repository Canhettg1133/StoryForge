import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  aiSendMock,
  buildPromptMock,
  dbRows,
  objectLoadError,
} = vi.hoisted(() => ({
  aiSendMock: vi.fn(),
  buildPromptMock: vi.fn(() => [{ role: 'user', content: 'extract' }]),
  dbRows: {
    characters: [],
    locations: [],
    objects: [],
    worldTerms: [],
  },
  objectLoadError: { current: null },
}));

function makeProjectTable(rowsKey) {
  return {
    where: vi.fn((field) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => {
          if (rowsKey === 'objects' && objectLoadError.current) throw objectLoadError.current;
          return dbRows[rowsKey].filter((row) => row[field] === value);
        }),
      })),
    })),
  };
}

vi.mock('../../services/ai/client', () => ({
  default: {
    setRouter: vi.fn(),
    send: aiSendMock,
    abort: vi.fn(),
  },
}));

vi.mock('../../services/ai/promptBuilder', () => ({
  buildPrompt: buildPromptMock,
}));

vi.mock('../../services/ai/keyManager', () => ({
  default: { getTotalKeys: vi.fn(() => 1) },
}));

vi.mock('../../services/ai/contextEngine', () => ({
  gatherContext: vi.fn(async () => ({})),
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: { get: vi.fn(async () => null) },
    chapterMeta: makeProjectTable('characters'),
    characters: makeProjectTable('characters'),
    locations: makeProjectTable('locations'),
    objects: makeProjectTable('objects'),
    worldTerms: makeProjectTable('worldTerms'),
  },
}));

async function loadAIStore() {
  vi.resetModules();
  return (await import('../../stores/aiStore.js')).default;
}

describe('phase10 AI entity extraction context', () => {
  beforeEach(() => {
    localStorage.clear();
    objectLoadError.current = null;
    dbRows.characters = Array.from({ length: 16 }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      name: `Nhân vật ${index + 1}`,
      aliases: index === 15 ? ['Người thứ mười sáu'] : [],
      description: 'Không gửi mô tả này',
    }));
    dbRows.locations = [{ id: 21, project_id: 1, name: 'Thanh Vân Sơn', aliases: ['Thanh Vân'] }];
    dbRows.objects = [{ id: 31, project_id: 1, name: 'Huyết Liên Đan', aliases: ['Viên Huyết Liên Đan'] }];
    dbRows.worldTerms = [{ id: 41, project_id: 1, name: 'Linh lực', aliases: ['Linh khí'] }];
    buildPromptMock.mockClear();
    aiSendMock.mockReset();
    aiSendMock.mockImplementation((options) => {
      options.onComplete(JSON.stringify({ characters: [], locations: [], objects: [], terms: [] }));
      return { abort: vi.fn() };
    });
  });

  it('loads all four compact identity groups before calling feedback extraction', async () => {
    const useAIStore = await loadAIStore();

    await useAIStore.getState().extractFromChapter({
      projectId: 1,
      chapterId: 11,
      sceneText: 'Nội dung chương.',
      promptTemplates: {},
      nsfwMode: false,
      superNsfwMode: false,
    });

    const context = buildPromptMock.mock.calls[0][1];
    expect(context.entityIdentityRoster.characters).toHaveLength(16);
    expect(context.entityIdentityRoster.characters[15]).toEqual({
      id: 16,
      name: 'Nhân vật 16',
      aliases: ['Người thứ mười sáu'],
    });
    expect(context.entityIdentityRoster.locations[0].name).toBe('Thanh Vân Sơn');
    expect(context.entityIdentityRoster.objects[0].name).toBe('Huyết Liên Đan');
    expect(context.entityIdentityRoster.worldTerms[0].name).toBe('Linh lực');
    expect(context.entityIdentityRoster.characters[0]).not.toHaveProperty('description');
  });

  it('fails closed without sending AI when the identity roster cannot be loaded', async () => {
    const useAIStore = await loadAIStore();
    objectLoadError.current = new Error('object table unavailable');

    await expect(useAIStore.getState().extractFromChapter({
      projectId: 1,
      chapterId: 11,
      sceneText: 'Nội dung chương.',
      promptTemplates: {},
      nsfwMode: false,
      superNsfwMode: false,
    })).rejects.toThrow('object table unavailable');

    expect(aiSendMock).not.toHaveBeenCalled();
  });

  it('treats a top-level extraction array as an invalid contract', async () => {
    aiSendMock.mockImplementationOnce((options) => {
      options.onComplete(JSON.stringify([{ name: 'Lý Mặc' }]));
      return { abort: vi.fn() };
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().extractFromChapter({
      projectId: 1,
      chapterId: 11,
      sceneText: 'Lý Mặc xuất hiện.',
      promptTemplates: {},
      nsfwMode: false,
      superNsfwMode: false,
    });

    expect(result).toBeNull();
  });

  it('treats an extraction object with missing entity groups as invalid', async () => {
    aiSendMock.mockImplementationOnce((options) => {
      options.onComplete(JSON.stringify({ characters: [] }));
      return { abort: vi.fn() };
    });
    const useAIStore = await loadAIStore();

    const result = await useAIStore.getState().extractFromChapter({
      projectId: 1,
      chapterId: 11,
      sceneText: 'Không có thực thể mới.',
      promptTemplates: {},
      nsfwMode: false,
      superNsfwMode: false,
    });

    expect(result).toBeNull();
  });
});
