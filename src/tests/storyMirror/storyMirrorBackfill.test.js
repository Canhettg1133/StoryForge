import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMemoryDb({ projects = [], chapters = [], scenes = [] } = {}) {
  const statusRows = new Map();
  const outboxRows = new Map();

  const makeTable = (rows) => ({
    toArray: vi.fn(async () => [...rows]),
    get: vi.fn(async (id) => rows.find((row) => row.id === id)),
    where: vi.fn((key) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => rows.filter((row) => row[key] === value)),
      })),
    })),
  });

  return {
    db: {
      projects: makeTable(projects),
      chapters: makeTable(chapters),
      scenes: makeTable(scenes),
      storyMirrorOutbox: {
        put: vi.fn(async (row) => {
          outboxRows.set(row.id, row);
          return row.id;
        }),
        toArray: vi.fn(async () => [...outboxRows.values()]),
        delete: vi.fn(async (id) => outboxRows.delete(id)),
        update: vi.fn(async (id, patch) => {
          outboxRows.set(id, { ...outboxRows.get(id), ...patch });
          return 1;
        }),
      },
      storyMirrorStatus: {
        get: vi.fn(async (id) => statusRows.get(id)),
        put: vi.fn(async (row) => {
          statusRows.set(row.id, row);
          return row.id;
        }),
      },
    },
    outboxRows,
    statusRows,
  };
}

async function loadBackfillWithDb(memory, statusResponse = { ok: true, enabled: true, quotaBytes: 1000, usedBytes: 0 }, options = {}) {
  vi.resetModules();
  vi.doMock('../../services/db/database.js', () => ({ default: memory.db }));
  vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
    isCloudAuthConfigured: () => options.authConfigured !== false,
  }));
  vi.doMock('../../services/storyMirror/config.js', () => ({
    STORY_MIRROR_OUTBOX_LIMIT: 25,
    STORY_MIRROR_DEBOUNCE_MS: 45_000,
    STORY_MIRROR_MAX_ATTEMPTS: 5,
    STORY_MIRROR_BACKFILL_BATCH_SIZE: 25,
    STORY_MIRROR_BACKFILL_IDLE_DELAY_MS: 0,
    getRetryDelayMs: () => 60_000,
    getStoryMirrorBaseUrl: () => 'https://mirror.example',
    isStoryMirrorEnabled: () => true,
  }));
  const postStoryMirrorBatch = vi.fn(async () => ({ ok: true, results: [] }));
  vi.doMock('../../services/storyMirror/apiClient.js', () => ({
    getStoryMirrorStatus: vi.fn(async () => statusResponse),
    postStoryMirrorBatch,
  }));

  const backfill = await import('../../services/storyMirror/backfill.js');
  const identity = await import('../../services/storyMirror/identity.js');
  return { ...backfill, ...identity, postStoryMirrorBatch };
}

describe('story mirror local backfill', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('queues old IndexedDB scenes into the story mirror outbox without persisting raw content', async () => {
    const memory = createMemoryDb({
      projects: [{ id: 11, title: 'Old project', genre_primary: 'fantasy', status: 'active', updated_at: 1700000000000 }],
      chapters: [{ id: 22, project_id: 11, title: 'Chapter 1', order_index: 0, status: 'draft' }],
      scenes: [
        {
          id: 33,
          project_id: 11,
          chapter_id: 22,
          title: 'Old scene',
          order_index: 0,
          status: 'draft',
          draft_text: '<p>old raw story content</p>',
          final_text: '',
          translated_text: '<p>must not be queued</p>',
          prompt: 'must not be queued',
          chat_messages: ['must not be queued'],
          updated_at: 1700000000001,
        },
        {
          id: 34,
          project_id: 11,
          chapter_id: 22,
          title: 'Empty scene',
          order_index: 1,
          status: 'draft',
          draft_text: '<p><br></p>',
          final_text: '',
          updated_at: 1700000000002,
        },
      ],
    });
    const { runStoryMirrorBackfill, postStoryMirrorBatch } = await loadBackfillWithDb(memory);

    const result = await runStoryMirrorBackfill({ force: true, reason: 'test' });

    expect(result.status).toBe('completed');
    expect(result.queuedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(postStoryMirrorBatch).not.toHaveBeenCalled();
    expect(memory.outboxRows.size).toBe(1);

    const row = [...memory.outboxRows.values()][0];
    expect(row.id).toMatch(/^scene:install:/u);
    expect(row.project_id).toBe(11);
    expect(row.chapter_id).toBe(22);
    expect(row.scene_id).toBe(33);
    expect(row.idempotency_key).toMatch(/^scene:install:/u);
    expect(row.content_hash).toBeTruthy();
    expect(row).not.toHaveProperty('payload');

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('<p>');
    expect(serialized).not.toContain('old raw story content');
    expect(serialized).not.toContain('translated_text');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('chat_messages');
    expect(serialized).not.toContain('must not be queued');
  });

  it('is idempotent when the same backfill runs again on one installation', async () => {
    const memory = createMemoryDb({
      projects: [{ id: 11, title: 'Old project', updated_at: 1700000000000 }],
      chapters: [{ id: 22, project_id: 11, title: 'Chapter 1', order_index: 0 }],
      scenes: [{ id: 33, project_id: 11, chapter_id: 22, title: 'Old scene', draft_text: '<p>Old</p>', updated_at: 1700000000001 }],
    });
    const { runStoryMirrorBackfill } = await loadBackfillWithDb(memory);

    await runStoryMirrorBackfill({ force: true, reason: 'first-test' });
    const firstRow = [...memory.outboxRows.values()][0];
    await runStoryMirrorBackfill({ force: true, reason: 'second-test' });
    const secondRow = [...memory.outboxRows.values()][0];

    expect(memory.outboxRows.size).toBe(1);
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.idempotency_key).toBe(firstRow.idempotency_key);
    expect(secondRow).not.toHaveProperty('payload');
  });

  it('does not scan local stories when the remote status says story mirror is disabled', async () => {
    const memory = createMemoryDb({
      projects: [{ id: 11, title: 'Old project' }],
      chapters: [{ id: 22, project_id: 11, title: 'Chapter 1' }],
      scenes: [{ id: 33, project_id: 11, chapter_id: 22, title: 'Old scene', draft_text: '<p>Old</p>' }],
    });
    const { runStoryMirrorBackfill } = await loadBackfillWithDb(memory, {
      ok: true,
      enabled: false,
      disabledCode: 'STORY_MIRROR_TEST_ONLY',
    });

    const result = await runStoryMirrorBackfill({ force: true, reason: 'test-disabled' });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('STORY_MIRROR_TEST_ONLY');
    expect(memory.db.projects.toArray).not.toHaveBeenCalled();
    expect(memory.outboxRows.size).toBe(0);
  });

  it('does not touch local stories when Supabase Auth is not configured', async () => {
    const memory = createMemoryDb({
      projects: [{ id: 11, title: 'Old project' }],
      chapters: [{ id: 22, project_id: 11, title: 'Chapter 1' }],
      scenes: [{ id: 33, project_id: 11, chapter_id: 22, title: 'Old scene', draft_text: '<p>Old</p>' }],
    });
    const { runStoryMirrorBackfill } = await loadBackfillWithDb(memory, { ok: true, enabled: true }, { authConfigured: false });

    const result = await runStoryMirrorBackfill({ force: true, reason: 'test-auth-missing' });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('STORY_MIRROR_AUTH_UNCONFIGURED');
    expect(memory.db.projects.toArray).not.toHaveBeenCalled();
    expect(memory.outboxRows.size).toBe(0);
  });

  it('keeps mirror client ids stable per installation and different across installations', async () => {
    const memory = createMemoryDb();
    const { getStoryMirrorInstallationId, formatMirrorClientId } = await loadBackfillWithDb(memory);

    const firstInstallation = await getStoryMirrorInstallationId();
    const sameInstallation = await getStoryMirrorInstallationId();

    expect(sameInstallation).toBe(firstInstallation);
    expect(formatMirrorClientId(firstInstallation, 'project', 11)).toBe(`install:${firstInstallation}:project:11`);
    expect(formatMirrorClientId('device-b', 'project', 11)).not.toBe(formatMirrorClientId(firstInstallation, 'project', 11));
  });
});
