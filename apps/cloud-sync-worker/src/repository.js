const SUPABASE_TIMEOUT_MS = 20_000;

function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//iu.test(normalized)) {
    const error = new Error('Cloud Sync service is not configured.');
    error.code = 'CONFIGURATION_ERROR';
    error.status = 500;
    throw error;
  }
  return normalized;
}

function mapRpcError(payload, fallbackStatus) {
  const raw = String(payload?.message || payload?.details || payload?.hint || '').toLowerCase();
  const mappings = [
    ['cloud_sync_revision_conflict', 'REVISION_CONFLICT', 409],
    ['cloud_sync_quota_exceeded', 'QUOTA_EXCEEDED', 422],
    ['cloud_sync_pending_limit', 'PENDING_UPLOAD_LIMIT', 429],
    ['cloud_sync_upload_expired', 'UPLOAD_EXPIRED', 410],
    ['cloud_sync_upload_not_found', 'UPLOAD_NOT_FOUND', 404],
    ['cloud_sync_snapshot_not_found', 'SNAPSHOT_NOT_FOUND', 404],
    ['cloud_sync_write_conflict', 'WRITE_CONFLICT', 409],
    ['cloud_sync_invalid', 'INVALID_REQUEST', 422],
  ];
  const match = mappings.find(([needle]) => raw.includes(needle));
  const error = new Error('Cloud Sync database operation failed.');
  error.code = match?.[1] || 'SUPABASE_RPC_FAILED';
  error.status = match?.[2] || (fallbackStatus >= 500 ? 502 : fallbackStatus);
  return error;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createSupabaseCloudSyncRepository(env, { fetchImpl = fetch } = {}) {
  const supabaseUrl = normalizeBaseUrl(env.SUPABASE_URL);
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) {
    const error = new Error('Cloud Sync service is not configured.');
    error.code = 'CONFIGURATION_ERROR';
    error.status = 500;
    throw error;
  }

  async function rpc(name, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (!response.ok) throw mapRpcError(payload, response.status);
      return payload;
    } catch (error) {
      if (error?.code) throw error;
      const wrapped = new Error('Cloud Sync database is temporarily unavailable.');
      wrapped.code = error?.name === 'AbortError' ? 'SUPABASE_TIMEOUT' : 'SUPABASE_UNAVAILABLE';
      wrapped.status = error?.name === 'AbortError' ? 504 : 502;
      throw wrapped;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    listSnapshots(userId, limit = 200) {
      return rpc('cloud_sync_list_snapshots', { p_user_id: userId, p_limit: limit });
    },
    openUpload(userId, input) {
      return rpc('cloud_sync_open_upload', {
        p_user_id: userId,
        p_write_id: input.writeId,
        p_scope: input.scope,
        p_item_slug: input.itemSlug,
        p_item_title: input.itemTitle,
        p_payload_version: input.payloadVersion,
        p_source_updated_at: input.sourceUpdatedAt,
        p_size_bytes: input.sizeBytes,
        p_payload_sha256: input.payloadSha256,
        p_metadata: input.metadata,
        p_expected_revision_id: input.expectedRevisionId,
      });
    },
    getUpload(userId, uploadId) {
      return rpc('cloud_sync_get_upload', { p_user_id: userId, p_upload_id: uploadId });
    },
    commitUpload(userId, uploadId, object) {
      return rpc('cloud_sync_commit_upload', {
        p_user_id: userId,
        p_upload_id: uploadId,
        p_object_key: object.objectKey,
        p_r2_etag: object.etag || null,
        p_r2_version: object.version || null,
      });
    },
    abortUpload(userId, uploadId, objectKey, reasonCode) {
      return rpc('cloud_sync_abort_upload', {
        p_user_id: userId,
        p_upload_id: uploadId,
        p_object_key: objectKey,
        p_reason_code: reasonCode,
      });
    },
    getSnapshot(userId, snapshotId) {
      return rpc('cloud_sync_get_snapshot', { p_user_id: userId, p_snapshot_id: snapshotId });
    },
    deleteSnapshot(userId, snapshotId) {
      return rpc('cloud_sync_delete_snapshot', { p_user_id: userId, p_snapshot_id: snapshotId });
    },
    cleanupExpiredUploads(limit = 50) {
      return rpc('cloud_sync_cleanup_expired_uploads', { p_limit: limit });
    },
    claimGcObjects(limit = 50) {
      return rpc('cloud_sync_claim_gc', { p_limit: limit });
    },
    completeGcObject(gcId) {
      return rpc('cloud_sync_complete_gc', { p_gc_id: gcId });
    },
    failGcObject(gcId, errorCode) {
      return rpc('cloud_sync_fail_gc', { p_gc_id: gcId, p_error_code: errorCode });
    },
  };
}
