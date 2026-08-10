const DEFAULT_METADATA_TIMEOUT_MS = 20_000;
const DEFAULT_TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MANIFEST_CACHE_MS = 3_000;
const MAX_TRANSIENT_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export class CloudSyncApiError extends Error {
  constructor(message, { code = 'CLOUD_SYNC_API_ERROR', status = 0, retryAfter = 0 } = {}) {
    super(message);
    this.name = 'CloudSyncApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isAllowedApiBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function encodeCloudPayload(payloadText) {
  const bytes = new TextEncoder().encode(String(payloadText || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    bytes,
    sizeBytes: bytes.byteLength,
    payloadSha256: bytesToHex(digest),
  };
}

function createTimeoutSignal(timeoutMs, upstreamSignal) {
  const controller = new AbortController();
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true });

  const timeoutId = setTimeout(() => {
    const error = new Error('Cloud Sync request timed out.');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
    },
  };
}

function getRetryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  return [500, 1_500][attempt] || 1_500;
}

async function parseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Preserve a generic public error for non-JSON upstream responses.
  }
  const retryAfter = Number(response.headers.get('Retry-After') || 0);
  return new CloudSyncApiError(
    String(payload?.error?.message || 'Cloud Sync request failed.'),
    {
      code: String(payload?.error?.code || 'CLOUD_SYNC_API_ERROR'),
      status: response.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0,
    },
  );
}

function sanitizeManifest(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id,
    scope: item.scope,
    itemSlug: item.itemSlug,
    itemTitle: item.itemTitle,
    payloadVersion: item.payloadVersion,
    sourceUpdatedAt: item.sourceUpdatedAt,
    sizeBytes: Number(item.sizeBytes || 0),
    metadata: item.metadata || {},
    payloadSha256: item.payloadSha256,
    revisionId: item.revisionId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    storageBackend: 'r2',
  };
}

export function createCloudSyncApiClient({
  baseUrl,
  getAccessToken,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  metadataTimeoutMs = DEFAULT_METADATA_TIMEOUT_MS,
  transferTimeoutMs = DEFAULT_TRANSFER_TIMEOUT_MS,
  manifestCacheMs = DEFAULT_MANIFEST_CACHE_MS,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let manifestCache = null;
  let manifestCacheTokenFingerprint = '';
  let manifestCacheExpiresAt = 0;
  let manifestCacheGeneration = 0;
  const listPromises = new Map();

  if (typeof getAccessToken !== 'function') {
    throw new Error('Cloud Sync access token provider is required.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is not available.');
  }

  function ensureConfigured() {
    if (!isAllowedApiBaseUrl(normalizedBaseUrl)) {
      throw new CloudSyncApiError('Cloud Sync R2 API URL is not configured.', {
        code: 'CLOUD_SYNC_API_NOT_CONFIGURED',
      });
    }
  }

  function invalidateManifestCache() {
    manifestCacheGeneration += 1;
    manifestCache = null;
    manifestCacheTokenFingerprint = '';
    manifestCacheExpiresAt = 0;
  }

  async function request(path, init = {}, {
    timeoutMs = metadataTimeoutMs,
    parse = 'json',
    retry = true,
  } = {}) {
    ensureConfigured();
    let refreshNext = false;
    let didRefresh = false;
    let transientAttempts = 0;

    while (true) {
      const accessToken = await getAccessToken({ refresh: refreshNext });
      refreshNext = false;
      if (!accessToken) {
        throw new CloudSyncApiError('Bạn cần đăng nhập trước khi dùng Cloud Sync.', {
          code: 'UNAUTHORIZED',
          status: 401,
        });
      }

      const timeout = createTimeoutSignal(timeoutMs, init.signal);
      try {
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${accessToken}`);
        const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
          ...init,
          headers,
          signal: timeout.signal,
        });

        if (response.status === 401 && !didRefresh) {
          didRefresh = true;
          refreshNext = true;
          timeout.dispose();
          continue;
        }
        if (retry && RETRYABLE_STATUSES.has(response.status) && transientAttempts < MAX_TRANSIENT_RETRIES) {
          const retryDelay = getRetryDelay(response, transientAttempts);
          transientAttempts += 1;
          timeout.dispose();
          await sleep(retryDelay);
          continue;
        }
        if (!response.ok) throw await parseError(response);
        if (response.status === 204) {
          timeout.dispose();
          return null;
        }

        const payload = parse === 'bytes'
          ? new Uint8Array(await response.arrayBuffer())
          : await response.json();
        timeout.dispose();
        if (parse === 'bytes') return payload;
        return parse === 'json-full' ? payload : payload?.data;
      } catch (error) {
        timeout.dispose();
        if (error instanceof CloudSyncApiError) throw error;
        if (init.signal?.aborted) throw error;
        if (retry && transientAttempts < MAX_TRANSIENT_RETRIES) {
          await sleep([500, 1_500][transientAttempts]);
          transientAttempts += 1;
          continue;
        }
        const timeoutReason = timeout.signal.aborted ? timeout.signal.reason : null;
        throw new CloudSyncApiError(
          error?.name === 'AbortError'
            || error?.name === 'TimeoutError'
            || timeoutReason?.name === 'TimeoutError'
            ? 'Cloud Sync request timed out.'
            : 'Cloud Sync network request failed.',
          { code: 'CLOUD_SYNC_NETWORK_ERROR' },
        );
      }
    }
  }

  async function listSnapshotState({ force = false } = {}) {
    const currentToken = await getAccessToken({ refresh: false });
    const tokenFingerprint = currentToken
      ? bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(currentToken)))
      : '';
    const now = Date.now();
    if (!force
      && manifestCache
      && manifestCacheTokenFingerprint === tokenFingerprint
      && now < manifestCacheExpiresAt) return manifestCache;
    const inFlight = listPromises.get(tokenFingerprint);
    if (inFlight?.generation === manifestCacheGeneration) return inFlight.promise;

    const requestGeneration = manifestCacheGeneration;
    const promise = request('/cloud-sync/v1/snapshots', {}, { parse: 'json-full' })
      .then((payload) => {
        const nextState = {
          items: (Array.isArray(payload?.data) ? payload.data : []).map(sanitizeManifest).filter(Boolean),
          tombstones: (Array.isArray(payload?.tombstones) ? payload.tombstones : []).map((item) => ({
            scope: String(item?.scope || ''),
            itemSlug: String(item?.itemSlug || ''),
            deletedAt: item?.deletedAt || null,
          })),
          legacyItems: (Array.isArray(payload?.legacyItems) ? payload.legacyItems : [])
            .map(sanitizeManifest)
            .filter(Boolean)
            .map((item) => ({ ...item, storageBackend: 'legacy' })),
        };
        if (manifestCacheGeneration === requestGeneration) {
          manifestCache = nextState;
          manifestCacheTokenFingerprint = tokenFingerprint;
          manifestCacheExpiresAt = Date.now() + manifestCacheMs;
        }
        return nextState;
      })
      .finally(() => {
        if (listPromises.get(tokenFingerprint)?.promise === promise) {
          listPromises.delete(tokenFingerprint);
        }
      });
    listPromises.set(tokenFingerprint, { generation: requestGeneration, promise });
    return promise;
  }

  async function listSnapshots(options) {
    const state = await listSnapshotState(options);
    return state.items;
  }

  async function uploadSnapshot(input) {
    const encoded = await encodeCloudPayload(input.payloadText);
    const openBody = {
      writeId: input.writeId,
      scope: input.scope,
      itemSlug: input.itemSlug,
      itemTitle: input.itemTitle,
      payloadVersion: input.payloadVersion ?? 1,
      sourceUpdatedAt: input.sourceUpdatedAt ?? Date.now(),
      sizeBytes: encoded.sizeBytes,
      payloadSha256: encoded.payloadSha256,
      metadata: input.metadata || {},
      expectedRevisionId: input.expectedRevisionId || null,
    };
    const opened = await request('/cloud-sync/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openBody),
      signal: input.signal,
    });

    if (opened?.uploadRequired !== true) {
      const unchanged = sanitizeManifest(opened?.manifest);
      if (!unchanged?.id || !unchanged?.revisionId) {
        throw new CloudSyncApiError('Cloud Sync returned an invalid upload result.', {
          code: 'INVALID_UPLOAD_RESULT',
        });
      }
      invalidateManifestCache();
      return unchanged;
    }

    const committed = await request(`/cloud-sync/v1/uploads/${encodeURIComponent(opened.uploadId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encoded.bytes,
      signal: input.signal,
    }, { timeoutMs: transferTimeoutMs });
    invalidateManifestCache();
    const manifest = sanitizeManifest(committed);
    if (!manifest?.id || !manifest?.revisionId) {
      throw new CloudSyncApiError('Cloud Sync returned an invalid upload result.', {
        code: 'INVALID_UPLOAD_RESULT',
      });
    }
    return manifest;
  }

  async function downloadSnapshot(snapshot, { signal } = {}) {
    const id = typeof snapshot === 'string' ? snapshot : snapshot?.id;
    const expectedSha256 = typeof snapshot === 'object' ? snapshot?.payloadSha256 : '';
    const bytes = await request(
      `/cloud-sync/v1/snapshots/${encodeURIComponent(id)}/content`,
      { method: 'GET', signal },
      { timeoutMs: transferTimeoutMs, parse: 'bytes' },
    );
    const expectedSize = typeof snapshot === 'object' ? Number(snapshot?.sizeBytes) : Number.NaN;
    if (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && bytes.byteLength !== expectedSize) {
      throw new CloudSyncApiError('Cloud Sync download size does not match.', {
        code: 'CLOUD_SYNC_SIZE_MISMATCH',
        status: 502,
      });
    }
    if (expectedSha256) {
      const digest = bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
      if (digest !== expectedSha256) {
        throw new CloudSyncApiError('Cloud Sync download checksum does not match.', {
          code: 'CLOUD_SYNC_CHECKSUM_MISMATCH',
          status: 502,
        });
      }
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  async function deleteSnapshot(snapshotId, { signal } = {}) {
    await request(`/cloud-sync/v1/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
      signal,
    });
    invalidateManifestCache();
  }

  return {
    timeouts: Object.freeze({ metadataMs: metadataTimeoutMs, transferMs: transferTimeoutMs }),
    listSnapshotState,
    listSnapshots,
    uploadSnapshot,
    downloadSnapshot,
    deleteSnapshot,
    clearManifestCache() {
      invalidateManifestCache();
      listPromises.clear();
    },
  };
}

export const CLOUD_SYNC_API_TIMEOUTS = Object.freeze({
  metadataMs: DEFAULT_METADATA_TIMEOUT_MS,
  transferMs: DEFAULT_TRANSFER_TIMEOUT_MS,
});
