import Dexie from 'dexie';
import dbDefault from '../db/database.js';
import { normalizeEntityIdentity } from '../entityIdentity/index.js';
import { createCodexToolRuntime } from './codexToolRuntime.js';
import { runEntityResolutionAgent } from './entityResolutionAgent.js';
import { buildCodexAnalysisSnapshot } from './codexAnalysisSnapshot.js';

export { buildCodexAnalysisSnapshot } from './codexAnalysisSnapshot.js';

export const CODEX_JOB_TYPE = 'codex_entity_resolution';
export const CODEX_RUNTIME_FLAG_KEY = 'sf-codex-tool-runtime-enabled';

const MAX_BROWSER_JOBS = 2;
const ACTIVE_JOB_STATUSES = new Set(['waiting_canon', 'queued', 'running', 'retryable_error', 'paused_feature_flag']);
const INTERRUPTED_JOB_AFTER_MS = 180_000;
const pendingJobIds = [];
const activeProjectIds = new Set();
let activeJobCount = 0;
let draining = false;

function queueCodexDrain() {
  queueMicrotask(() => {
    drainCodexJobs().catch(() => {});
  });
}

function proposedChangePayload(changes = []) {
  return changes.reduce((payload, change) => {
    payload[change.field] = change.value;
    return payload;
  }, {});
}

function buildCandidateRow(job, snapshot, decision, now) {
  const identity = normalizeEntityIdentity(decision.entity_kind, {
    name: decision.extracted_name,
    aliases: decision.aliases,
  });
  return {
    project_id: job.project_id,
    chapter_id: job.chapter_id,
    revision_id: job.revision_id || null,
    job_id: job.id,
    session_key: `codex-job:${job.id}`,
    entity_kind: decision.entity_kind,
    source_type: 'codex_tool_resolution',
    source_ref: `chapter:${job.chapter_id}`,
    source_hash: snapshot.sourceHash,
    catalog_revision: snapshot.catalogRevision,
    raw_name: decision.extracted_name,
    normalized_name: identity.normalized_name,
    aliases: decision.aliases,
    alias_keys: identity.alias_keys,
    identity_key: identity.identity_key,
    payload_json: JSON.stringify({
      name: decision.canonical_name || decision.extracted_name,
      aliases: decision.aliases,
      role_hint: decision.role_hint,
      ...proposedChangePayload(decision.proposed_changes),
      proposed_changes: decision.proposed_changes,
      evidence: decision.evidence,
      resolver_decision: decision.decision,
      target_entity_ids: decision.target_entity_ids,
      critic: decision.critic,
      risk_flags: decision.risk_flags,
    }),
    resolution_status: 'pending_review',
    matched_entity_id: decision.target_entity_ids.length === 1 ? decision.target_entity_ids[0] : null,
    resolver_debug_json: JSON.stringify({
      match_tier: decision.match_tier,
      protected_field_changes: decision.protected_field_changes,
      review_safety: decision.review_safety,
      review_reasons: decision.review_reasons,
    }),
    created_at: now,
    updated_at: now,
  };
}

function buildSuggestionRow(job, snapshot, decision, candidateId, now) {
  return {
    project_id: job.project_id,
    type: 'entity_resolution',
    status: 'pending',
    job_id: job.id,
    source_chapter_id: job.chapter_id,
    source_scene_id: null,
    target_id: decision.target_entity_ids.length === 1 ? decision.target_entity_ids[0] : null,
    target_name: decision.extracted_name,
    current_value: '',
    suggested_value: decision.decision === 'create_new' ? 'Create new entity' : 'Review entity identity',
    reasoning: decision.reasoning,
    review_safety: decision.review_safety,
    quick_approve: Boolean(decision.quick_approve),
    candidate_op: JSON.stringify({
      candidate_ids: [candidateId],
      entity_kind: decision.entity_kind,
      raw_name: decision.extracted_name,
      recommended_action: decision.decision,
      recommended_target_id: decision.target_entity_ids.length === 1 ? decision.target_entity_ids[0] : null,
      resolution_options: decision.target_entity_ids.map((entityId) => ({
        entity_id: entityId,
        name: snapshot.entities.find((entity) => (
          entity.id === entityId && entity.entity_kind === decision.entity_kind
        ))?.name || `Entity #${entityId}`,
      })),
      evidence: decision.evidence,
      canonical_name: decision.canonical_name,
      aliases: decision.aliases,
      role_hint: decision.role_hint,
      proposed_changes: decision.proposed_changes,
      critic: decision.critic,
      risk_flags: decision.risk_flags,
      protected_field_changes: decision.protected_field_changes,
      review_safety: decision.review_safety,
      quick_approve: Boolean(decision.quick_approve),
      review_reasons: decision.review_reasons,
      source_hash: snapshot.sourceHash,
      catalog_revision: snapshot.catalogRevision,
      revision_id: job.revision_id || null,
    }),
    created_at: now,
  };
}

export async function stageCodexResolutionPlan({
  db = dbDefault,
  job,
  snapshot,
  plan,
  verifySnapshotBuilder = null,
}) {
  if (plan.source_hash !== snapshot.sourceHash || plan.catalog_revision !== snapshot.catalogRevision) {
    const error = new Error('Codex plan is stale and cannot be staged.');
    error.code = 'CODEX_JOB_STALE';
    throw error;
  }
  const now = Date.now();
  const candidateRows = plan.decisions.map((decision) => buildCandidateRow(job, snapshot, decision, now));
  const transactionTables = [
    db.entity_resolution_candidates,
    db.suggestions,
    ...(verifySnapshotBuilder ? [
      db.chapters,
      db.scenes,
      db.characters,
      db.locations,
      db.objects,
      db.worldTerms,
      db.relationships,
      db.entityTimeline,
      db.entity_state_current,
      db.item_state_current,
      db.story_events,
      db.canonFacts,
      db.memory_evidence,
    ] : []),
  ].filter(Boolean);
  return db.transaction(
    'rw',
    ...transactionTables,
    async () => {
      if (verifySnapshotBuilder) {
        const verification = verifySnapshotBuilder({
          db,
          projectId: job.project_id,
          chapterId: job.chapter_id,
        });
        const latest = Dexie.currentTransaction
          ? await Dexie.waitFor(verification)
          : await verification;
        if (latest.sourceHash !== snapshot.sourceHash || latest.catalogRevision !== snapshot.catalogRevision) {
          const error = new Error('Codex source or Story Bible catalog changed before staging.');
          error.code = 'CODEX_JOB_STALE';
          throw error;
        }
      }
      const candidateIds = candidateRows.length > 0
        ? await db.entity_resolution_candidates.bulkAdd(candidateRows, undefined, { allKeys: true })
        : [];
      const suggestionRows = plan.decisions.map((decision, index) => (
        buildSuggestionRow(job, snapshot, decision, candidateIds[index], now)
      ));
      if (suggestionRows.length > 0) await db.suggestions.bulkAdd(suggestionRows);
      return {
        candidateCount: candidateRows.length,
        suggestionCount: suggestionRows.length,
      };
    },
  );
}

export function isCodexToolRuntimeEnabled() {
  try {
    return localStorage.getItem(CODEX_RUNTIME_FLAG_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setCodexToolRuntimeEnabled(enabled) {
  localStorage.setItem(CODEX_RUNTIME_FLAG_KEY, enabled ? 'true' : 'false');
}

async function findActiveChapterJob(db, projectId, chapterId) {
  const jobs = await db.aiJobs.where('project_id').equals(projectId)
    .filter((job) => (
      job.chapter_id === chapterId
      && job.job_type === CODEX_JOB_TYPE
      && ACTIVE_JOB_STATUSES.has(job.status)
    ))
    .toArray();
  return jobs.sort((left, right) => Number(right.id) - Number(left.id))[0] || null;
}

export async function enqueueCodexExtractionJob({
  projectId,
  chapterId,
  revisionId = null,
  canonPassed,
}, {
  db = dbDefault,
  schedule = true,
  buildSnapshot = buildCodexAnalysisSnapshot,
} = {}) {
  const now = Date.now();
  const existing = await findActiveChapterJob(db, projectId, chapterId);
  let snapshot = null;
  let snapshotError = null;
  if (canonPassed) {
    try {
      snapshot = await buildSnapshot({ db, projectId, chapterId });
    } catch (error) {
      snapshotError = error;
    }
  }
  const status = !canonPassed
    ? 'waiting_canon'
    : snapshotError
      ? 'retryable_error'
      : isCodexToolRuntimeEnabled()
        ? 'queued'
        : 'paused_feature_flag';
  const patch = {
    project_id: projectId,
    chapter_id: chapterId,
    revision_id: revisionId,
    scene_id: null,
    job_type: CODEX_JOB_TYPE,
    status,
    source_hash: snapshot?.sourceHash || existing?.source_hash || null,
    catalog_revision: snapshot?.catalogRevision || existing?.catalog_revision || null,
    error_code: snapshotError
      ? String(snapshotError?.code || 'CODEX_SNAPSHOT_FAILED').slice(0, 120)
      : '',
    updated_at: now,
  };
  let jobId = existing?.id || null;
  if (jobId) {
    await db.aiJobs.update(jobId, patch);
  } else {
    jobId = await db.aiJobs.add({
      ...patch,
      attempt_count: 0,
      resolver_turns: 0,
      critic_turns: 0,
      created_at: now,
    });
  }
  const job = await db.aiJobs.get(jobId);
  if (schedule && status === 'queued') scheduleCodexJob(jobId);
  return job;
}

function staleJobError() {
  const error = new Error('Codex source or Story Bible catalog changed during analysis.');
  error.code = 'CODEX_JOB_STALE';
  return error;
}

function summarizeCritic(plan) {
  return JSON.stringify(plan.decisions.map((decision) => ({
    candidate_key: decision.candidate_key,
    decision: decision.critic?.decision || 'review',
    review_safety: decision.review_safety,
    risk_count: decision.risk_flags?.length || 0,
  })));
}

export async function runCodexExtractionJob(jobId, {
  db = dbDefault,
  runAgent = runEntityResolutionAgent,
} = {}) {
  const job = await db.transaction('rw', db.aiJobs, async () => {
    const current = await db.aiJobs.get(jobId);
    if (!current || !['queued', 'retryable_error'].includes(current.status)) return null;
    const runningJobs = (await db.aiJobs.where('status').equals('running').toArray())
      .filter((item) => item.id !== jobId);
    if (runningJobs.length >= MAX_BROWSER_JOBS || runningJobs.some((item) => item.project_id === current.project_id)) {
      return null;
    }
    const startedAt = Date.now();
    await db.aiJobs.update(jobId, {
      status: 'running',
      attempt_count: Number(current.attempt_count || 0) + 1,
      started_at: startedAt,
      error_code: '',
      updated_at: startedAt,
    });
    return { ...current, status: 'running', started_at: startedAt };
  });
  if (!job) return db.aiJobs.get(jobId);

  try {
    const snapshot = await buildCodexAnalysisSnapshot({
      db,
      projectId: job.project_id,
      chapterId: job.chapter_id,
    });
    if (snapshot.sourceHash !== job.source_hash || snapshot.catalogRevision !== job.catalog_revision) {
      throw staleJobError();
    }
    const runtime = createCodexToolRuntime({
      projectId: job.project_id,
      chapterId: job.chapter_id,
      sourceHash: snapshot.sourceHash,
      catalogRevision: snapshot.catalogRevision,
      paragraphs: snapshot.paragraphs,
      entities: snapshot.entities.map((entity) => ({ ...entity, project_id: job.project_id })),
    });
    const result = await runAgent({ runtime });
    const latest = await buildCodexAnalysisSnapshot({
      db,
      projectId: job.project_id,
      chapterId: job.chapter_id,
    });
    if (latest.sourceHash !== snapshot.sourceHash || latest.catalogRevision !== snapshot.catalogRevision) {
      throw staleJobError();
    }
    const staged = await stageCodexResolutionPlan({
      db,
      job,
      snapshot,
      plan: result.plan,
      verifySnapshotBuilder: buildCodexAnalysisSnapshot,
    });
    await db.aiJobs.update(jobId, {
      status: staged.suggestionCount > 0 ? 'awaiting_review' : 'completed',
      resolver_turns: result.turns.resolver,
      critic_turns: result.turns.critic,
      candidate_count: staged.candidateCount,
      suggestion_count: staged.suggestionCount,
      critic_result_json: summarizeCritic(result.plan),
      error_code: '',
      finished_at: Date.now(),
      updated_at: Date.now(),
    });
  } catch (error) {
    const errorCode = String(error?.code || 'CODEX_JOB_FAILED').slice(0, 120);
    await db.aiJobs.update(jobId, {
      status: errorCode === 'CODEX_JOB_STALE' ? 'stale' : 'retryable_error',
      error_code: errorCode,
      finished_at: Date.now(),
      updated_at: Date.now(),
    });
  }
  return db.aiJobs.get(jobId);
}

async function drainCodexJobs() {
  if (draining) return;
  draining = true;
  try {
    while (activeJobCount < MAX_BROWSER_JOBS && pendingJobIds.length > 0) {
      let selectedIndex = -1;
      let selectedJob = null;
      for (let index = 0; index < pendingJobIds.length; index += 1) {
        const job = await dbDefault.aiJobs.get(pendingJobIds[index]);
        if (!job) continue;
        if (!activeProjectIds.has(job.project_id)) {
          selectedIndex = index;
          selectedJob = job;
          break;
        }
      }
      if (!selectedJob) break;
      pendingJobIds.splice(selectedIndex, 1);
      activeJobCount += 1;
      activeProjectIds.add(selectedJob.project_id);
      runCodexExtractionJob(selectedJob.id)
        .then((job) => {
          if (job?.status === 'queued') scheduleCodexJob(job.id);
        })
        .catch(() => {})
        .finally(() => {
          activeJobCount -= 1;
          activeProjectIds.delete(selectedJob.project_id);
          queueCodexDrain();
        });
    }
  } finally {
    draining = false;
  }
}

export function scheduleCodexJob(jobId) {
  if (!pendingJobIds.includes(jobId)) pendingJobIds.push(jobId);
  queueCodexDrain();
}

export async function resumeCodexExtractionJobs(projectId, {
  db = dbDefault,
  schedule = scheduleCodexJob,
  now = Date.now(),
} = {}) {
  if (!projectId) return [];
  const jobs = await db.aiJobs.where('project_id').equals(projectId)
    .filter((job) => job.job_type === CODEX_JOB_TYPE)
    .toArray();
  const resumable = [];
  for (const job of jobs) {
    if (job.status === 'running' && now - Number(job.started_at || 0) >= INTERRUPTED_JOB_AFTER_MS) {
      await db.aiJobs.update(job.id, {
        status: 'queued',
        error_code: 'CODEX_JOB_INTERRUPTED',
        updated_at: now,
      });
      resumable.push({ ...job, status: 'queued', error_code: 'CODEX_JOB_INTERRUPTED' });
    } else if (job.status === 'queued') {
      resumable.push(job);
    } else if (job.status === 'paused_feature_flag' && isCodexToolRuntimeEnabled()) {
      await db.aiJobs.update(job.id, { status: 'queued', error_code: '', updated_at: now });
      resumable.push({ ...job, status: 'queued', error_code: '' });
    }
  }
  resumable.forEach((job) => schedule(job.id));
  return resumable;
}

export async function retryCodexExtractionJob(jobId, { db = dbDefault, schedule = true } = {}) {
  const job = await db.aiJobs.get(jobId);
  if (!job || !['retryable_error', 'stale'].includes(job.status)) return job || null;
  const snapshot = await buildCodexAnalysisSnapshot({ db, projectId: job.project_id, chapterId: job.chapter_id });
  await db.aiJobs.update(jobId, {
    status: 'queued',
    source_hash: snapshot.sourceHash,
    catalog_revision: snapshot.catalogRevision,
    error_code: '',
    updated_at: Date.now(),
  });
  if (schedule) scheduleCodexJob(jobId);
  return db.aiJobs.get(jobId);
}
