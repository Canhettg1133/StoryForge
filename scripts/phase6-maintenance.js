#!/usr/bin/env node
import { parseBackfillArgs, runIncidentFirstBackfill } from '../src/services/analysis/maintenance/backfillAutomation.js';
import { pruneOldBackups, resolveCorpusDbPath } from '../src/services/analysis/maintenance/backupAutomation.js';

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const summary = await runIncidentFirstBackfill({
    ...args,
    backup: args.backup !== false,
  });

  if (summary.backup) {
    const dbPath = resolveCorpusDbPath(args.dbPath || null);
    const baseName = dbPath
      .split(/[\\/]/u)
      .pop()
      ?.replace(/\.[^.]+$/u, '') || 'storyforge-corpus';
    const pruned = pruneOldBackups({
      backupRoot: args.backupRoot || null,
      baseName,
      keepLast: args.keepLastBackups || 20,
    });

    console.log(`[phase6] backup created: ${summary.backup.files.length} files`);
    console.log(`[phase6] backup pruned: ${pruned.removed.length} files`);
  } else {
    console.log('[phase6] backup skipped');
  }

  console.log(`[phase6] analyses processed: ${summary.total}`);
  console.log(`[phase6] success=${summary.success} skipped=${summary.skipped} failed=${summary.failed}`);

  for (const item of summary.details) {
    if (item.status === 'ok') {
      console.log(`[ok] ${item.analysisId} -> ${JSON.stringify(item.counts || {})}`);
      continue;
    }
    if (item.status === 'dry_run') {
      console.log(`[dry-run] ${item.analysisId}`);
      continue;
    }
    if (item.status?.startsWith('skipped')) {
      console.log(`[skip] ${item.analysisId} (${item.status})`);
      continue;
    }
    console.error(`[error] ${item.analysisId}: ${item.error || 'unknown'}`);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[phase6] fatal:', error?.message || error);
  process.exitCode = 1;
});
