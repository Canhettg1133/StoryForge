import { getCloudAccessToken, getSession } from './cloudAuthService.js';
import { createCloudSyncApiClient, encodeCloudPayload } from './cloudR2ApiClient.js';
import { getSupabaseClient } from './supabaseClient.js';

const CLOUD_SYNC_API_URL = String(import.meta.env.VITE_CLOUD_SYNC_API_URL || '').trim().replace(/\/+$/, '');
const CONFIGURED_STORAGE_MODE = String(import.meta.env.VITE_CLOUD_SYNC_STORAGE_MODE || '').trim().toLowerCase();
const LEGACY_CACHE_MS = 3_000;
const EXPORT_IN_FLIGHT_BYTES = 32 * 1024 * 1024;

let apiClient = null;
const legacyListPromises = new Map();
let legacyCache = null;
let legacyCacheUserId = '';
let legacyCacheExpiresAt = 0;

export function getCloudSnapshotStorageMode() {
  if (!CLOUD_SYNC_API_URL) {
    if (['hybrid', 'r2-only'].includes(CONFIGURED_STORAGE_MODE)) {
      const error = new Error('Cloud Sync R2 API URL is missing for the configured storage mode.');
      error.code = 'CLOUD_SYNC_API_NOT_CONFIGURED';
      throw error;
    }
    return 'legacy';
  }
  return CONFIGURED_STORAGE_MODE === 'r2-only' ? 'r2-only' : 'hybrid';
}

function getApiClient() {
  if (!apiClient) {
    apiClient = createCloudSyncApiClient({
      baseUrl: CLOUD_SYNC_API_URL,
      getAccessToken: getCloudAccessToken,
    });
  }
  return apiClient;
}

function mapLegacySnapshot(row, includePayload = false) {
  const item = {
    id: row.id,
    scope: row.scope,
    itemSlug: row.item_slug,
    itemTitle: row.item_title,
    payloadVersion: row.payload_version,
    sourceUpdatedAt: row.source_updated_at,
    sizeBytes: Number(row.size_bytes || 0),
    metadata: row.metadata || {},
    payloadSha256: null,
    revisionId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storageBackend: 'legacy',
  };
  if (includePayload) item.payloadText = row.payload_text;
  return item;
}

async function requireUser() {
  const session = await getSession();
  const user = session?.user || null;
  if (!user?.id) throw new Error('Bạn cần đăng nhập Google trước khi dùng Cloud Sync.');
  return user;
}

function clearCaches() {
  legacyCache = null;
  legacyCacheExpiresAt = 0;
  getApiClientSafe()?.clearManifestCache();
}

function getApiClientSafe() {
  return CLOUD_SYNC_API_URL ? getApiClient() : null;
}

async function listLegacyMetadata({ force = false } = {}) {
  const user = await requireUser();
  const now = Date.now();
  if (!force && legacyCache && legacyCacheUserId === user.id && now < legacyCacheExpiresAt) {
    return legacyCache;
  }
  if (legacyListPromises.has(user.id)) return legacyListPromises.get(user.id);

  const promise = (async () => {
    const { data, error } = await getSupabaseClient()
      .from('cloud_snapshots')
      .select(`
        id,
        scope,
        item_slug,
        item_title,
        payload_version,
        source_updated_at,
        size_bytes,
        metadata,
        created_at,
        updated_at
      `)
      .eq('user_id', user.id)
      .order('scope', { ascending: true })
      .order('updated_at', { ascending: false });
    if (error) throw error;
    legacyCache = (Array.isArray(data) ? data : []).map((row) => mapLegacySnapshot(row));
    legacyCacheUserId = user.id;
    legacyCacheExpiresAt = Date.now() + LEGACY_CACHE_MS;
    return legacyCache;
  })().finally(() => {
    legacyListPromises.delete(user.id);
  });
  legacyListPromises.set(user.id, promise);
  return promise;
}

function identityKey(item) {
  return `${item?.scope || ''}:${item?.itemSlug || ''}`;
}

function mergeHybridState(state) {
  const tombstoneKeys = new Set((state.tombstones || []).map(identityKey));
  const r2Keys = new Set((state.items || []).map(identityKey));
  const legacyItems = (state.legacyItems || [])
    .filter((item) => !r2Keys.has(identityKey(item)) && !tombstoneKeys.has(identityKey(item)))
    .map((item) => ({ ...item, storageBackend: 'legacy' }));
  return [...(state.items || []), ...legacyItems]
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
}

export async function listCloudSnapshotMetadata({ force = false } = {}) {
  const mode = getCloudSnapshotStorageMode();
  if (mode === 'legacy') return listLegacyMetadata({ force });
  const state = await getApiClient().listSnapshotState({ force });
  return mode === 'r2-only' ? state.items : mergeHybridState(state);
}

async function getLegacySnapshot(scope, itemSlug) {
  const user = await requireUser();
  const { data, error } = await getSupabaseClient()
    .from('cloud_snapshots')
    .select(`
      id,
      scope,
      item_slug,
      item_title,
      payload_text,
      payload_version,
      source_updated_at,
      size_bytes,
      metadata,
      created_at,
      updated_at
    `)
    .eq('user_id', user.id)
    .eq('scope', scope)
    .eq('item_slug', itemSlug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapLegacySnapshot(data, true) : null;
}

export async function getCloudSnapshot(scope, itemSlug, knownItem = null) {
  const mode = getCloudSnapshotStorageMode();
  let item = knownItem;
  if (!item) {
    const items = await listCloudSnapshotMetadata();
    item = items.find((candidate) => candidate.scope === scope && candidate.itemSlug === itemSlug) || null;
  }
  if (!item) throw new Error('Không tìm thấy snapshot cloud đã chọn.');

  if (mode === 'legacy' || (mode === 'hybrid' && item.storageBackend === 'legacy')) {
    const legacy = await getLegacySnapshot(scope, itemSlug);
    if (!legacy) throw new Error('Không tìm thấy snapshot cloud đã chọn.');
    return legacy;
  }

  if (item.storageBackend === 'legacy') {
    throw new Error('Snapshot legacy không khả dụng ở chế độ R2-only.');
  }

  const payloadText = await getApiClient().downloadSnapshot(item);
  return { ...item, payloadText };
}

function mapLegacyWriteError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('cloud_snapshot_quota') || message.includes('snapshot quota')) {
    const mapped = new Error('Dung lượng Cloud Sync đã đạt giới hạn 256 MiB hoặc 200 snapshot. Hãy xóa bớt snapshot rồi thử lại.');
    mapped.code = 'CLOUD_SNAPSHOT_QUOTA_EXCEEDED';
    return mapped;
  }
  return error;
}

async function upsertLegacySnapshot(user, input) {
  const row = {
    user_id: user.id,
    scope: input.scope,
    item_slug: input.itemSlug,
    item_title: input.itemTitle,
    payload_text: input.payloadText,
    payload_version: input.payloadVersion,
    source_updated_at: input.sourceUpdatedAt,
    size_bytes: input.sizeBytes,
    metadata: input.metadata,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabaseClient()
    .from('cloud_snapshots')
    .upsert(row, { onConflict: 'user_id,scope,item_slug' })
    .select(`
      id,
      scope,
      item_slug,
      item_title,
      payload_version,
      source_updated_at,
      size_bytes,
      metadata,
      created_at,
      updated_at
    `)
    .single();
  if (error) throw mapLegacyWriteError(error);
  return mapLegacySnapshot(data);
}

export async function putCloudSnapshot(input) {
  const user = await requireUser();
  const mode = getCloudSnapshotStorageMode();
  if (mode === 'legacy') {
    const result = await upsertLegacySnapshot(user, input);
    clearCaches();
    return result;
  }

  let expectedRevisionId = input.expectedRevisionId || null;
  if (!Object.hasOwn(input, 'expectedRevisionId')) {
    const items = await listCloudSnapshotMetadata();
    const existing = items.find((item) => item.scope === input.scope && item.itemSlug === input.itemSlug);
    expectedRevisionId = existing?.storageBackend === 'r2' ? existing.revisionId : null;
  }
  const result = await getApiClient().uploadSnapshot({
    ...input,
    writeId: input.writeId || crypto.randomUUID(),
    expectedRevisionId,
  });
  clearCaches();
  return result;
}

export async function deleteCloudSnapshot(scope, itemSlug) {
  const mode = getCloudSnapshotStorageMode();
  if (mode === 'legacy') {
    const user = await requireUser();
    const { error } = await getSupabaseClient()
      .from('cloud_snapshots')
      .delete()
      .eq('user_id', user.id)
      .eq('scope', scope)
      .eq('item_slug', itemSlug);
    if (error) throw error;
    clearCaches();
    return;
  }

  const items = await listCloudSnapshotMetadata({ force: true });
  const existing = items.find((item) => item.scope === scope && item.itemSlug === itemSlug);
  if (!existing) throw new Error('Không tìm thấy snapshot cloud đã chọn.');
  await getApiClient().deleteSnapshot(existing.id);
  clearCaches();
}

export async function listCloudSnapshotsWithPayload() {
  const items = await listCloudSnapshotMetadata({ force: true });
  const results = [];
  for (let index = 0; index < items.length;) {
    const first = items[index];
    const second = items[index + 1];
    const canPair = second
      && Number(first.sizeBytes || 0) <= EXPORT_IN_FLIGHT_BYTES
      && Number(second.sizeBytes || 0) <= EXPORT_IN_FLIGHT_BYTES
      && Number(first.sizeBytes || 0) + Number(second.sizeBytes || 0) <= EXPORT_IN_FLIGHT_BYTES;
    const batch = canPair ? [first, second] : [first];
    const downloaded = await Promise.all(batch.map((item) => getCloudSnapshot(item.scope, item.itemSlug, item)));
    for (const item of downloaded) {
      if (item.payloadSha256) {
        results.push(item);
      } else {
        const encoded = await encodeCloudPayload(item.payloadText);
        results.push({
          ...item,
          sizeBytes: encoded.sizeBytes,
          payloadSha256: encoded.payloadSha256,
        });
      }
    }
    index += batch.length;
  }
  return results;
}

export function resetCloudSnapshotStoreForTests() {
  apiClient = null;
  legacyListPromises.clear();
  legacyCache = null;
  legacyCacheUserId = '';
  legacyCacheExpiresAt = 0;
}
