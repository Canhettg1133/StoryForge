import { initCorpusSchema, getCorpusDb } from '../../corpus/db/schema.js';
import { parseJsonField } from '../outputChunker.js';
import { persistIncidentFirstArtifacts } from '../incidentFirstPersistence.js';
import { createCorpusDbBackup } from './backupAutomation.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseBackfillArgs(argv = []) {
  const args = {
    corpusId: null,
    analysisId: null,
    force: false,
    backup: true,
    keepLastBackups: 20,
    limit: 0,
    dryRun: false,
    dbPath: null,
    backupRoot: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index]);
    if (!token) continue;

    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '--no-backup') {
      args.backup = false;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if ((token === '--corpus' || token === '--corpus-id') && argv[index + 1]) {
      args.corpusId = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if ((token === '--analysis' || token === '--analysis-id') && argv[index + 1]) {
      args.analysisId = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--limit' && argv[index + 1]) {
      args.limit = Math.max(0, Math.floor(toNumber(argv[index + 1], 0)));
      index += 1;
      continue;
    }
    if (token === '--db' && argv[index + 1]) {
      args.dbPath = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--backup-root' && argv[index + 1]) {
      args.backupRoot = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--keep-last' && argv[index + 1]) {
      args.keepLastBackups = Math.max(1, Math.floor(toNumber(argv[index + 1], 20)));
      index += 1;
      continue;
    }
  }

  return args;
}

function buildWhereClause(args) {
  const where = ['final_result IS NOT NULL'];
  const params = {};

  if (args.corpusId) {
    where.push('corpus_id = @corpusId');
    params.corpusId = args.corpusId;
  }

  if (args.analysisId) {
    where.push('id = @analysisId');
    params.analysisId = args.analysisId;
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function listTargetAnalyses(db, args) {
  const { whereSql, params } = buildWhereClause(args);
  const limitSql = args.limit > 0 ? 'LIMIT @limit' : '';
  return db.prepare(`
    SELECT id, corpus_id, status, final_result
    FROM corpus_analyses
    ${whereSql}
    ORDER BY created_at DESC
    ${limitSql}
  `).all({
    ...params,
    ...(args.limit > 0 ? { limit: args.limit } : {}),
  });
}

function getExistingArtifactCounts(db, analysisId) {
  const getCount = (table) => db.prepare(`
    SELECT COUNT(1) AS total
    FROM ${table}
    WHERE analysis_id = ?
  `).get(analysisId)?.total || 0;

  return {
    incidents: Number(getCount('incidents')),
    events: Number(getCount('analysis_events')),
    locations: Number(getCount('analysis_locations')),
    risks: Number(getCount('consistency_risks')),
    reviewQueue: Number(getCount('review_queue')),
  };
}

function hasIncidentArtifacts(counts) {
  return (
    counts.incidents > 0
    || counts.events > 0
    || counts.locations > 0
    || counts.risks > 0
    || counts.reviewQueue > 0
  );
}

export async function runIncidentFirstBackfill(rawArgs = {}) {
  const args = {
    ...parseBackfillArgs([]),
    ...rawArgs,
  };

  if (args.dbPath) {
    process.env.STORYFORGE_CORPUS_DB_PATH = args.dbPath;
  }

  initCorpusSchema();
  const db = getCorpusDb();

  let backupResult = null;
  if (args.backup) {
    backupResult = createCorpusDbBackup({
      dbPath: args.dbPath || null,
      backupRoot: args.backupRoot || null,
      tag: 'incident_backfill',
    });
  }

  const targets = listTargetAnalyses(db, args);
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const details = [];

  for (const row of targets) {
    const counts = getExistingArtifactCounts(db, row.id);
    const shouldSkip = hasIncidentArtifacts(counts) && !args.force;

    if (shouldSkip) {
      skipped += 1;
      details.push({
        analysisId: row.id,
        status: 'skipped_existing',
        counts,
      });
      continue;
    }

    const result = parseJsonField(row.final_result, null);
    if (!result || typeof result !== 'object') {
      skipped += 1;
      details.push({
        analysisId: row.id,
        status: 'skipped_invalid_result',
      });
      continue;
    }

    if (args.dryRun) {
      success += 1;
      details.push({
        analysisId: row.id,
        status: 'dry_run',
      });
      continue;
    }

    try {
      const persisted = await persistIncidentFirstArtifacts({
        corpusId: row.corpus_id,
        analysisId: row.id,
        result,
      });
      success += 1;
      details.push({
        analysisId: row.id,
        status: 'ok',
        counts: persisted.counts || null,
      });
    } catch (error) {
      failed += 1;
      details.push({
        analysisId: row.id,
        status: 'failed',
        error: error?.message || 'Unknown error',
      });
    }
  }

  return {
    success,
    skipped,
    failed,
    total: targets.length,
    backup: backupResult,
    details,
  };
}

export default {
  parseBackfillArgs,
  runIncidentFirstBackfill,
};
