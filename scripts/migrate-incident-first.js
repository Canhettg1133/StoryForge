#!/usr/bin/env node
import { parseBackfillArgs, runIncidentFirstBackfill } from '../src/services/analysis/maintenance/backfillAutomation.js';

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const summary = await runIncidentFirstBackfill(args);

  if (summary.backup) {
    console.log(`[backfill] backup created: ${summary.backup.files.length} files`);
    for (const filePath of summary.backup.files) {
      console.log(`  - ${filePath}`);
    }
  } else {
    console.log('[backfill] backup skipped');
  }

  for (const item of summary.details) {
    if (item.status === 'ok') {
      console.log(`[ok] ${item.analysisId} -> ${JSON.stringify(item.counts || {})}`);
      continue;
    }
    if (item.status === 'dry_run') {
      console.log(`[dry-run] ${item.analysisId} would be backfilled`);
      continue;
    }
    if (item.status === 'skipped_existing') {
      console.log(`[skip] ${item.analysisId} already has artifacts`);
      continue;
    }
    if (item.status === 'skipped_invalid_result') {
      console.log(`[skip] ${item.analysisId} has invalid final_result`);
      continue;
    }
    console.error(`[error] ${item.analysisId}: ${item.error || 'unknown'}`);
  }

  console.log(
    `[backfill] completed. success=${summary.success}, skipped=${summary.skipped}, failed=${summary.failed}, total=${summary.total}`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[backfill] fatal:', error?.message || error);
  process.exitCode = 1;
});
