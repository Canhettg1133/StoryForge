import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import db from '../../services/db/database.js';
import {
  hashProjectSnapshot,
  importProjectSnapshot,
  migrateProjectSnapshot,
} from '../../services/db/projectSnapshot.js';
import { inspectStoryBundle } from '../../services/storyBundle/storyBundle.js';
import { parseBoundedJson } from '../../services/storyBundle/storyBundleSafety.js';

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

function findEocd(bytes) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (new DataView(bytes.buffer).getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

describe('Story Bundle security boundaries', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
  });

  it('rejects prototype-pollution keys and JSON deeper than 64 levels', () => {
    expect(() => parseBoundedJson('{"__proto__":{"admin":true}}'))
      .toThrowError(expect.objectContaining({ code: 'STORY_BUNDLE_FORBIDDEN_KEY' }));

    let deep = 'null';
    for (let index = 0; index < 66; index += 1) deep = `{"value":${deep}}`;
    expect(() => parseBoundedJson(deep))
      .toThrowError(expect.objectContaining({ code: 'STORY_BUNDLE_JSON_TOO_DEEP' }));
  });

  it('rejects ZIP64 markers before JSZip extracts any entry', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', '{}');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const eocdOffset = findEocd(bytes);
    new DataView(bytes.buffer).setUint16(eocdOffset + 10, 0xffff, true);

    await expect(inspectStoryBundle(new Blob([bytes])))
      .rejects.toMatchObject({ code: 'STORY_BUNDLE_ZIP64_UNSUPPORTED' });
  });

  it('never imports role, plan, entitlement, admin or session fields as project data', async () => {
    const result = await importProjectSnapshot({
      _storyforge_version: 7,
      project: {
        id: 1,
        title: 'Untrusted project',
        role: 'admin',
        plan: 'enterprise',
        feature_entitlements: ['admin.story_mirror'],
        is_admin: true,
        access_token: 'secret-token',
      },
    });
    const imported = await db.projects.get(result.projectId);

    expect(imported).not.toHaveProperty('role');
    expect(imported).not.toHaveProperty('plan');
    expect(imported).not.toHaveProperty('feature_entitlements');
    expect(imported).not.toHaveProperty('is_admin');
    expect(imported).not.toHaveProperty('access_token');
  });

  it('migrates legacy versions and hashes equal content independently of export/cloud timestamps', async () => {
    for (let version = 1; version <= 7; version += 1) {
      expect(migrateProjectSnapshot({
        _storyforge_version: version,
        project: { id: 1, title: 'Legacy' },
      })._storyforge_version).toBe(8);
    }

    const base = migrateProjectSnapshot({
      _storyforge_version: 7,
      _exported_at: '2026-01-01T00:00:00.000Z',
      project: { id: 1, title: 'Same', updated_at: 1, cloud_last_synced_at: 1 },
      scenes: [{ id: 1, project_id: 1, content: '<p>same</p>' }],
    });
    const changedMetadata = {
      ...base,
      _exported_at: '2026-02-01T00:00:00.000Z',
      project: { ...base.project, updated_at: 999, cloud_last_synced_at: 999 },
    };
    await expect(hashProjectSnapshot(base)).resolves.toBe(await hashProjectSnapshot(changedMetadata));
  });
});
