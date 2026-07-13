import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import db from '../../services/db/database.js';
import { labLiteDb } from '../../services/labLite/labLiteDb.js';
import {
  clearProjectBackupDirty,
  getDirtyProjectIds,
  installProjectDirtyTracking,
} from '../../services/cloud/projectBackupDirty.js';

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
  if (labLiteDb.isOpen()) labLiteDb.close();
  await labLiteDb.delete();
  await labLiteDb.open();
}

describe('phase21 Cloud project dirty tracking', () => {
  beforeEach(async () => {
    localStorage.clear();
    installProjectDirtyTracking(db);
    await resetDatabase();
  });

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
    if (labLiteDb.isOpen()) labLiteDb.close();
    await labLiteDb.delete();
    localStorage.clear();
  });

  it('marks durable child-table mutations without relying on projects.updated_at', async () => {
    const projectId = await db.projects.add({ title: 'Dirty project', updated_at: 1 });
    clearProjectBackupDirty(projectId);

    const characterId = await db.characters.add({ project_id: projectId, name: 'Linh' });
    expect(getDirtyProjectIds()).toContain(projectId);
    clearProjectBackupDirty(projectId);

    await db.locations.add({ project_id: projectId, name: 'City' });
    expect(getDirtyProjectIds()).toContain(projectId);
    clearProjectBackupDirty(projectId);

    await db.timelineEvents.add({ project_id: projectId, character_id: characterId, date_marker: 'Day 1' });
    expect(getDirtyProjectIds()).toContain(projectId);
    clearProjectBackupDirty(projectId);

    await db.project_assets.add({ project_id: projectId, role: 'cover', data_url: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(getDirtyProjectIds()).toContain(projectId);
    clearProjectBackupDirty(projectId);

    await db.project_analysis_snapshots.add({ project_id: projectId, analysis_id: 'analysis-1' });
    expect(getDirtyProjectIds()).toContain(projectId);
    expect((await db.projects.get(projectId)).updated_at).toBe(1);
  });

  it('does not mark cloud bookkeeping updates as story changes', async () => {
    const projectId = await db.projects.add({ title: 'Cloud metadata', updated_at: 1 });
    clearProjectBackupDirty(projectId);

    await db.projects.update(projectId, {
      cloud_last_synced_at: 10,
      cloud_last_server_updated_at: '2026-01-01T00:00:00.000Z',
      cloud_owner_user_id: 'user-1',
    });

    expect(getDirtyProjectIds()).not.toContain(projectId);
  });

  it('marks a fanfic project dirty when its referenced Canon Pack changes', async () => {
    const projectId = await db.projects.add({ title: 'Fanfic project', updated_at: 1 });
    await labLiteDb.canonPacks.put({
      id: 'pack-dirty',
      projectId: String(projectId),
      linkedProjectId: String(projectId),
      title: 'Canon pack',
    });
    clearProjectBackupDirty(projectId);

    await labLiteDb.canonPacks.update('pack-dirty', { title: 'Canon pack updated' });

    expect(getDirtyProjectIds()).toContain(projectId);
  });
});
