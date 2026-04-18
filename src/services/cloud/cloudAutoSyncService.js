import db from '../db/database.js';
import {
  getStoryCreationSettingsMeta,
} from '../ai/storyCreationSettings.js';
import {
  backupChatThread,
  backupProject,
  backupPromptBundle,
  deriveChatCloudSlug,
  deriveProjectCloudSlug,
  listChatBackups,
  listProjectBackups,
  listPromptBackups,
} from './cloudBackupService.js';
import { getSession } from './cloudAuthService.js';

const PREFS_KEY = 'sf-cloud-sync-prefs';
const STATUS_EVENT = 'storyforge:cloud-sync-status';

let cyclePromise = null;

function readPrefs() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      autoSyncEnabled: false,
      lastRunAt: 0,
      activeUserId: '',
    };
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      autoSyncEnabled: parsed?.autoSyncEnabled === true,
      lastRunAt: Number(parsed?.lastRunAt || 0),
      activeUserId: String(parsed?.activeUserId || '').trim(),
    };
  } catch {
    return {
      autoSyncEnabled: false,
      lastRunAt: 0,
      activeUserId: '',
    };
  }
}

function writePrefs(nextPrefs = {}) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      autoSyncEnabled: Boolean(nextPrefs?.autoSyncEnabled),
      lastRunAt: Number(nextPrefs?.lastRunAt || 0),
      activeUserId: String(nextPrefs?.activeUserId || '').trim(),
    };
  }

  const current = readPrefs();
  const merged = {
    autoSyncEnabled: nextPrefs?.autoSyncEnabled ?? current.autoSyncEnabled ?? false,
    lastRunAt: Number(nextPrefs?.lastRunAt ?? current.lastRunAt ?? 0),
    activeUserId: String(nextPrefs?.activeUserId ?? current.activeUserId ?? '').trim(),
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  return merged;
}

function emitStatus(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
}

function mapBackupsBySlug(items) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [item.itemSlug, item]));
}

function parseServerTimestamp(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOwnedByDifferentUser(ownerUserId, currentUserId) {
  const owner = String(ownerUserId || '').trim();
  const current = String(currentUserId || '').trim();
  return Boolean(owner && current && owner !== current);
}

function isPendingLocalForkAfterDuplicateRestore(item) {
  const baseline = Number(item?.cloud_pending_local_fork_until_change || 0);
  const localUpdatedAt = Number(item?.updated_at || 0);
  return baseline > 0 && localUpdatedAt <= baseline;
}

function detectProjectState(project, cloudItem, currentUserId) {
  const slug = deriveProjectCloudSlug(project);
  const localUpdatedAt = Number(project?.updated_at || 0);
  const localSyncedAt = Number(project?.cloud_last_synced_at || 0);
  const localServerUpdatedAt = parseServerTimestamp(project?.cloud_last_server_updated_at);
  const cloudUpdatedAt = parseServerTimestamp(cloudItem?.updatedAt);
  if (isOwnedByDifferentUser(project?.cloud_owner_user_id, currentUserId)) {
    return null;
  }

  if (!cloudItem) {
    if (isPendingLocalForkAfterDuplicateRestore(project)) {
      return null;
    }

    return {
      type: 'upload',
      scope: 'project',
      itemSlug: slug,
      itemTitle: String(project?.title || `Project ${project?.id}`).trim() || `Project ${project?.id}`,
      localId: Number(project.id),
      localUpdatedAt,
      cloudUpdatedAt: 0,
      data: project,
    };
  }

  if (localUpdatedAt > Math.max(localSyncedAt, cloudUpdatedAt)) {
    return {
      type: 'upload',
      scope: 'project',
      itemSlug: slug,
      itemTitle: cloudItem.itemTitle || project.title,
      localId: Number(project.id),
      localUpdatedAt,
      cloudUpdatedAt,
      data: project,
    };
  }

  if (cloudUpdatedAt > localServerUpdatedAt) {
    return {
      type: 'conflict',
      scope: 'project',
      itemSlug: slug,
      itemTitle: cloudItem.itemTitle || project.title,
      localId: Number(project.id),
      localUpdatedAt,
      cloudUpdatedAt,
      cloudItem,
      data: project,
    };
  }

  return null;
}

function detectChatState(thread, cloudItem, currentUserId) {
  const slug = String(thread?.cloud_chat_slug || '').trim() || deriveChatCloudSlug(thread);
  const localUpdatedAt = Number(thread?.updated_at || 0);
  const localSyncedAt = Number(thread?.cloud_last_synced_at || 0);
  const localServerUpdatedAt = parseServerTimestamp(thread?.cloud_last_server_updated_at);
  const cloudUpdatedAt = parseServerTimestamp(cloudItem?.updatedAt);
  if (isOwnedByDifferentUser(thread?.cloud_owner_user_id, currentUserId)) {
    return null;
  }

  if (!cloudItem) {
    return {
      type: 'upload',
      scope: 'chat',
      itemSlug: slug,
      itemTitle: String(thread?.title || `Chat ${thread?.id}`).trim() || `Chat ${thread?.id}`,
      localId: Number(thread.id),
      localUpdatedAt,
      cloudUpdatedAt: 0,
      data: thread,
    };
  }

  if (localUpdatedAt > Math.max(localSyncedAt, cloudUpdatedAt)) {
    return {
      type: 'upload',
      scope: 'chat',
      itemSlug: slug,
      itemTitle: cloudItem.itemTitle || thread.title,
      localId: Number(thread.id),
      localUpdatedAt,
      cloudUpdatedAt,
      data: thread,
    };
  }

  if (cloudUpdatedAt > localServerUpdatedAt) {
    return {
      type: 'conflict',
      scope: 'chat',
      itemSlug: slug,
      itemTitle: cloudItem.itemTitle || thread.title,
      localId: Number(thread.id),
      localUpdatedAt,
      cloudUpdatedAt,
      cloudItem,
      data: thread,
    };
  }

  return null;
}

function detectPromptState(cloudItem, currentUserId) {
  const meta = getStoryCreationSettingsMeta();
  const localUpdatedAt = Number(meta?.lastModifiedAt || 0);
  const localSyncedAt = Number(meta?.lastSyncedAt || 0);
  const localServerUpdatedAt = parseServerTimestamp(meta?.lastServerUpdatedAt);
  const cloudUpdatedAt = parseServerTimestamp(cloudItem?.updatedAt);
  if (isOwnedByDifferentUser(meta?.ownerUserId, currentUserId)) {
    return null;
  }

  if (!cloudItem) {
    return {
      type: 'upload',
      scope: 'prompt_bundle',
      itemSlug: 'story-creation-settings',
      itemTitle: 'Global prompt bundle',
      localId: 'story-creation-settings',
      localUpdatedAt,
      cloudUpdatedAt: 0,
      data: meta,
    };
  }

  if (localUpdatedAt > Math.max(localSyncedAt, cloudUpdatedAt)) {
    return {
      type: 'upload',
      scope: 'prompt_bundle',
      itemSlug: cloudItem.itemSlug,
      itemTitle: cloudItem.itemTitle,
      localId: 'story-creation-settings',
      localUpdatedAt,
      cloudUpdatedAt,
      data: meta,
    };
  }

  if (cloudUpdatedAt > localServerUpdatedAt) {
    return {
      type: 'conflict',
      scope: 'prompt_bundle',
      itemSlug: cloudItem.itemSlug,
      itemTitle: cloudItem.itemTitle,
      localId: 'story-creation-settings',
      localUpdatedAt,
      cloudUpdatedAt,
      cloudItem,
      data: meta,
    };
  }

  return null;
}

export function getCloudSyncPreferences() {
  return readPrefs();
}

export function saveCloudSyncPreferences(nextPrefs = {}) {
  return writePrefs(nextPrefs);
}

export async function scanCloudSyncState() {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      signedIn: false,
      pendingUploads: [],
      conflicts: [],
      lastRunAt: readPrefs().lastRunAt,
    };
  }

  const prefs = readPrefs();
  const currentUserId = String(session.user.id);
  if (prefs.activeUserId && prefs.activeUserId !== currentUserId) {
    return {
      signedIn: true,
      pendingUploads: [],
      conflicts: [],
      lastRunAt: prefs.lastRunAt,
      accountMismatch: true,
    };
  }

  const [projects, threads, projectBackups, chatBackups, promptBackups] = await Promise.all([
    db.projects.toArray(),
    db.ai_chat_threads.toArray(),
    listProjectBackups(),
    listChatBackups(),
    listPromptBackups(),
  ]);

  const projectBackupMap = mapBackupsBySlug(projectBackups);
  const chatBackupMap = mapBackupsBySlug(chatBackups);
  const promptItem = Array.isArray(promptBackups) ? promptBackups[0] || null : null;
  const pendingUploads = [];
  const conflicts = [];

  projects.forEach((project) => {
    const state = detectProjectState(project, projectBackupMap.get(deriveProjectCloudSlug(project)), currentUserId);
    if (!state) return;
    if (state.type === 'upload') pendingUploads.push(state);
    if (state.type === 'conflict') conflicts.push(state);
  });

  threads.forEach((thread) => {
    const slug = String(thread?.cloud_chat_slug || '').trim() || deriveChatCloudSlug(thread);
    const state = detectChatState(thread, chatBackupMap.get(slug), currentUserId);
    if (!state) return;
    if (state.type === 'upload') pendingUploads.push(state);
    if (state.type === 'conflict') conflicts.push(state);
  });

  const promptState = detectPromptState(promptItem, currentUserId);
  if (promptState) {
    if (promptState.type === 'upload') pendingUploads.push(promptState);
    if (promptState.type === 'conflict') conflicts.push(promptState);
  }

  return {
    signedIn: true,
    pendingUploads,
    conflicts,
    lastRunAt: readPrefs().lastRunAt,
  };
}

export async function runAutoSyncCycle(options = {}) {
  if (cyclePromise) {
    return cyclePromise;
  }

  cyclePromise = (async () => {
    const prefs = readPrefs();
    const session = await getSession();
    if (!session?.user?.id) {
      const result = {
        signedIn: false,
        autoSyncEnabled: prefs.autoSyncEnabled,
        uploadedCount: 0,
        pendingUploads: [],
        conflicts: [],
        reason: options.reason || 'manual',
      };
      emitStatus(result);
      return result;
    }

    if (prefs.activeUserId && prefs.activeUserId !== String(session.user.id)) {
      const result = {
        signedIn: true,
        autoSyncEnabled: prefs.autoSyncEnabled,
        uploadedCount: 0,
        pendingUploads: [],
        conflicts: [],
        lastRunAt: prefs.lastRunAt,
        reason: 'account-mismatch',
      };
      emitStatus(result);
      return result;
    }

    const scan = await scanCloudSyncState();
    const uploaded = [];

    if (prefs.autoSyncEnabled || options.force === true) {
      for (const item of scan.pendingUploads) {
        if (item.scope === 'project') {
          await backupProject(item.data);
        } else if (item.scope === 'chat') {
          await backupChatThread(item.data);
        } else if (item.scope === 'prompt_bundle') {
          await backupPromptBundle();
        }
        uploaded.push({ scope: item.scope, itemSlug: item.itemSlug });
      }
    }

    const completedAt = Date.now();
    writePrefs({ lastRunAt: completedAt });
    const result = {
      signedIn: true,
      autoSyncEnabled: prefs.autoSyncEnabled,
      uploadedCount: uploaded.length,
      uploaded,
      pendingUploads: scan.pendingUploads,
      conflicts: scan.conflicts,
      lastRunAt: completedAt,
      reason: options.reason || 'manual',
    };
    emitStatus(result);
    return result;
  })();

  try {
    return await cyclePromise;
  } finally {
    cyclePromise = null;
  }
}

export function subscribeCloudSyncStatus(listener) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event) => {
    listener?.(event.detail || null);
  };
  window.addEventListener(STATUS_EVENT, handler);
  return () => window.removeEventListener(STATUS_EVENT, handler);
}

export default {
  getCloudSyncPreferences,
  saveCloudSyncPreferences,
  scanCloudSyncState,
  runAutoSyncCycle,
  subscribeCloudSyncStatus,
};
