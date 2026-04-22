import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ai/client', () => ({
  default: {
    setRouter: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: {
      get: vi.fn(async () => ({
        id: 77,
        target_length: 120,
        milestones: '[]',
      })),
    },
    macro_arcs: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          sortBy: vi.fn(async () => []),
        })),
      })),
    },
  },
}));

async function loadArcGenStore() {
  vi.resetModules();
  const module = await import('../../stores/arcGenerationStore.js');
  return module.default;
}

describe('phase10 arc generation route persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not reset an in-flight draft session when the modal re-initializes for the same project', async () => {
    const useArcGenStore = await loadArcGenStore();

    useArcGenStore.setState({
      sessionProjectId: 77,
      currentChapterCount: 10,
      generatedOutline: {
        arc_title: 'Dang draft',
        chapters: [{ title: 'Chuong 11: Mo man', summary: '...' }],
      },
      outlineStatus: 'ready',
      draftStatus: 'drafting',
      draftProgress: { current: 0, total: 1 },
      draftResults: [
        {
          outlineIndex: 0,
          chapterIndex: 10,
          title: 'Chuong 11: Mo man',
          status: 'pending',
        },
      ],
    });

    await useArcGenStore.getState().initializeArcGeneration({
      projectId: 77,
      currentChapterCount: 10,
    });

    expect(useArcGenStore.getState().draftStatus).toBe('drafting');
    expect(useArcGenStore.getState().generatedOutline?.arc_title).toBe('Dang draft');
    expect(useArcGenStore.getState().draftResults).toHaveLength(1);
  });
});
