import db from '../db/database.js';

const FEATURE = 'local_revision_qa';

function toStoredFinding(finding, scopeKey, createdAt, analysisRunId) {
  const { id: findingKey, ...data } = finding;
  return {
    ...data,
    feature: FEATURE,
    record_kind: 'finding',
    finding_key: findingKey,
    analysis_run_id: analysisRunId,
    scope_key: scopeKey,
    report_type: finding.category,
    created_at: createdAt,
  };
}

function fromStoredFinding(row) {
  const { id: _databaseId, finding_key: findingKey, feature: _feature, record_kind: _recordKind, scope_key: _scopeKey, report_type: _reportType, ...data } = row;
  return { ...data, id: findingKey };
}

async function rowsForScope(projectId, scopeKey) {
  return db.qaReports
    .where('project_id')
    .equals(projectId)
    .filter((row) => row.feature === FEATURE && row.scope_key === scopeKey)
    .toArray();
}

export async function saveLatestAnalysisRun({ projectId, chapterId, run }) {
  if (!run?.analysis_run_id || !run?.scope_key) throw new Error('Analysis run and scope key are required.');
  const createdAt = run.created_at ?? Date.now();

  await db.transaction('rw', db.qaReports, async () => {
    const oldRows = await rowsForScope(projectId, run.scope_key);
    if (oldRows.length) await db.qaReports.bulkDelete(oldRows.map((row) => row.id));

    const summary = {
      feature: FEATURE,
      record_kind: 'summary',
      project_id: projectId,
      chapter_id: chapterId,
      scene_id: null,
      report_type: 'local_run',
      severity: 'none',
      analysis_run_id: run.analysis_run_id,
      scope: run.scope,
      scope_key: run.scope_key,
      profile: run.profile,
      config_signature: run.config_signature,
      source_signatures: run.source_signatures || run.sourceSignatures || {},
      metrics: run.metrics || {},
      created_at: createdAt,
    };
    await db.qaReports.add(summary);
    if (run.findings?.length) {
      await db.qaReports.bulkAdd(run.findings.map((finding) => (
        toStoredFinding(finding, run.scope_key, createdAt, run.analysis_run_id)
      )));
    }
  });
}

export async function loadLatestAnalysisRun({ projectId, scopeKey }) {
  const rows = await rowsForScope(projectId, scopeKey);
  const summaries = rows
    .filter((row) => row.record_kind === 'summary')
    .sort((left, right) => Number(right.created_at) - Number(left.created_at));
  const summary = summaries[0];
  if (!summary) return null;

  return {
    analysis_run_id: summary.analysis_run_id,
    scope: summary.scope,
    scope_key: summary.scope_key,
    profile: summary.profile,
    config_signature: summary.config_signature,
    source_signatures: summary.source_signatures || {},
    metrics: summary.metrics || {},
    created_at: summary.created_at,
    findings: rows
      .filter((row) => row.record_kind === 'finding' && row.analysis_run_id === summary.analysis_run_id)
      .map(fromStoredFinding),
  };
}

export async function updateFindingStatus({ findingId, status }) {
  const validStatuses = new Set(['open', 'ignored', 'accepted', 'stale']);
  if (!validStatuses.has(status)) throw new Error(`Unsupported finding status: ${status}`);
  const row = await db.qaReports.filter((item) => item.feature === FEATURE && item.finding_key === findingId).first();
  if (!row) return false;
  await db.qaReports.update(row.id, {
    status,
    resolved_at: status === 'open' ? null : Date.now(),
  });
  return true;
}
