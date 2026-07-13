import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('phase21 Cloud content hash deduplication', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('clears dirty state without creating a Supabase upsert when content hash is unchanged', async () => {
    vi.resetModules();
    const getSupabaseClient = vi.fn();
    vi.doMock('../../services/cloud/cloudAuthService.js', () => ({
      getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
    }));
    vi.doMock('../../services/cloud/supabaseClient.js', () => ({
      getSupabaseClient,
      getSupabaseConfigError: () => '',
      isSupabaseConfigured: () => true,
    }));

    const { default: db } = await import('../../services/db/database.js');
    const { buildProjectSnapshot, hashProjectSnapshot } = await import('../../services/db/projectSnapshot.js');
    const { backupProject } = await import('../../services/cloud/cloudBackupService.js');
    const { getDirtyProjectIds, markProjectBackupDirty } = await import('../../services/cloud/projectBackupDirty.js');
    if (db.isOpen()) db.close();
    await db.delete();
    await db.open();
    const projectId = await db.projects.add({ title: 'Same project', updated_at: 1 });
    const chapterId = await db.chapters.add({ project_id: projectId, title: 'Chapter', order_index: 1 });
    await db.scenes.add({ project_id: projectId, chapter_id: chapterId, content: '<p>same</p>', order_index: 1 });
    const snapshot = await buildProjectSnapshot(projectId);
    const contentHash = await hashProjectSnapshot(snapshot);
    markProjectBackupDirty(projectId);

    const result = await backupProject(await db.projects.get(projectId), {
      snapshot,
      contentHash,
      cloudItem: {
        itemSlug: 'same-project-1',
        itemTitle: 'Same project',
        updatedAt: '2026-01-01T00:00:00.000Z',
        metadata: { contentHash },
      },
    });

    expect(result.skipped).toBe(true);
    expect(getSupabaseClient).not.toHaveBeenCalled();
    expect(getDirtyProjectIds()).not.toContain(projectId);
    db.close();
    await db.delete();
  });
});
