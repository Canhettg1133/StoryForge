import { describe, expect, it, vi } from 'vitest';
import {
  buildBackfillObjectKey,
  hashLegacyPayload,
  runCloudSyncBackfill,
} from '../../../scripts/cloud-sync-r2-backfill-lib.mjs';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  scope: 'project',
  item_slug: 'private-title-must-not-be-keyed',
  payload_text: '{}',
};

describe('Cloud Sync R2 backfill', () => {
  it('uses deterministic keys and exact UTF-8 size/hash', () => {
    const hashed = hashLegacyPayload(row.payload_text);
    expect(hashed.sizeBytes).toBe(2);
    expect(buildBackfillObjectKey(row, hashed.payloadSha256)).toBe(
      `users/${row.user_id}/snapshots/project/${row.id}/${hashed.payloadSha256}.json`,
    );
    expect(buildBackfillObjectKey({
      ...row,
      manifest_id: '44444444-4444-4444-8444-444444444444',
    }, hashed.payloadSha256)).toContain('/44444444-4444-4444-8444-444444444444/');
  });

  it('dry-run and resume scan rows without any R2/database/checkpoint writes', async () => {
    const rows = [row, { ...row, id: '33333333-3333-4333-8333-333333333333' }];
    const database = {
      fetchNext: vi.fn(async (afterId) => rows.find((item) => item.id > (afterId || '')) || null),
      commitManifest: vi.fn(),
    };
    const objectStore = {
      head: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const saveCheckpoint = vi.fn();

    const report = await runCloudSyncBackfill({
      database,
      objectStore,
      dryRun: true,
      checkpoint: { lastId: row.id },
      saveCheckpoint,
    });

    expect(report.scanned).toBe(1);
    expect(database.commitManifest).not.toHaveBeenCalled();
    expect(objectStore.head).not.toHaveBeenCalled();
    expect(objectStore.put).not.toHaveBeenCalled();
    expect(objectStore.delete).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it('reuses a verified object and does not create duplicate R2 data on resume', async () => {
    const hashed = hashLegacyPayload(row.payload_text);
    const database = {
      fetchNext: vi.fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null),
      commitManifest: vi.fn(async () => ({ status: 'backfilled' })),
    };
    const objectStore = {
      head: vi.fn(async () => ({
        sizeBytes: hashed.sizeBytes,
        payloadSha256: hashed.payloadSha256,
      })),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const saveCheckpoint = vi.fn();

    const report = await runCloudSyncBackfill({ database, objectStore, saveCheckpoint });

    expect(report.reused).toBe(1);
    expect(report.backfilled).toBe(1);
    expect(objectStore.put).not.toHaveBeenCalled();
    expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ lastId: row.id }));
  });

  it('removes a newly uploaded object when a newer manifest or tombstone wins', async () => {
    const database = {
      fetchNext: vi.fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null),
      commitManifest: vi.fn(async () => ({ status: 'tombstoned' })),
    };
    const objectStore = {
      head: vi.fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async () => {
          const hashed = hashLegacyPayload(row.payload_text);
          return { sizeBytes: hashed.sizeBytes, payloadSha256: hashed.payloadSha256 };
        }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const report = await runCloudSyncBackfill({ database, objectStore });

    expect(report.tombstoned).toBe(1);
    expect(objectStore.put).toHaveBeenCalledOnce();
    expect(objectStore.delete).toHaveBeenCalledOnce();
  });

  it('removes a newly uploaded object when manifest commit fails', async () => {
    const database = {
      fetchNext: vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null),
      commitManifest: vi.fn(async () => {
        throw Object.assign(new Error('commit failed'), { code: 'COMMIT_FAILED' });
      }),
    };
    const hashed = hashLegacyPayload(row.payload_text);
    const objectStore = {
      head: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ sizeBytes: hashed.sizeBytes, payloadSha256: hashed.payloadSha256 }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    await expect(runCloudSyncBackfill({ database, objectStore }))
      .rejects.toMatchObject({ code: 'COMMIT_FAILED' });
    expect(objectStore.delete).toHaveBeenCalledOnce();
  });

  it('removes a newly uploaded object when post-upload HEAD verification fails', async () => {
    const database = {
      fetchNext: vi.fn().mockResolvedValueOnce(row),
      commitManifest: vi.fn(),
    };
    const objectStore = {
      head: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    await expect(runCloudSyncBackfill({ database, objectStore }))
      .rejects.toMatchObject({ code: 'R2_UPLOAD_INTEGRITY_MISMATCH' });
    expect(objectStore.delete).toHaveBeenCalledOnce();
    expect(database.commitManifest).not.toHaveBeenCalled();
  });

  it('refuses to checkpoint an unknown backfill RPC status and removes its new object', async () => {
    const hashed = hashLegacyPayload(row.payload_text);
    const database = {
      fetchNext: vi.fn().mockResolvedValueOnce(row),
      commitManifest: vi.fn(async () => ({ status: 'unexpected' })),
    };
    const objectStore = {
      head: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ sizeBytes: hashed.sizeBytes, payloadSha256: hashed.payloadSha256 }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const saveCheckpoint = vi.fn();

    await expect(runCloudSyncBackfill({ database, objectStore, saveCheckpoint }))
      .rejects.toMatchObject({ code: 'BACKFILL_RESULT_INVALID' });
    expect(objectStore.delete).toHaveBeenCalledOnce();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});
