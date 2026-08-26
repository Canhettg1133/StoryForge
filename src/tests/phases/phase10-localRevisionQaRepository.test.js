import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../services/db/database.js';
import {
  loadLatestAnalysisRun,
  saveLatestAnalysisRun,
  updateFindingStatus,
} from '../../services/revisionQa/reportRepository.js';

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

function makeRun(runId, findings = []) {
  return {
    analysis_run_id: runId,
    scope: 'scene',
    scope_key: 'scene:101',
    profile: 'overview',
    config_signature: 'sha256:config',
    source_signatures: { 101: 'sha256:source' },
    metrics: { words: 12, sentences: 2, paragraphs: 1 },
    findings,
    created_at: runId === 'run-new' ? 2 : 1,
  };
}

function makeFinding(id) {
  return {
    id,
    engine: 'local',
    rule_id: 'MULTIPLE_SPACES',
    category: 'format',
    severity: 'low',
    confidence: 1,
    confidence_basis: 'exact_match',
    project_id: 1,
    chapter_id: 11,
    scene_id: 101,
    evidence: '  ',
    explanation: 'Có nhiều khoảng trắng liên tiếp.',
    replacement: { text: ' ', kind: 'mechanical', editable: true },
    anchor: { quote: '  ', prefix: 'cửa', suffix: 'khép', occurrence: 1, from: 4, to: 6 },
    source_signature: 'sha256:source',
    config_signature: 'sha256:config',
    status: 'open',
  };
}

describe('local Revision QA report repository', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
  });

  it('persists a clean run so reload still knows analysis completed', async () => {
    await saveLatestAnalysisRun({ projectId: 1, chapterId: 11, run: makeRun('run-empty') });

    const loaded = await loadLatestAnalysisRun({ projectId: 1, scopeKey: 'scene:101' });
    expect(loaded.analysis_run_id).toBe('run-empty');
    expect(loaded.findings).toEqual([]);
  });

  it('replaces the previous run only after the new run is available', async () => {
    await saveLatestAnalysisRun({
      projectId: 1,
      chapterId: 11,
      run: makeRun('run-old', [makeFinding('old-finding')]),
    });
    await saveLatestAnalysisRun({
      projectId: 1,
      chapterId: 11,
      run: makeRun('run-new', [makeFinding('new-finding')]),
    });

    const loaded = await loadLatestAnalysisRun({ projectId: 1, scopeKey: 'scene:101' });
    expect(loaded.analysis_run_id).toBe('run-new');
    expect(loaded.findings.map((item) => item.id)).toEqual(['new-finding']);
  });

  it('persists ignored and accepted status independently per finding', async () => {
    await saveLatestAnalysisRun({
      projectId: 1,
      chapterId: 11,
      run: makeRun('run-new', [makeFinding('first'), makeFinding('second')]),
    });

    await updateFindingStatus({ findingId: 'first', status: 'ignored' });
    await updateFindingStatus({ findingId: 'second', status: 'accepted' });

    const loaded = await loadLatestAnalysisRun({ projectId: 1, scopeKey: 'scene:101' });
    expect(loaded.findings.find((item) => item.id === 'first').status).toBe('ignored');
    expect(loaded.findings.find((item) => item.id === 'second').status).toBe('accepted');
  });

  it('rolls back replacement when the new run cannot be cloned', async () => {
    await saveLatestAnalysisRun({
      projectId: 1,
      chapterId: 11,
      run: makeRun('run-old', [makeFinding('old-finding')]),
    });
    const invalidFinding = makeFinding('invalid');
    invalidFinding.uncloneable = () => {};

    await expect(saveLatestAnalysisRun({
      projectId: 1,
      chapterId: 11,
      run: makeRun('run-new', [invalidFinding]),
    })).rejects.toBeTruthy();

    const loaded = await loadLatestAnalysisRun({ projectId: 1, scopeKey: 'scene:101' });
    expect(loaded.analysis_run_id).toBe('run-old');
    expect(loaded.findings.map((item) => item.id)).toEqual(['old-finding']);
  });
});
