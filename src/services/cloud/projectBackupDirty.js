import { PROJECT_SNAPSHOT_TABLES } from '../db/projectSnapshotRegistry.js';

const STORAGE_KEY = 'sf-cloud-project-dirty-v1';
const installedDatabases = new WeakSet();
const PROJECT_BOOKKEEPING_FIELDS = new Set([
  'updated_at',
  'cloud_project_slug',
  'cloud_last_synced_at',
  'cloud_last_server_updated_at',
  'cloud_owner_user_id',
  'cloud_pending_local_fork_until_change',
  'cloud_content_hash',
  'cloud_dirty_at',
  'cloud_pending_file_import',
  'word_count',
  'total_words',
  'chapter_count',
  'scene_count',
]);

function readDirtyMap() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDirtyMap(value) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function markProjectBackupDirty(projectId, timestamp = Date.now()) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) return;
  const dirty = readDirtyMap();
  dirty[String(normalizedProjectId)] = Number(timestamp || Date.now());
  writeDirtyMap(dirty);
}

export function clearProjectBackupDirty(projectId) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) return;
  const dirty = readDirtyMap();
  delete dirty[String(normalizedProjectId)];
  writeDirtyMap(dirty);
}

export function clearAllProjectBackupDirty() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

export function getDirtyProjectIds() {
  const dirty = readDirtyMap();
  return Object.keys(dirty)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
}

export function isProjectBackupDirty(projectId) {
  const normalizedProjectId = Number(projectId);
  return getDirtyProjectIds().includes(normalizedProjectId);
}

function projectUpdateChangesStory(modifications) {
  return Object.keys(modifications || {}).some((key) => !PROJECT_BOOKKEEPING_FIELDS.has(key));
}

function installDirectTableHooks(table) {
  table.hook('creating', (_primaryKey, object) => markProjectBackupDirty(object?.project_id));
  table.hook('updating', (modifications, _primaryKey, object) => {
    markProjectBackupDirty(modifications?.project_id ?? object?.project_id);
  });
  table.hook('deleting', (_primaryKey, object) => markProjectBackupDirty(object?.project_id));
}

export function installProjectDirtyTracking(database) {
  if (!database || installedDatabases.has(database)) return;
  installedDatabases.add(database);

  for (const tableName of new Set(PROJECT_SNAPSHOT_TABLES.map((item) => item.table))) {
    const table = database[tableName];
    if (table) installDirectTableHooks(table);
  }

  const installParentResolver = (tableName, parentTableName, foreignKey) => {
    const table = database[tableName];
    const parentTable = database[parentTableName];
    if (!table || !parentTable) return;
    const resolve = (object, modifications = {}) => {
      const parentId = modifications[foreignKey] ?? object?.[foreignKey];
      if (parentId == null) return;
      Promise.resolve(parentTable.get(parentId))
        .then((parent) => markProjectBackupDirty(parent?.project_id))
        .catch(() => {});
    };
    table.hook('creating', (_primaryKey, object) => resolve(object));
    table.hook('updating', (modifications, _primaryKey, object) => resolve(object, modifications));
    table.hook('deleting', (_primaryKey, object) => resolve(object));
  };
  installParentResolver('threadBeats', 'plotThreads', 'plot_thread_id');
  installParentResolver('revisions', 'scenes', 'scene_id');

  if (database.projects) {
    database.projects.hook('updating', (modifications, primaryKey) => {
      if (projectUpdateChangesStory(modifications)) markProjectBackupDirty(primaryKey);
    });
  }
}

export default {
  markProjectBackupDirty,
  clearProjectBackupDirty,
  clearAllProjectBackupDirty,
  getDirtyProjectIds,
  isProjectBackupDirty,
  installProjectDirtyTracking,
};
