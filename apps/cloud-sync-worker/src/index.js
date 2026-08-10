import { authenticateRequest } from './auth.js';
import { createSupabaseCloudSyncRepository } from './repository.js';

export const CLOUD_SYNC_LIMITS = Object.freeze({
  snapshotBytes: 64 * 1024 * 1024,
  metadataBytes: 64 * 1024,
  slugCharacters: 256,
  titleCharacters: 256,
  listItems: 200,
});

const API_PREFIX = '/cloud-sync/v1';
const RETRY_AFTER_SECONDS = 60;
const OPEN_UPLOAD_REQUEST_BYTES = 96 * 1024;
const PUBLIC_ERROR_MESSAGES = Object.freeze({
  REVISION_CONFLICT: 'The cloud snapshot changed. Refresh before uploading again.',
  QUOTA_EXCEEDED: 'Cloud Sync quota is limited to 200 snapshots and 256 MiB.',
  PENDING_UPLOAD_LIMIT: 'Too many uploads are already pending.',
  UPLOAD_EXPIRED: 'The upload reservation expired.',
  UPLOAD_NOT_FOUND: 'Upload was not found.',
  SNAPSHOT_NOT_FOUND: 'Snapshot was not found.',
  WRITE_CONFLICT: 'Another upload is already changing this snapshot.',
});
const PUBLIC_MANIFEST_FIELDS = Object.freeze([
  'id',
  'scope',
  'itemSlug',
  'itemTitle',
  'payloadVersion',
  'sourceUpdatedAt',
  'sizeBytes',
  'metadata',
  'payloadSha256',
  'revisionId',
  'createdAt',
  'updatedAt',
]);

class CloudSyncError extends Error {
  constructor(code, status, publicMessage) {
    super(publicMessage);
    this.name = 'CloudSyncError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function validationError(code, message) {
  return new CloudSyncError(code, 422, message);
}

function countCharacters(value) {
  return Array.from(String(value || '')).length;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(String(value || ''));
}

function normalizeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, code, field }) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw validationError(code, `${field} is invalid.`);
  }
  return number;
}

export function validateUploadRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('INVALID_UPLOAD_REQUEST', 'Upload request is invalid.');
  }

  const writeId = String(input.writeId || '').trim().toLowerCase();
  const scope = String(input.scope || '').trim();
  const itemSlug = String(input.itemSlug || '').trim();
  const itemTitle = String(input.itemTitle || itemSlug).trim() || itemSlug;
  const payloadSha256 = String(input.payloadSha256 || '').trim().toLowerCase();
  const expectedRevisionId = input.expectedRevisionId == null || input.expectedRevisionId === ''
    ? null
    : String(input.expectedRevisionId).trim().toLowerCase();

  if (!isUuid(writeId)) throw validationError('INVALID_WRITE_ID', 'writeId is invalid.');
  if (!['project', 'chat', 'prompt_bundle'].includes(scope)) {
    throw validationError('INVALID_SCOPE', 'Snapshot scope is invalid.');
  }
  if (!itemSlug || countCharacters(itemSlug) > CLOUD_SYNC_LIMITS.slugCharacters) {
    throw validationError('INVALID_ITEM_SLUG', 'Snapshot slug is invalid.');
  }
  if (countCharacters(itemTitle) > CLOUD_SYNC_LIMITS.titleCharacters) {
    throw validationError('INVALID_ITEM_TITLE', 'Snapshot title is invalid.');
  }
  if (!/^[0-9a-f]{64}$/u.test(payloadSha256)) {
    throw validationError('INVALID_PAYLOAD_SHA256', 'Payload SHA-256 is invalid.');
  }
  if (expectedRevisionId && !isUuid(expectedRevisionId)) {
    throw validationError('INVALID_EXPECTED_REVISION', 'Expected revision is invalid.');
  }

  let metadataText;
  try {
    metadataText = JSON.stringify(input.metadata ?? {});
  } catch {
    throw validationError('INVALID_METADATA', 'Snapshot metadata is invalid.');
  }
  if (byteLength(metadataText) > CLOUD_SYNC_LIMITS.metadataBytes) {
    throw validationError('METADATA_TOO_LARGE', 'Snapshot metadata exceeds 64 KiB.');
  }

  const sizeBytes = normalizeInteger(input.sizeBytes, {
    min: 0,
    max: CLOUD_SYNC_LIMITS.snapshotBytes,
    code: Number(input.sizeBytes) > CLOUD_SYNC_LIMITS.snapshotBytes ? 'PAYLOAD_TOO_LARGE' : 'INVALID_SIZE',
    field: 'sizeBytes',
  });
  const payloadVersion = normalizeInteger(input.payloadVersion ?? 1, {
    min: 1,
    max: 2_147_483_647,
    code: 'INVALID_PAYLOAD_VERSION',
    field: 'payloadVersion',
  });
  const sourceUpdatedAt = normalizeInteger(input.sourceUpdatedAt ?? 0, {
    min: 0,
    code: 'INVALID_SOURCE_UPDATED_AT',
    field: 'sourceUpdatedAt',
  });

  return {
    writeId,
    scope,
    itemSlug,
    itemTitle,
    payloadVersion,
    sourceUpdatedAt,
    sizeBytes,
    payloadSha256,
    metadata: input.metadata ?? {},
    expectedRevisionId,
  };
}

export function buildCloudSnapshotObjectKey({ userId, scope, snapshotId, payloadSha256 }) {
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  const normalizedSnapshotId = String(snapshotId || '').trim().toLowerCase();
  const normalizedScope = String(scope || '').trim();
  const normalizedSha = String(payloadSha256 || '').trim().toLowerCase();
  if (!isUuid(normalizedUserId) || !isUuid(normalizedSnapshotId)) {
    throw new CloudSyncError('INVALID_OBJECT_IDENTITY', 500, 'Cloud Sync storage metadata is invalid.');
  }
  if (!['project', 'chat', 'prompt_bundle'].includes(normalizedScope) || !/^[0-9a-f]{64}$/u.test(normalizedSha)) {
    throw new CloudSyncError('INVALID_OBJECT_IDENTITY', 500, 'Cloud Sync storage metadata is invalid.');
  }
  return `users/${normalizedUserId}/snapshots/${normalizedScope}/${normalizedSnapshotId}/${normalizedSha}.json`;
}

function sanitizeManifest(item) {
  if (!item || typeof item !== 'object') return null;
  return PUBLIC_MANIFEST_FIELDS.reduce((result, field) => {
    if (Object.hasOwn(item, field)) result[field] = item[field];
    return result;
  }, {});
}

function parseAllowedOrigins(value) {
  const origins = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    throw new CloudSyncError('INVALID_CORS_CONFIGURATION', 500, 'Cloud Sync service is not configured.');
  }
  return new Set(origins);
}

function resolveCors(request, env) {
  const allowedOrigins = parseAllowedOrigins(env.CLOUD_SYNC_ALLOWED_ORIGINS);
  const origin = String(request.headers.get('Origin') || '').trim();
  if (origin && !allowedOrigins.has(origin)) {
    throw new CloudSyncError('ORIGIN_NOT_ALLOWED', 403, 'Origin is not allowed.');
  }
  return origin;
}

function securityHeaders(origin, requestId) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Request-Id': requestId,
    Vary: 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function jsonResponse(payload, status, origin, requestId, extraHeaders = {}) {
  const headers = securityHeaders(origin, requestId);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  Object.entries(extraHeaders).forEach(([name, value]) => headers.set(name, String(value)));
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(error, origin, requestId) {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const code = safeStatus >= 500
    ? (error?.code === 'CONFIGURATION_ERROR' ? 'SERVICE_CONFIGURATION_ERROR' : 'INTERNAL_ERROR')
    : String(error?.code || 'REQUEST_FAILED');
  const message = safeStatus >= 500
    ? 'Cloud Sync is temporarily unavailable.'
    : String(error?.publicMessage || PUBLIC_ERROR_MESSAGES[code] || error?.message || 'Cloud Sync request failed.');
  const headers = safeStatus === 429 ? { 'Retry-After': RETRY_AFTER_SECONDS } : {};
  return jsonResponse({
    error: { code, message, requestId },
  }, safeStatus, origin, requestId, headers);
}

function logFailure({ requestId, route, status, startedAt, code }) {
  console.error(JSON.stringify({
    requestId,
    route,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    errorCode: code || 'INTERNAL_ERROR',
  }));
}

async function parseJsonBody(request) {
  const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new CloudSyncError('UNSUPPORTED_MEDIA_TYPE', 415, 'Content-Type must be application/json.');
  }
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > OPEN_UPLOAD_REQUEST_BYTES) {
    throw new CloudSyncError('REQUEST_BODY_TOO_LARGE', 413, 'Upload request metadata is too large.');
  }
  if (!request.body) {
    throw new CloudSyncError('INVALID_JSON', 400, 'Request body is not valid JSON.');
  }
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > OPEN_UPLOAD_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already being rejected; cancellation is best effort.
        }
        throw new CloudSyncError('REQUEST_BODY_TOO_LARGE', 413, 'Upload request metadata is too large.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof CloudSyncError) throw error;
    throw new CloudSyncError('INVALID_JSON', 400, 'Request body is not valid JSON.');
  }
}

function checksumToHex(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value instanceof ArrayBuffer) {
    return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  if (ArrayBuffer.isView(value)) {
    return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

function sha256HexToArrayBuffer(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new CloudSyncError('INVALID_UPLOAD_STATE', 500, 'Cloud Sync upload metadata is invalid.');
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, (index * 2) + 2), 16);
  }
  return bytes.buffer;
}

function readObjectSha256(object) {
  const direct = checksumToHex(object?.checksums?.sha256);
  if (direct) return direct;
  const serialized = object?.checksums?.toJSON?.();
  const serializedSha256 = checksumToHex(serialized?.sha256);
  if (serializedSha256) return serializedSha256;
  return checksumToHex(
    object?.customMetadata?.payloadSha256
      || object?.customMetadata?.['payload-sha256'],
  );
}

function readR2ErrorCode(error) {
  const match = String(error?.message || '').match(/\((\d{4,6})\)\s*$/u);
  return match?.[1] || 'UNKNOWN';
}

function createCountingStream(body, declaredSize) {
  const source = body || (declaredSize === 0
    ? new ReadableStream({ start(controller) { controller.close(); } })
    : null);
  if (!source) throw new CloudSyncError('PAYLOAD_REQUIRED', 400, 'Upload body is required.');
  let count = 0;
  let overflow = false;
  let invalidUtf8 = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let stream = source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const size = Number(chunk?.byteLength ?? chunk?.length ?? 0);
      count += size;
      if (count > declaredSize || count > CLOUD_SYNC_LIMITS.snapshotBytes) {
        overflow = true;
        throw validationError('PAYLOAD_SIZE_MISMATCH', 'Uploaded payload size does not match the reservation.');
      }
      try {
        const bytes = chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(chunk.buffer || chunk, chunk.byteOffset || 0, size);
        decoder.decode(bytes, { stream: true });
      } catch {
        invalidUtf8 = true;
        throw validationError('PAYLOAD_UTF8_INVALID', 'Uploaded payload is not valid UTF-8.');
      }
      controller.enqueue(chunk);
    },
    flush() {
      try {
        decoder.decode();
      } catch {
        invalidUtf8 = true;
        throw validationError('PAYLOAD_UTF8_INVALID', 'Uploaded payload is not valid UTF-8.');
      }
    },
  }));
  if (typeof globalThis.FixedLengthStream === 'function') {
    stream = stream.pipeThrough(new globalThis.FixedLengthStream(declaredSize));
  }
  return {
    stream,
    getCount: () => count,
    didOverflow: () => overflow,
    hasInvalidUtf8: () => invalidUtf8,
  };
}

async function checkRateLimit(binding, key) {
  if (!binding?.limit) return;
  const result = await binding.limit({ key: String(key || 'unknown') });
  if (result?.success === false) {
    throw new CloudSyncError('RATE_LIMITED', 429, 'Too many Cloud Sync requests.');
  }
}

function getClientIp(request) {
  return String(request.headers.get('CF-Connecting-IP') || 'unknown').trim() || 'unknown';
}

function isUploadRoute(method, pathname) {
  return (method === 'POST' && pathname === `${API_PREFIX}/uploads`)
    || (method === 'PUT' && /^\/cloud-sync\/v1\/uploads\/[^/]+$/u.test(pathname))
    || (method === 'DELETE' && /^\/cloud-sync\/v1\/snapshots\/[^/]+$/u.test(pathname));
}

function isReadRoute(method, pathname) {
  return method === 'GET' && (
    pathname === `${API_PREFIX}/snapshots`
    || /^\/cloud-sync\/v1\/snapshots\/[^/]+\/content$/u.test(pathname)
  );
}

function routeLabel(method, pathname) {
  if (method === 'GET' && pathname === `${API_PREFIX}/health`) return 'GET /health';
  if (method === 'GET' && pathname === `${API_PREFIX}/snapshots`) return 'GET /snapshots';
  if (method === 'POST' && pathname === `${API_PREFIX}/uploads`) return 'POST /uploads';
  if (method === 'PUT' && /^\/cloud-sync\/v1\/uploads\/[^/]+$/u.test(pathname)) return 'PUT /uploads/:id';
  if (method === 'GET' && /^\/cloud-sync\/v1\/snapshots\/[^/]+\/content$/u.test(pathname)) {
    return 'GET /snapshots/:id/content';
  }
  if (method === 'DELETE' && /^\/cloud-sync\/v1\/snapshots\/[^/]+$/u.test(pathname)) {
    return 'DELETE /snapshots/:id';
  }
  return `${method} /unknown`;
}

async function enforceUserRateLimit(request, env, userId, pathname) {
  if (isUploadRoute(request.method, pathname)) {
    await checkRateLimit(env.CLOUD_SYNC_UPLOAD_RATE_LIMITER, userId);
  } else if (isReadRoute(request.method, pathname)) {
    await checkRateLimit(env.CLOUD_SYNC_READ_RATE_LIMITER, userId);
  }
}

function readDeploymentMode(env) {
  const mode = String(env.CLOUD_SYNC_MODE || '').trim();
  if (!['active', 'test-only', 'read-only'].includes(mode)) {
    throw new CloudSyncError('CONFIGURATION_ERROR', 500, 'Cloud Sync service is not configured.');
  }
  return mode;
}

function enforceDeploymentMode(mode, env, userId) {
  if (mode !== 'test-only') return;
  const allowedUserIds = new Set(String(env.CLOUD_SYNC_TEST_USER_IDS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(isUuid));
  if (!allowedUserIds.has(String(userId || '').toLowerCase())) {
    throw new CloudSyncError('TEST_ONLY', 403, 'Cloud Sync R2 is not enabled for this account.');
  }
}

function assertUuidPath(value, code = 'INVALID_ID') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!isUuid(normalized)) throw validationError(code, 'Resource id is invalid.');
  return normalized;
}

async function safelyAbortUpload(repository, bucket, userId, uploadId, objectKey, reasonCode) {
  try {
    const result = await repository.abortUpload(userId, uploadId, objectKey, reasonCode);
    if (result?.deleteObject === true) await bucket.delete(objectKey);
  } catch {
    // The database cleanup cron owns ambiguous objects; never delete without its confirmation.
  }
}

async function handleUploadBody({ request, env, repository, user, uploadId, origin, requestId }) {
  const upload = await repository.getUpload(user.id, uploadId);
  if (!upload) throw new CloudSyncError('UPLOAD_NOT_FOUND', 404, 'Upload was not found.');
  if (upload.status === 'committed' && upload.manifest) {
    return jsonResponse({ data: sanitizeManifest(upload.manifest) }, 200, origin, requestId);
  }
  if (upload.status !== 'pending') {
    throw new CloudSyncError('UPLOAD_NOT_AVAILABLE', 409, 'Upload is not available.');
  }

  const expectedSize = Number(upload.sizeBytes);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > CLOUD_SYNC_LIMITS.snapshotBytes) {
    throw new CloudSyncError('INVALID_UPLOAD_STATE', 500, 'Cloud Sync upload metadata is invalid.');
  }
  const contentLength = request.headers.get('Content-Length');
  if (contentLength != null && Number(contentLength) !== expectedSize) {
    throw validationError('PAYLOAD_SIZE_MISMATCH', 'Uploaded payload size does not match the reservation.');
  }

  const objectKey = buildCloudSnapshotObjectKey({
    userId: user.id,
    scope: upload.scope,
    snapshotId: upload.snapshotId,
    payloadSha256: upload.payloadSha256,
  });
  const counted = createCountingStream(request.body, expectedSize);
  let object;
  try {
    object = await env.CLOUD_SYNC_BUCKET.put(objectKey, counted.stream, {
      sha256: sha256HexToArrayBuffer(upload.payloadSha256),
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { payloadSha256: upload.payloadSha256 },
    });
  } catch (error) {
    if (error instanceof CloudSyncError
      || counted.didOverflow()
      || counted.hasInvalidUtf8()) {
      await safelyAbortUpload(repository, env.CLOUD_SYNC_BUCKET, user.id, uploadId, objectKey, 'PAYLOAD_STREAM_INVALID');
      if (error instanceof CloudSyncError) throw error;
      throw validationError(
        counted.hasInvalidUtf8() ? 'PAYLOAD_UTF8_INVALID' : 'PAYLOAD_SIZE_MISMATCH',
        counted.hasInvalidUtf8()
          ? 'Uploaded payload is not valid UTF-8.'
          : 'Uploaded payload size does not match the reservation.',
      );
    }
    const r2ErrorCode = readR2ErrorCode(error);
    if (r2ErrorCode === '10013') {
      await safelyAbortUpload(repository, env.CLOUD_SYNC_BUCKET, user.id, uploadId, objectKey, 'PAYLOAD_SIZE_MISMATCH');
      throw validationError('PAYLOAD_SIZE_MISMATCH', 'Uploaded payload size does not match the reservation.');
    }
    // Keep an ambiguous R2 failure pending so the same uploadId can retry.
    // Expiry cleanup will HEAD/delete the deterministic key if the Worker died
    // after R2 accepted the object but before it returned a response.
    throw new CloudSyncError(`R2_PUT_${r2ErrorCode}`, 502, 'Cloud Sync storage is temporarily unavailable.');
  }

  const storedSize = Number(object?.size ?? counted.getCount());
  const storedSha256 = readObjectSha256(object);
  if (counted.getCount() !== expectedSize) {
    await safelyAbortUpload(repository, env.CLOUD_SYNC_BUCKET, user.id, uploadId, objectKey, 'PAYLOAD_SIZE_MISMATCH');
    throw validationError('PAYLOAD_SIZE_MISMATCH', 'Uploaded payload size does not match the reservation.');
  }
  if (storedSize !== expectedSize || storedSha256 !== upload.payloadSha256) {
    await safelyAbortUpload(repository, env.CLOUD_SYNC_BUCKET, user.id, uploadId, objectKey, 'R2_INTEGRITY_MISMATCH');
    throw new CloudSyncError('R2_INTEGRITY_MISMATCH', 502, 'Cloud Sync storage verification failed.');
  }

  try {
    const committed = await repository.commitUpload(user.id, uploadId, {
      objectKey,
      etag: object?.etag || null,
      version: object?.version || null,
    });
    return jsonResponse({ data: sanitizeManifest(committed) }, 200, origin, requestId);
  } catch (error) {
    if (Number(error?.status || 500) < 500) {
      await safelyAbortUpload(repository, env.CLOUD_SYNC_BUCKET, user.id, uploadId, objectKey, 'COMMIT_REJECTED');
    }
    throw error;
  }
}

async function handleDownload({ env, repository, user, snapshotId, origin, requestId }) {
  const snapshot = await repository.getSnapshot(user.id, snapshotId);
  if (!snapshot) throw new CloudSyncError('SNAPSHOT_NOT_FOUND', 404, 'Snapshot was not found.');
  const expectedKey = buildCloudSnapshotObjectKey({
    userId: user.id,
    scope: snapshot.scope,
    snapshotId: snapshot.id,
    payloadSha256: snapshot.payloadSha256,
  });
  if (snapshot.objectKey !== expectedKey) {
    throw new CloudSyncError('OBJECT_METADATA_MISMATCH', 502, 'Cloud Sync storage verification failed.');
  }

  const object = await env.CLOUD_SYNC_BUCKET.get(expectedKey);
  const actualSize = Number(object?.size ?? -1);
  const actualSha256 = readObjectSha256(object);
  if (!object?.body || actualSize !== Number(snapshot.sizeBytes) || actualSha256 !== snapshot.payloadSha256) {
    throw new CloudSyncError('OBJECT_INTEGRITY_MISMATCH', 502, 'Cloud Sync storage verification failed.');
  }

  const headers = securityHeaders(origin, requestId);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Content-Length', String(actualSize));
  headers.set('X-Payload-Sha256', snapshot.payloadSha256);
  return new Response(object.body, { status: 200, headers });
}

async function processGcBatch(repository, bucket, limit = 50) {
  const items = await repository.claimGcObjects(limit);
  let deleted = 0;
  for (const item of Array.isArray(items) ? items : []) {
    try {
      await bucket.delete(item.objectKey);
      await repository.completeGcObject(item.id);
      deleted += 1;
    } catch {
      await repository.failGcObject(item.id, 'R2_DELETE_FAILED');
    }
  }
  return deleted;
}

export function createCloudSyncWorker({
  authenticate = authenticateRequest,
  createRepository = (env) => createSupabaseCloudSyncRepository(env),
  createRequestId = () => crypto.randomUUID(),
} = {}) {
  return {
    async fetch(request, env) {
      const startedAt = Date.now();
      const requestId = createRequestId();
      const url = new URL(request.url);
      const route = routeLabel(request.method, url.pathname);
      let origin = '';

      try {
        origin = resolveCors(request, env);
        const mode = readDeploymentMode(env);
        await checkRateLimit(env.CLOUD_SYNC_UNAUTH_RATE_LIMITER, getClientIp(request));

        if (request.method === 'OPTIONS') {
          const headers = securityHeaders(origin, requestId);
          headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Length');
          headers.set('Access-Control-Max-Age', '600');
          return new Response(null, { status: 204, headers });
        }

        if (request.method === 'GET' && url.pathname === `${API_PREFIX}/health`) {
          return jsonResponse({
            data: {
              service: 'storyforge-cloud-sync',
              version: '1',
              mode,
            },
          }, 200, origin, requestId);
        }

        if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
          throw new CloudSyncError('NOT_FOUND', 404, 'Route was not found.');
        }

        const user = await authenticate(request, env);
        enforceDeploymentMode(mode, env, user.id);
        await enforceUserRateLimit(request, env, user.id, url.pathname);
        const repository = createRepository(env);

        if (request.method === 'GET' && url.pathname === `${API_PREFIX}/snapshots`) {
          const result = await repository.listSnapshots(user.id, CLOUD_SYNC_LIMITS.listItems);
          const items = Array.isArray(result) ? result : result?.items;
          const tombstones = Array.isArray(result?.tombstones)
            ? result.tombstones.slice(0, CLOUD_SYNC_LIMITS.listItems).map((item) => ({
              scope: String(item?.scope || ''),
              itemSlug: String(item?.itemSlug || ''),
              deletedAt: item?.deletedAt || null,
            }))
            : [];
          const data = (Array.isArray(items) ? items : [])
            .slice(0, CLOUD_SYNC_LIMITS.listItems)
            .map(sanitizeManifest)
            .filter(Boolean);
          const legacyItems = (Array.isArray(result?.legacyItems) ? result.legacyItems : [])
            .slice(0, Math.max(0, CLOUD_SYNC_LIMITS.listItems - data.length))
            .map(sanitizeManifest)
            .filter(Boolean);
          return jsonResponse({ data, tombstones, legacyItems }, 200, origin, requestId);
        }

        if (request.method === 'POST' && url.pathname === `${API_PREFIX}/uploads`) {
          if (mode === 'read-only') {
            throw new CloudSyncError('READ_ONLY', 503, 'Cloud Sync uploads are temporarily paused.');
          }
          const input = validateUploadRequest(await parseJsonBody(request));
          const opened = await repository.openUpload(user.id, input);
          const data = {
            uploadId: opened?.uploadId || null,
            snapshotId: opened?.snapshotId || opened?.manifest?.id || null,
            uploadRequired: opened?.uploadRequired === true,
            expiresAt: opened?.expiresAt || null,
          };
          if (opened?.manifest) data.manifest = sanitizeManifest(opened.manifest);
          return jsonResponse({ data }, opened?.uploadRequired === true ? 201 : 200, origin, requestId);
        }

        const uploadMatch = url.pathname.match(/^\/cloud-sync\/v1\/uploads\/([^/]+)$/u);
        if (request.method === 'PUT' && uploadMatch) {
          if (mode === 'read-only') {
            throw new CloudSyncError('READ_ONLY', 503, 'Cloud Sync uploads are temporarily paused.');
          }
          const uploadId = assertUuidPath(uploadMatch[1], 'INVALID_UPLOAD_ID');
          return await handleUploadBody({
            request,
            env,
            repository,
            user,
            uploadId,
            origin,
            requestId,
          });
        }

        const contentMatch = url.pathname.match(/^\/cloud-sync\/v1\/snapshots\/([^/]+)\/content$/u);
        if (request.method === 'GET' && contentMatch) {
          const snapshotId = assertUuidPath(contentMatch[1], 'INVALID_SNAPSHOT_ID');
          return await handleDownload({ env, repository, user, snapshotId, origin, requestId });
        }

        const deleteMatch = url.pathname.match(/^\/cloud-sync\/v1\/snapshots\/([^/]+)$/u);
        if (request.method === 'DELETE' && deleteMatch) {
          if (mode === 'read-only') {
            throw new CloudSyncError('READ_ONLY', 503, 'Cloud Sync changes are temporarily paused.');
          }
          const snapshotId = assertUuidPath(deleteMatch[1], 'INVALID_SNAPSHOT_ID');
          await repository.deleteSnapshot(user.id, snapshotId);
          return new Response(null, { status: 204, headers: securityHeaders(origin, requestId) });
        }

        throw new CloudSyncError('NOT_FOUND', 404, 'Route was not found.');
      } catch (error) {
        const response = errorResponse(error, origin, requestId);
        if (response.status >= 500) {
          logFailure({
            requestId,
            route,
            status: response.status,
            startedAt,
            code: error?.code,
          });
        }
        return response;
      }
    },

    async scheduled(_event, env, ctx) {
      const task = (async () => {
        const repository = createRepository(env);
        await repository.cleanupExpiredUploads(50);
        await processGcBatch(repository, env.CLOUD_SYNC_BUCKET, 50);
      })();
      if (ctx?.waitUntil) ctx.waitUntil(task);
      else await task;
    },
  };
}

const worker = createCloudSyncWorker();

export default worker;
