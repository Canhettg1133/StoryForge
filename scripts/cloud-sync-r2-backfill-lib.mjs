import { createHash } from 'node:crypto';

export function buildBackfillObjectKey(row, payloadSha256) {
  const snapshotId = row.manifest_id || row.id;
  return `users/${row.user_id}/snapshots/${row.scope}/${snapshotId}/${payloadSha256}.json`;
}

export function hashLegacyPayload(payloadText) {
  const bytes = Buffer.from(String(payloadText || ''), 'utf8');
  return {
    bytes,
    sizeBytes: bytes.byteLength,
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function createReport() {
  return {
    scanned: 0,
    uploaded: 0,
    reused: 0,
    backfilled: 0,
    tombstoned: 0,
    newerManifest: 0,
    pendingUpload: 0,
    totalBytes: 0,
    lastId: null,
  };
}

export async function runCloudSyncBackfill({
  database,
  objectStore,
  dryRun = false,
  checkpoint = null,
  saveCheckpoint = async () => {},
  maxRows = Number.POSITIVE_INFINITY,
} = {}) {
  if (!database?.fetchNext || !database?.commitManifest) {
    throw new Error('Cloud Sync backfill database adapter is required.');
  }
  if (!objectStore?.head || !objectStore?.put || !objectStore?.delete) {
    throw new Error('Cloud Sync backfill object store adapter is required.');
  }

  const report = createReport();
  let afterId = String(checkpoint?.lastId || '').trim() || null;

  while (report.scanned < maxRows) {
    const row = await database.fetchNext(afterId);
    if (!row) break;

    const hashed = hashLegacyPayload(row.payload_text);
    if (hashed.sizeBytes > 64 * 1024 * 1024) {
      const error = new Error('Legacy snapshot exceeds the 64 MiB limit.');
      error.code = 'LEGACY_PAYLOAD_TOO_LARGE';
      throw error;
    }
    const objectKey = buildBackfillObjectKey(row, hashed.payloadSha256);
    report.scanned += 1;
    report.totalBytes += hashed.sizeBytes;

    if (!dryRun) {
      const existing = await objectStore.head(objectKey);
      let createdByRun = false;
      if (existing) {
        if (Number(existing.sizeBytes) !== hashed.sizeBytes
          || String(existing.payloadSha256 || '').toLowerCase() !== hashed.payloadSha256) {
          const error = new Error('Existing R2 object failed size/checksum verification.');
          error.code = 'R2_HEAD_INTEGRITY_MISMATCH';
          throw error;
        }
        report.reused += 1;
      } else {
        await objectStore.put(objectKey, hashed.bytes, {
          sizeBytes: hashed.sizeBytes,
          payloadSha256: hashed.payloadSha256,
        });
        createdByRun = true;
        try {
          const stored = await objectStore.head(objectKey);
          if (!stored
            || Number(stored.sizeBytes) !== hashed.sizeBytes
            || String(stored.payloadSha256 || '').toLowerCase() !== hashed.payloadSha256) {
            const error = new Error('Uploaded R2 object failed HEAD verification.');
            error.code = 'R2_UPLOAD_INTEGRITY_MISMATCH';
            throw error;
          }
        } catch (error) {
          await objectStore.delete(objectKey);
          throw error;
        }
        report.uploaded += 1;
      }

      let result;
      try {
        result = await database.commitManifest({
          row,
          objectKey,
          sizeBytes: hashed.sizeBytes,
          payloadSha256: hashed.payloadSha256,
        });
      } catch (error) {
        if (createdByRun) await objectStore.delete(objectKey);
        throw error;
      }
      if (result?.status === 'backfilled') report.backfilled += 1;
      else if (result?.status === 'tombstoned') report.tombstoned += 1;
      else if (result?.status === 'newer_manifest') report.newerManifest += 1;
      else if (result?.status === 'pending_upload') report.pendingUpload += 1;
      else {
        if (createdByRun) await objectStore.delete(objectKey);
        const error = new Error('Backfill manifest RPC returned an invalid status.');
        error.code = 'BACKFILL_RESULT_INVALID';
        throw error;
      }

      if (createdByRun && result?.status && result.status !== 'backfilled') {
        await objectStore.delete(objectKey);
      }
    }

    afterId = String(row.id);
    report.lastId = afterId;
    if (!dryRun) {
      await saveCheckpoint({
        version: 1,
        lastId: afterId,
        updatedAt: new Date().toISOString(),
        metrics: { ...report },
      });
    }
  }

  return report;
}
