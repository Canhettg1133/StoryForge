/**
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function buildSampleFinalResult() {
  return {
    meta: { runMode: 'balanced' },
    incidents: [
      {
        id: 'inc-fixture-1',
        title: 'Lam tham bi dich chuyen den nha tro',
        type: 'major_plot_point',
        chapterStartIndex: 1,
        chapterEndIndex: 1,
        confidence: 0.91,
        evidence: ['Nhan vat bi dich chuyen den So 18 Nha Tro.'],
        containedEvents: ['evt-fixture-1'],
      },
    ],
    events: {
      majorEvents: [
        {
          id: 'evt-fixture-1',
          title: 'Bi dich chuyen',
          description: 'Lam Tham bi dich chuyen den So 18 Nha Tro va nhan ra bat thuong.',
          chapter: 1,
          severity: 'major',
          confidence: 0.83,
          incidentId: 'inc-fixture-1',
          locationLink: {
            locationName: 'So 18 Nha Tro',
            confidence: 0.82,
          },
          evidence: ['So 18 Nha Tro xuat hien ngay dau truyen.'],
        },
      ],
      minorEvents: [],
      plotTwists: [],
      cliffhangers: [],
    },
    locations: [
      {
        id: 'loc-fixture-1',
        name: 'So 18 Nha Tro',
        confidence: 0.82,
        incidentIds: ['inc-fixture-1'],
        eventIds: ['evt-fixture-1'],
        evidence: ['So 18 Nha Tro xuat hien trong chuong 1.'],
      },
    ],
    consistencyRisks: [],
  };
}

async function seedAnalysisFixture({ dbPath, corpusId, analysisId, finalResult }) {
  process.env.STORYFORGE_CORPUS_DB_PATH = dbPath;
  vi.resetModules();

  const { initCorpusSchema, getCorpusDb } = await import('../../services/corpus/db/schema.js');
  const { insertCorpusGraph } = await import('../../services/corpus/db/queries.js');
  const { createCorpusAnalysis, updateCorpusAnalysis } = await import('../../services/analysis/db/queries.js');

  initCorpusSchema();
  const db = getCorpusDb();
  const now = Date.now();

  insertCorpusGraph(
    {
      id: corpusId,
      title: 'Corpus Fixture',
      author: 'Tester',
      sourceFile: 'fixture.txt',
      fileType: 'txt',
      fandom: 'test',
      fandomConfidence: 1,
      isCanonFanfic: 'unknown',
      rating: 'T',
      language: 'vi',
      chunkSize: 700,
      chunkSizeUsed: 700,
      chunkCount: 1,
      lastRechunkedAt: now,
      wordCount: 240,
      chapterCount: 1,
      status: 'uploaded',
      createdAt: now,
      updatedAt: now,
    },
    [
      {
        id: `${corpusId}-ch-1`,
        corpusId,
        index: 1,
        title: 'Chapter 1',
        content: 'Lam Tham bi dich chuyen den So 18 Nha Tro.',
        wordCount: 240,
        startLine: null,
        endLine: null,
        startPage: null,
        endPage: null,
      },
    ],
    [
      {
        id: `${corpusId}-chunk-1`,
        chapterId: `${corpusId}-ch-1`,
        corpusId,
        index: 1,
        text: 'Lam Tham bi dich chuyen den So 18 Nha Tro.',
        wordCount: 240,
        startPosition: 0,
        startWord: 'Lam',
        endWord: 'Tro',
      },
    ],
  );

  createCorpusAnalysis({
    id: analysisId,
    corpusId,
    status: 'completed',
    level0Status: 'completed',
    level1Status: 'completed',
    level2Status: 'completed',
    progress: 1,
    currentPhase: 'completed',
    totalChunks: 1,
    processedChunks: 1,
    provider: 'gemini_proxy',
    model: 'gemini-2.5-flash',
    temperature: 0.2,
    chunkSize: 700,
    chunkOverlap: 0,
    partsGenerated: 1,
    errorMessage: null,
    createdAt: now,
    startedAt: now,
    completedAt: now,
  });

  updateCorpusAnalysis(analysisId, {
    finalResult: JSON.stringify(finalResult),
    status: 'completed',
    currentPhase: 'completed',
    completedAt: now,
  });

  db.close();
}

function getTableCount(dbPath, tableName, analysisId) {
  const db = new Database(dbPath);
  const row = db.prepare(`
    SELECT COUNT(1) AS total
    FROM ${tableName}
    WHERE analysis_id = ?
  `).get(analysisId);
  db.close();
  return Number(row?.total || 0);
}

describe('Phase 6C - Migration/Backfill/Backup automation', () => {
  afterEach(() => {
    delete process.env.STORYFORGE_CORPUS_DB_PATH;
    vi.restoreAllMocks();
  });

  it('unit: backup utility creates sqlite + sidecar manifest and prunes old groups', async () => {
    const root = makeTempDir('storyforge-backup-unit-');
    const sourceDbPath = path.join(root, 'storyforge-corpus.sqlite');
    fs.writeFileSync(sourceDbPath, 'db-bytes', 'utf8');
    fs.writeFileSync(`${sourceDbPath}-wal`, 'wal-bytes', 'utf8');
    fs.writeFileSync(`${sourceDbPath}-shm`, 'shm-bytes', 'utf8');

    const { createCorpusDbBackup, pruneOldBackups } = await import('../../services/analysis/maintenance/backupAutomation.js');

    const backupA = createCorpusDbBackup({
      dbPath: sourceDbPath,
      backupRoot: path.join(root, 'backups'),
      tag: 'unit',
    });
    expect(backupA.files.length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(backupA.manifestPath)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    createCorpusDbBackup({
      dbPath: sourceDbPath,
      backupRoot: path.join(root, 'backups'),
      tag: 'unit',
    });

    const pruned = pruneOldBackups({
      backupRoot: path.join(root, 'backups'),
      baseName: 'storyforge-corpus',
      keepLast: 1,
    });
    expect(Array.isArray(pruned.removed)).toBe(true);
    expect(pruned.removed.length).toBeGreaterThan(0);
  });

  it('integration: backfill automation persists incidents/events/locations from final_result', async () => {
    const root = makeTempDir('storyforge-backfill-int-');
    const dbPath = path.join(root, 'corpus.sqlite');
    const corpusId = 'corpus-int-1';
    const analysisId = 'analysis-int-1';
    const finalResult = buildSampleFinalResult();

    await seedAnalysisFixture({
      dbPath,
      corpusId,
      analysisId,
      finalResult,
    });

    process.env.STORYFORGE_CORPUS_DB_PATH = dbPath;
    vi.resetModules();
    const { runIncidentFirstBackfill } = await import('../../services/analysis/maintenance/backfillAutomation.js');

    const summary = await runIncidentFirstBackfill({
      analysisId,
      backup: false,
      force: true,
    });

    expect(summary.failed).toBe(0);
    expect(summary.success).toBe(1);

    expect(getTableCount(dbPath, 'incidents', analysisId)).toBeGreaterThan(0);
    expect(getTableCount(dbPath, 'analysis_events', analysisId)).toBeGreaterThan(0);
    expect(getTableCount(dbPath, 'analysis_locations', analysisId)).toBeGreaterThan(0);
  });

  it('e2e: phase6 maintenance script runs backup + backfill end-to-end', async () => {
    const root = makeTempDir('storyforge-backfill-e2e-');
    const dbPath = path.join(root, 'corpus.sqlite');
    const backupRoot = path.join(root, 'backups');
    const corpusId = 'corpus-e2e-1';
    const analysisId = 'analysis-e2e-1';
    const finalResult = buildSampleFinalResult();

    await seedAnalysisFixture({
      dbPath,
      corpusId,
      analysisId,
      finalResult,
    });

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'phase6-maintenance.js');
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--db',
        dbPath,
        '--backup-root',
        backupRoot,
        '--analysis',
        analysisId,
        '--force',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(output).toContain('success=1');

    const backupFiles = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot) : [];
    expect(backupFiles.some((name) => name.endsWith('.sqlite'))).toBe(true);
    expect(backupFiles.some((name) => name.endsWith('.json'))).toBe(true);

    expect(getTableCount(dbPath, 'incidents', analysisId)).toBeGreaterThan(0);
    expect(getTableCount(dbPath, 'analysis_events', analysisId)).toBeGreaterThan(0);
    expect(getTableCount(dbPath, 'analysis_locations', analysisId)).toBeGreaterThan(0);
  });
});
