import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
  }

  orderBy(field) {
    return {
      reverse: () => ({
        toArray: async () => [...this.rows].sort(
          (left, right) => Number(right?.[field] || 0) - Number(left?.[field] || 0),
        ),
      }),
    };
  }

  async toArray() {
    return clone(this.rows);
  }

  async add(record) {
    const id = this.rows.length + 1;
    this.rows.push({ ...clone(record), id });
    return id;
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(patch) };
    return 1;
  }

  async get(id) {
    return this.rows.find((row) => row.id === id) || null;
  }
}

async function loadProjectStore() {
  vi.resetModules();
  const db = {
    projects: new MemoryTable(),
    chapters: new MemoryTable(),
    scenes: new MemoryTable(),
  };

  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../stores/aiStore', () => ({
    default: {
      getState: () => ({
        summarizeChapter: vi.fn(),
        extractFromChapter: vi.fn(),
      }),
    },
  }));
  vi.doMock('../../stores/codexStore', () => ({
    default: {
      getState: () => ({
        applyCompletionDelta: vi.fn(async () => undefined),
        loadCodex: vi.fn(async () => undefined),
      }),
    },
  }));
  vi.doMock('../../services/canon/workflow', () => ({
    canonicalizeChapter: vi.fn(async () => ({ ok: true, revisionId: 1 })),
  }));
  vi.doMock('../../services/canon/projection', () => ({
    purgeChapterCanonState: vi.fn(async () => undefined),
    rebuildCanonFromChapter: vi.fn(async () => undefined),
  }));
  vi.doMock('../../services/db/projectDataService.js', () => ({
    deleteProjectCascade: vi.fn(async () => undefined),
  }));

  const module = await import('../../stores/projectStore.js');
  return { store: module.default, db };
}

describe('phase10 project content mode persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists content mode flags when creating a project from wizard defaults', async () => {
    const { store, db } = await loadProjectStore();

    await store.getState().createProject({
      title: 'Du an 18+',
      genre_primary: 'fantasy',
      nsfw_mode: true,
      super_nsfw_mode: true,
      skipFirstChapter: true,
    });

    expect(db.projects.rows[0]).toMatchObject({
      nsfw_mode: true,
      super_nsfw_mode: true,
    });
  });

  it('builds ProjectChat send options from the current project content mode flags', async () => {
    vi.resetModules();
    const module = await import('../../pages/ProjectChat/ProjectChat.jsx');

    expect(typeof module.buildChatRequestOptions).toBe('function');
    expect(module.buildChatRequestOptions({
      routeOptions: { providerOverride: 'gemini-direct' },
      project: {
        nsfw_mode: true,
        super_nsfw_mode: true,
      },
    })).toMatchObject({
      routeOptions: { providerOverride: 'gemini-direct' },
      chatSafetyOff: true,
      nsfwMode: true,
      superNsfwMode: true,
    });
  });
});
