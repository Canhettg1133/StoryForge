import db from '../db/database.js';
import JSZip from 'jszip';
import {
  exportChatThread,
  exportProject,
  exportPromptBundle,
  importChatThread,
  importProject,
  importPromptBundle,
} from '../db/exportImport.js';
import { deleteProjectCascade } from '../db/projectDataService.js';
import {
  DEFAULT_STORY_CREATION_SETTINGS,
  STORY_CREATION_PROMPT_GROUPS,
  markStoryCreationSettingsSynced,
} from '../ai/storyCreationSettings.js';
import { getSupabaseClient, getSupabaseConfigError, isSupabaseConfigured } from './supabaseClient.js';
import { getSession } from './cloudAuthService.js';

const PROJECT_SCOPE = 'project';
const CHAT_SCOPE = 'chat';
const PROMPT_BUNDLE_SCOPE = 'prompt_bundle';
const PROMPT_BUNDLE_SLUG = 'story-creation-settings';
const PROMPT_BUNDLE_TITLE = 'Global prompt bundle';

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }
}

async function requireUser() {
  ensureConfigured();
  const session = await getSession();
  const user = session?.user || null;
  if (!user?.id) {
    throw new Error('Ban can dang nhap Google truoc khi dung Cloud Sync.');
  }
  return user;
}

function slugify(value, fallback = 'item') {
  const base = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || fallback;
}

function buildProjectSlug(project) {
  const existing = String(project?.cloud_project_slug || '').trim();
  if (existing) return existing;

  const normalizedId = Number(project?.id);
  const suffix = Number.isFinite(normalizedId) && normalizedId > 0 ? `-${normalizedId}` : '';
  const base = slugify(project?.title, 'project');
  return `${base}${suffix}`;
}

export function deriveProjectCloudSlug(project) {
  return buildProjectSlug(project);
}

function buildChatSlug(thread) {
  const existing = String(thread?.cloud_chat_slug || '').trim();
  if (existing) return existing;

  const normalizedId = Number(thread?.id);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('Khong tim thay thread chat local de backup.');
  }

  return `chat-thread-${normalizedId}`;
}

export function deriveChatCloudSlug(thread) {
  return buildChatSlug(thread);
}

function computeSizeBytes(value) {
  try {
    return new TextEncoder().encode(String(value || '')).length;
  } catch {
    return String(value || '').length;
  }
}

function parseServerTimestamp(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countCustomizedPromptGroups(settings) {
  return STORY_CREATION_PROMPT_GROUPS.filter((group) => {
    const currentGroup = settings?.[group.key] || {};
    const defaultGroup = DEFAULT_STORY_CREATION_SETTINGS[group.key] || {};
    return JSON.stringify(currentGroup) !== JSON.stringify(defaultGroup);
  }).length;
}

function parseProjectSnapshotMetadata(payloadText) {
  try {
    const parsed = JSON.parse(payloadText);
    return {
      storyforgeVersion: parsed?._storyforge_version ?? null,
      exportedAt: parsed?._exported_at || null,
    };
  } catch {
    return {
      storyforgeVersion: null,
      exportedAt: null,
    };
  }
}

function validateProjectSnapshotPayload(payloadText) {
  let parsed = null;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw new Error('Snapshot cloud bi loi JSON va khong the khoi phuc.');
  }

  if (!parsed?._storyforge_version || !parsed?.project) {
    throw new Error('Snapshot cloud khong dung dinh dang backup StoryForge.');
  }

  return parsed;
}

function validateChatSnapshotPayload(payloadText) {
  let parsed = null;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw new Error('Snapshot chat cloud bi loi JSON va khong the khoi phuc.');
  }

  if (!parsed?._storyforge_version || parsed?._cloud_scope !== CHAT_SCOPE || !parsed?.thread || !Array.isArray(parsed?.messages)) {
    throw new Error('Snapshot chat cloud khong dung dinh dang backup StoryForge.');
  }

  return parsed;
}

function validatePromptBundlePayload(payloadText) {
  let parsed = null;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw new Error('Snapshot prompt cloud bi loi JSON va khong the khoi phuc.');
  }

  if (!parsed?._storyforge_version || parsed?._cloud_scope !== PROMPT_BUNDLE_SCOPE || !parsed?.story_creation_settings) {
    throw new Error('Snapshot prompt cloud khong dung dinh dang backup StoryForge.');
  }

  return parsed;
}

function mapSnapshotRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    itemSlug: row.item_slug,
    itemTitle: row.item_title,
    payloadText: row.payload_text,
    payloadVersion: row.payload_version,
    sourceUpdatedAt: row.source_updated_at,
    sizeBytes: Number(row.size_bytes || 0),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSnapshotRow(scope, itemSlug) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client
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
  if (!data) {
    throw new Error('Khong tim thay snapshot cloud da chon.');
  }

  return data;
}

async function listBackups(scope) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client
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
    .eq('scope', scope)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data.map(mapSnapshotRow) : [];
}

async function listAllBackupsWithPayload() {
  const user = await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client
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
    .order('scope', { ascending: true })
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data.map(mapSnapshotRow) : [];
}

async function upsertSnapshot({ scope, itemSlug, itemTitle, payloadText, sourceUpdatedAt, metadata = {} }) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const sizeBytes = computeSizeBytes(payloadText);
  const row = {
    user_id: user.id,
    scope,
    item_slug: itemSlug,
    item_title: String(itemTitle || itemSlug).trim() || itemSlug,
    payload_text: payloadText,
    payload_version: 1,
    source_updated_at: Number(sourceUpdatedAt || Date.now()),
    size_bytes: sizeBytes,
    metadata,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('cloud_snapshots')
    .upsert(row, {
      onConflict: 'user_id,scope,item_slug',
    })
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

  if (error) throw error;
  return mapSnapshotRow(data);
}

async function deleteBackup(scope, itemSlug) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const { error } = await client
    .from('cloud_snapshots')
    .delete()
    .eq('user_id', user.id)
    .eq('scope', scope)
    .eq('item_slug', itemSlug);

  if (error) throw error;
}

export async function listProjectBackups() {
  return listBackups(PROJECT_SCOPE);
}

export async function backupProject(project) {
  const normalizedProjectId = Number(project?.id);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) {
    throw new Error('Khong tim thay project local de backup.');
  }

  const freshProject = await db.projects.get(normalizedProjectId);
  if (!freshProject) {
    throw new Error('Khong tim thay project local de backup.');
  }

  const user = await requireUser();
  const itemSlug = buildProjectSlug(freshProject);
  const payloadText = await exportProject(freshProject.id);
  const snapshotMeta = parseProjectSnapshotMetadata(payloadText);

  const backup = await upsertSnapshot({
    scope: PROJECT_SCOPE,
    itemSlug,
    itemTitle: String(freshProject.title || `Project ${freshProject.id}`).trim() || `Project ${freshProject.id}`,
    payloadText,
    sourceUpdatedAt: Number(freshProject.updated_at || Date.now()),
    metadata: {
      localProjectId: Number(freshProject.id),
      exportedAt: snapshotMeta.exportedAt,
      storyforgeVersion: snapshotMeta.storyforgeVersion,
    },
  });

  await db.projects.update(freshProject.id, {
    cloud_project_slug: itemSlug,
    cloud_last_synced_at: Date.now(),
    cloud_last_server_updated_at: backup.updatedAt,
    cloud_owner_user_id: user.id,
    cloud_pending_local_fork_until_change: 0,
  });

  return backup;
}

export async function restoreProjectBackup(itemSlug, options = {}) {
  const normalizedMode = options.mode === 'replace' ? 'replace' : 'duplicate';
  const normalizedTargetProjectId = Number(options.targetProjectId);
  const user = await requireUser();
  const snapshotRow = await getSnapshotRow(PROJECT_SCOPE, itemSlug);
  const payloadText = String(snapshotRow.payload_text || '').trim();

  if (!payloadText) {
    throw new Error('Snapshot cloud khong co du lieu de khoi phuc.');
  }

  validateProjectSnapshotPayload(payloadText);

  if (normalizedMode === 'replace') {
    if (!Number.isFinite(normalizedTargetProjectId) || normalizedTargetProjectId <= 0) {
      throw new Error('Hay chon project local de ghi de.');
    }

    const targetProject = await db.projects.get(normalizedTargetProjectId);
    if (!targetProject) {
      throw new Error('Project local duoc chon de ghi de khong con ton tai.');
    }
    await deleteProjectCascade(normalizedTargetProjectId);
  }

  const newProjectId = await importProject(payloadText, {
    titleMode: normalizedMode === 'replace' ? 'original' : 'imported',
    preserveCloudMetadata: normalizedMode === 'replace',
  });

  const restoredProject = await db.projects.get(newProjectId);
  const duplicateBaselineAt = Number(restoredProject?.updated_at || Date.now());

  if (normalizedMode === 'replace') {
    await db.projects.update(newProjectId, {
      cloud_project_slug: itemSlug,
      cloud_last_synced_at: Date.now(),
      cloud_last_server_updated_at: snapshotRow.updated_at,
      cloud_owner_user_id: user.id,
      cloud_pending_local_fork_until_change: 0,
    });
  } else {
    await db.projects.update(newProjectId, {
      cloud_project_slug: '',
      cloud_last_synced_at: 0,
      cloud_last_server_updated_at: '',
      cloud_owner_user_id: '',
      cloud_pending_local_fork_until_change: duplicateBaselineAt,
    });
  }

  return {
    newProjectId,
    backup: mapSnapshotRow(snapshotRow),
    mode: normalizedMode,
  };
}

export async function deleteProjectBackup(itemSlug) {
  return deleteBackup(PROJECT_SCOPE, itemSlug);
}

export async function listChatBackups() {
  return listBackups(CHAT_SCOPE);
}

export async function backupChatThread(thread) {
  if (!thread?.id) {
    throw new Error('Khong tim thay thread chat local de backup.');
  }

  const user = await requireUser();
  const payloadText = await exportChatThread(thread.id);
  const parsed = validateChatSnapshotPayload(payloadText);
  const backup = await upsertSnapshot({
    scope: CHAT_SCOPE,
    itemSlug: buildChatSlug(thread),
    itemTitle: String(thread.title || `Chat ${thread.id}`).trim() || `Chat ${thread.id}`,
    payloadText,
    sourceUpdatedAt: Number(thread.updated_at || Date.now()),
    metadata: {
      localThreadId: Number(thread.id),
      projectId: Number(thread.project_id || 0),
      chatMode: String(thread.chat_mode || 'free'),
      messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
    },
  });

  await db.ai_chat_threads.update(thread.id, {
    cloud_chat_slug: backup.itemSlug,
    cloud_last_synced_at: Date.now(),
    cloud_last_server_updated_at: backup.updatedAt,
    cloud_owner_user_id: user.id,
  });

  return backup;
}

export async function restoreChatBackup(itemSlug) {
  const user = await requireUser();
  const snapshotRow = await getSnapshotRow(CHAT_SCOPE, itemSlug);
  const payloadText = String(snapshotRow.payload_text || '').trim();

  if (!payloadText) {
    throw new Error('Snapshot chat cloud khong co du lieu de khoi phuc.');
  }

  validateChatSnapshotPayload(payloadText);
  const result = await importChatThread(payloadText, {
    titleMode: 'imported',
    preserveCloudMetadata: true,
  });
  await db.ai_chat_threads.update(result.newThreadId, {
    cloud_chat_slug: itemSlug,
    cloud_last_synced_at: Date.now(),
    cloud_last_server_updated_at: snapshotRow.updated_at,
    cloud_owner_user_id: user.id,
  });

  return {
    newThreadId: result.newThreadId,
    projectId: result.projectId,
    messageCount: result.messageCount,
    backup: mapSnapshotRow(snapshotRow),
  };
}

export async function deleteChatBackup(itemSlug) {
  return deleteBackup(CHAT_SCOPE, itemSlug);
}

export async function listPromptBackups() {
  return listBackups(PROMPT_BUNDLE_SCOPE);
}

export async function backupPromptBundle() {
  const user = await requireUser();
  const payloadText = await exportPromptBundle();
  const validated = validatePromptBundlePayload(payloadText);
  const customizedGroupCount = countCustomizedPromptGroups(validated.story_creation_settings || {});

  const backup = await upsertSnapshot({
    scope: PROMPT_BUNDLE_SCOPE,
    itemSlug: PROMPT_BUNDLE_SLUG,
    itemTitle: PROMPT_BUNDLE_TITLE,
    payloadText,
    sourceUpdatedAt: Date.now(),
    metadata: {
      exportedAt: validated._exported_at || null,
      customizedGroupCount,
    },
  });
  markStoryCreationSettingsSynced(Date.now(), {
    serverUpdatedAt: backup.updatedAt,
    ownerUserId: user.id,
  });
  return backup;
}

export async function restorePromptBackup(itemSlug = PROMPT_BUNDLE_SLUG) {
  const user = await requireUser();
  const snapshotRow = await getSnapshotRow(PROMPT_BUNDLE_SCOPE, itemSlug);
  const payloadText = String(snapshotRow.payload_text || '').trim();

  if (!payloadText) {
    throw new Error('Snapshot prompt cloud khong co du lieu de khoi phuc.');
  }

  validatePromptBundlePayload(payloadText);
  const settings = importPromptBundle(payloadText);
  markStoryCreationSettingsSynced(Date.now(), {
    serverUpdatedAt: snapshotRow.updated_at,
    ownerUserId: user.id,
  });

  return {
    settings,
    backup: mapSnapshotRow(snapshotRow),
  };
}

export async function deletePromptBackup(itemSlug = PROMPT_BUNDLE_SLUG) {
  return deleteBackup(PROMPT_BUNDLE_SCOPE, itemSlug);
}

function buildCloudExportManifest(items) {
  return {
    _storyforge_version: 1,
    _cloud_export_scope: 'all_snapshots',
    _exported_at: new Date().toISOString(),
    snapshot_count: items.length,
    snapshots: items.map((item) => ({
      scope: item.scope,
      item_slug: item.itemSlug,
      item_title: item.itemTitle,
      payload_text: item.payloadText,
      payload_version: item.payloadVersion,
      source_updated_at: item.sourceUpdatedAt,
      size_bytes: item.sizeBytes,
      metadata: item.metadata || {},
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })),
  };
}

function validateCloudExportManifest(manifest) {
  if (!manifest?._cloud_export_scope || manifest._cloud_export_scope !== 'all_snapshots' || !Array.isArray(manifest?.snapshots)) {
    throw new Error('File import cloud khong dung dinh dang StoryForge.');
  }

  return manifest.snapshots
    .filter((item) => [PROJECT_SCOPE, CHAT_SCOPE, PROMPT_BUNDLE_SCOPE].includes(String(item?.scope || '')))
    .map((item) => ({
      scope: String(item.scope),
      itemSlug: String(item.item_slug || '').trim(),
      itemTitle: String(item.item_title || item.item_slug || '').trim(),
      payloadText: String(item.payload_text || ''),
      payloadVersion: Number(item.payload_version || 1),
      sourceUpdatedAt: Number(item.source_updated_at || 0),
      sizeBytes: Number(item.size_bytes || 0),
      metadata: item.metadata || {},
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || null,
    }))
    .filter((item) => item.itemSlug && item.payloadText);
}

function triggerDownload(blob, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportCloudBackups(format = 'zip') {
  const items = await listAllBackupsWithPayload();
  const manifest = buildCloudExportManifest(items);

  if (format === 'json') {
    const json = JSON.stringify(manifest, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, `storyforge-cloud-backups-${Date.now()}.json`);
    return { count: items.length, format: 'json' };
  }

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  items.forEach((item) => {
    zip.file(`snapshots/${item.scope}-${item.itemSlug}.json`, item.payloadText);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `storyforge-cloud-backups-${Date.now()}.zip`);
  return { count: items.length, format: 'zip' };
}

async function readCloudImportManifestFromFile(file) {
  const lowerName = String(file?.name || '').toLowerCase();

  if (lowerName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) {
      throw new Error('File zip cloud khong co manifest.json.');
    }
    const text = await manifestEntry.async('string');
    return JSON.parse(text);
  }

  const text = await file.text();
  return JSON.parse(text);
}

export async function importCloudBackups(file) {
  if (!file) {
    throw new Error('Khong tim thay file import cloud.');
  }

  const manifest = await readCloudImportManifestFromFile(file);
  const items = validateCloudExportManifest(manifest);
  if (items.length === 0) {
    throw new Error('File import cloud khong co snapshot hop le nao.');
  }

  const user = await requireUser();
  const client = getSupabaseClient();
  const existingItems = await listAllBackupsWithPayload();
  const existingMap = new Map(existingItems.map((item) => [`${item.scope}:${item.itemSlug}`, item]));
  const imported = [];
  const skipped = [];

  for (const item of items) {
    const key = `${item.scope}:${item.itemSlug}`;
    const existing = existingMap.get(key);
    const incomingUpdated = parseServerTimestamp(item.updatedAt) || Number(item.sourceUpdatedAt || 0);
    const existingUpdated = parseServerTimestamp(existing?.updatedAt) || Number(existing?.sourceUpdatedAt || 0);

    if (existing && existingUpdated > incomingUpdated) {
      skipped.push({
        scope: item.scope,
        itemSlug: item.itemSlug,
        reason: 'cloud_newer',
      });
      continue;
    }

    const row = {
      user_id: user.id,
      scope: item.scope,
      item_slug: item.itemSlug,
      item_title: item.itemTitle || item.itemSlug,
      payload_text: item.payloadText,
      payload_version: item.payloadVersion || 1,
      source_updated_at: incomingUpdated || Date.now(),
      size_bytes: item.sizeBytes || computeSizeBytes(item.payloadText),
      metadata: item.metadata || {},
      updated_at: item.updatedAt || new Date().toISOString(),
    };

    const { error } = await client
      .from('cloud_snapshots')
      .upsert(row, {
        onConflict: 'user_id,scope,item_slug',
      });

    if (error) throw error;
    imported.push({ scope: item.scope, itemSlug: item.itemSlug });
  }

  return {
    importedCount: imported.length,
    skippedCount: skipped.length,
    imported,
    skipped,
  };
}

export default {
  deriveProjectCloudSlug,
  deriveChatCloudSlug,
  listProjectBackups,
  backupProject,
  restoreProjectBackup,
  deleteProjectBackup,
  listChatBackups,
  backupChatThread,
  restoreChatBackup,
  deleteChatBackup,
  listPromptBackups,
  backupPromptBundle,
  restorePromptBackup,
  deletePromptBackup,
  exportCloudBackups,
  importCloudBackups,
};
