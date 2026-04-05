import fs from 'node:fs';
import path from 'node:path';

function normalizeText(value) {
  return String(value || '').trim();
}

export function nowStamp() {
  return new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replaceAll('.', '-');
}

function copyIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

export function resolveCorpusDbPath(inputPath = null) {
  const explicit = normalizeText(inputPath);
  if (explicit) {
    return explicit;
  }

  const envPath = normalizeText(process.env.STORYFORGE_CORPUS_DB_PATH);
  if (envPath) {
    return envPath;
  }

  return path.resolve(process.cwd(), 'data', 'storyforge-corpus.sqlite');
}

export function createCorpusDbBackup({
  dbPath = null,
  backupRoot = null,
  tag = 'manual',
  includeWal = true,
} = {}) {
  const sourceDbPath = resolveCorpusDbPath(dbPath);
  if (!fs.existsSync(sourceDbPath)) {
    const error = new Error(`Corpus DB not found at ${sourceDbPath}`);
    error.code = 'DB_NOT_FOUND';
    throw error;
  }

  const resolvedBackupRoot = backupRoot
    ? path.resolve(backupRoot)
    : path.resolve(process.cwd(), 'data', 'backups');
  fs.mkdirSync(resolvedBackupRoot, { recursive: true });

  const stamp = nowStamp();
  const baseName = path.basename(sourceDbPath, path.extname(sourceDbPath));
  const safeTag = normalizeText(tag).replace(/[^a-zA-Z0-9_-]/gu, '_') || 'manual';
  const backupPrefix = path.join(resolvedBackupRoot, `${baseName}.${stamp}.${safeTag}`);

  const createdFiles = [];
  const mainBackupPath = `${backupPrefix}.sqlite`;
  fs.copyFileSync(sourceDbPath, mainBackupPath);
  createdFiles.push(mainBackupPath);

  if (includeWal) {
    const walBackupPath = `${backupPrefix}.sqlite-wal`;
    const shmBackupPath = `${backupPrefix}.sqlite-shm`;
    if (copyIfExists(`${sourceDbPath}-wal`, walBackupPath)) {
      createdFiles.push(walBackupPath);
    }
    if (copyIfExists(`${sourceDbPath}-shm`, shmBackupPath)) {
      createdFiles.push(shmBackupPath);
    }
  }

  const manifest = {
    createdAt: Date.now(),
    sourceDbPath,
    backupPrefix,
    tag: safeTag,
    files: createdFiles,
  };
  const manifestPath = `${backupPrefix}.json`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  createdFiles.push(manifestPath);

  return {
    dbPath: sourceDbPath,
    backupRoot: resolvedBackupRoot,
    backupPrefix,
    files: createdFiles,
    manifestPath,
  };
}

export function pruneOldBackups({
  backupRoot = null,
  baseName = null,
  keepLast = 20,
} = {}) {
  const resolvedBackupRoot = backupRoot
    ? path.resolve(backupRoot)
    : path.resolve(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(resolvedBackupRoot)) {
    return { removed: [] };
  }

  const safeKeepLast = Math.max(1, Number(keepLast) || 20);
  const safeBaseName = normalizeText(baseName);
  const pattern = safeBaseName
    ? new RegExp(`^${safeBaseName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.`)
    : null;

  const entries = fs.readdirSync(resolvedBackupRoot)
    .map((name) => ({
      name,
      fullPath: path.join(resolvedBackupRoot, name),
    }))
    .filter((item) => fs.statSync(item.fullPath).isFile())
    .filter((item) => (
      item.name.endsWith('.sqlite')
      || item.name.endsWith('.sqlite-wal')
      || item.name.endsWith('.sqlite-shm')
      || item.name.endsWith('.json')
    ))
    .filter((item) => (pattern ? pattern.test(item.name) : true));

  const groups = new Map();
  for (const item of entries) {
    const groupKey = item.name
      .replace(/\.sqlite(?:-wal|-shm)?$/u, '')
      .replace(/\.json$/u, '');
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(item.fullPath);
  }

  const sortedGroupKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));
  const keep = new Set(sortedGroupKeys.slice(0, safeKeepLast));
  const removeKeys = sortedGroupKeys.slice(safeKeepLast);
  const removed = [];

  for (const groupKey of removeKeys) {
    if (keep.has(groupKey)) continue;
    for (const filePath of groups.get(groupKey) || []) {
      try {
        fs.unlinkSync(filePath);
        removed.push(filePath);
      } catch {
        // Ignore failures, caller gets best-effort cleanup.
      }
    }
  }

  return { removed };
}

export default {
  nowStamp,
  resolveCorpusDbPath,
  createCorpusDbBackup,
  pruneOldBackups,
};
