import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('story mirror outbox integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps updateScene local-first when story mirror enqueue fails', async () => {
    vi.doMock('../../services/storyMirror/outbox.js', () => ({
      enqueueSceneMirror: vi.fn(async () => {
        throw new Error('R2 offline');
      }),
    }));

    const memory = {
      projects: new Map([[1, { id: 1, title: 'Local', updated_at: 1 }]]),
      chapters: new Map([[2, { id: 2, project_id: 1, title: 'Chương 1', order_index: 0 }]]),
      scenes: new Map([[3, { id: 3, project_id: 1, chapter_id: 2, title: 'Cảnh', draft_text: '' }]]),
    };
    const makeTable = (name) => ({
      get: vi.fn(async (id) => memory[name].get(id)),
      update: vi.fn(async (id, patch) => {
        memory[name].set(id, { ...memory[name].get(id), ...patch });
        return 1;
      }),
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          sortBy: vi.fn(async () => [...memory[name].values()]),
          toArray: vi.fn(async () => [...memory[name].values()]),
          delete: vi.fn(async () => 0),
        })),
      })),
    });

    vi.doMock('../../services/db/database.js', () => ({
      default: {
        projects: makeTable('projects'),
        chapters: makeTable('chapters'),
        scenes: makeTable('scenes'),
      },
    }));

    const useProjectStore = (await import('../../stores/projectStore.js')).default;
    useProjectStore.setState({
      currentProject: { id: 1, title: 'Local' },
      chapters: [{ id: 2, project_id: 1, title: 'Chương 1', order_index: 0 }],
      scenes: [{ id: 3, project_id: 1, chapter_id: 2, title: 'Cảnh', draft_text: '' }],
    });

    await expect(useProjectStore.getState().updateScene(3, { draft_text: '<p>Đã lưu local</p>' }))
      .resolves.toBeUndefined();

    expect(memory.scenes.get(3).draft_text).toBe('<p>Đã lưu local</p>');
  });
});
