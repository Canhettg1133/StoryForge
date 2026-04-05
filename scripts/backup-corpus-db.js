#!/usr/bin/env node
import { createCorpusDbBackup, pruneOldBackups, resolveCorpusDbPath } from '../src/services/analysis/maintenance/backupAutomation.js';

function parseArgs(argv = []) {
  const args = {
    dbPath: null,
    backupRoot: null,
    keepLast: 20,
    tag: 'manual',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (!token) continue;

    if (token === '--db' && argv[index + 1]) {
      args.dbPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === '--backup-root' && argv[index + 1]) {
      args.backupRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === '--keep-last' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      args.keepLast = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 20;
      index += 1;
      continue;
    }
    if (token === '--tag' && argv[index + 1]) {
      args.tag = String(argv[index + 1]).trim() || 'manual';
      index += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDbPath = resolveCorpusDbPath(args.dbPath);
  const backup = createCorpusDbBackup({
    dbPath: sourceDbPath,
    backupRoot: args.backupRoot || null,
    tag: args.tag,
  });

  const baseName = sourceDbPath
    .split(/[\\/]/u)
    .pop()
    ?.replace(/\.[^.]+$/u, '') || 'storyforge-corpus';
  const pruned = pruneOldBackups({
    backupRoot: args.backupRoot || null,
    baseName,
    keepLast: args.keepLast,
  });

  console.log(`[backup] source: ${backup.dbPath}`);
  console.log(`[backup] created: ${backup.files.length} files`);
  for (const filePath of backup.files) {
    console.log(`  - ${filePath}`);
  }
  console.log(`[backup] pruned: ${pruned.removed.length} files`);
}

main().catch((error) => {
  console.error('[backup] fatal:', error?.message || error);
  process.exitCode = 1;
});
