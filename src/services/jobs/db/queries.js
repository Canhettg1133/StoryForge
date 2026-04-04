import { randomUUID } from 'node:crypto';
import { JOB_PRIORITY, JOB_STATUS } from '../config.js';
import { getJobsDb } from './schema.js';

function serializeJson(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson(value) {
  if (value == null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapStepRow(row) {
  return {
    id: row.id,
    name: row.step_name,
    status: row.status,
    progress: row.progress,
    message: row.message,
  };
}

function mapJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    progressMessage: row.progress_message,
    inputData: parseJson(row.input_data),
    outputData: parseJson(row.output_data),
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    priority: row.priority,
    workerId: row.worker_id,
  };
}

function clampProgress(progress) {
  const parsed = Number(progress);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

const JOB_UPDATE_FIELDS = {
  status: ['status', (value) => value],
  progress: ['progress', (value) => clampProgress(value)],
  progressMessage: ['progress_message', (value) => value ?? null],
  inputData: ['input_data', (value) => serializeJson(value)],
  outputData: ['output_data', (value) => serializeJson(value)],
  errorMessage: ['error_message', (value) => value ?? null],
  errorStack: ['error_stack', (value) => value ?? null],
  startedAt: ['started_at', (value) => value ?? null],
  completedAt: ['completed_at', (value) => value ?? null],
  priority: ['priority', (value) => Number(value) || 0],
  workerId: ['worker_id', (value) => value ?? null],
};

export function createJobRecord({
  type,
  inputData,
  dependsOn = [],
  priority = JOB_PRIORITY.NORMAL,
}) {
  const db = getJobsDb();
  const now = Date.now();
  const jobId = randomUUID();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO jobs (
        id, type, status, progress, progress_message, input_data, output_data,
        error_message, error_stack, created_at, updated_at, started_at,
        completed_at, priority, worker_id
      ) VALUES (
        @id, @type, @status, @progress, @progressMessage, @inputData, @outputData,
        @errorMessage, @errorStack, @createdAt, @updatedAt, @startedAt,
        @completedAt, @priority, @workerId
      )
    `).run({
      id: jobId,
      type,
      status: JOB_STATUS.PENDING,
      progress: 0,
      progressMessage: null,
      inputData: serializeJson(inputData),
      outputData: null,
      errorMessage: null,
      errorStack: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      priority: Number(priority) || 0,
      workerId: null,
    });

    if (Array.isArray(dependsOn)) {
      const insertDependency = db.prepare(`
        INSERT INTO job_dependencies (id, job_id, depends_on_job_id)
        VALUES (@id, @jobId, @dependsOnJobId)
      `);

      for (const dependencyId of dependsOn) {
        insertDependency.run({
          id: randomUUID(),
          jobId,
          dependsOnJobId: dependencyId,
        });
      }
    }
  });

  tx();

  return getJobById(jobId);
}

export function getJobById(jobId) {
  const db = getJobsDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!row) {
    return null;
  }

  const steps = db
    .prepare(`
      SELECT id, step_name, status, progress, message
      FROM job_steps
      WHERE job_id = ?
      ORDER BY rowid ASC
    `)
    .all(jobId)
    .map(mapStepRow);

  return {
    ...mapJobRow(row),
    steps,
  };
}

export function listJobs({
  status,
  type,
  limit = 20,
  offset = 0,
} = {}) {
  const db = getJobsDb();
  const where = [];
  const params = {};

  if (status) {
    where.push('status = @status');
    params.status = status;
  }

  if (type) {
    where.push('type = @type');
    params.type = type;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const rows = db
    .prepare(`
      SELECT *
      FROM jobs
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({
      ...params,
      limit: safeLimit,
      offset: safeOffset,
    });

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM jobs
      ${whereSql}
    `)
    .get(params);

  return {
    jobs: rows.map(mapJobRow),
    total: Number(totalRow?.total ?? 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function updateJobRecord(jobId, updates = {}) {
  const db = getJobsDb();
  const params = { jobId, updatedAt: Date.now() };
  const setClauses = [];

  for (const [field, value] of Object.entries(updates)) {
    if (!(field in JOB_UPDATE_FIELDS) || value === undefined) {
      continue;
    }

    const [column, transformer] = JOB_UPDATE_FIELDS[field];
    setClauses.push(`${column} = @${field}`);
    params[field] = transformer(value);
  }

  if (setClauses.length === 0) {
    return getJobById(jobId);
  }

  setClauses.push('updated_at = @updatedAt');

  const result = db
    .prepare(`
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = @jobId
    `)
    .run(params);

  if (result.changes === 0) {
    return null;
  }

  return getJobById(jobId);
}

export function upsertJobStep({
  jobId,
  stepName,
  status = 'pending',
  progress = 0,
  message = null,
}) {
  const db = getJobsDb();
  const stepId = `${jobId}:${stepName}`;

  db.prepare(`
    INSERT INTO job_steps (id, job_id, step_name, status, progress, message)
    VALUES (@id, @jobId, @stepName, @status, @progress, @message)
    ON CONFLICT(job_id, step_name) DO UPDATE SET
      status = excluded.status,
      progress = excluded.progress,
      message = excluded.message
  `).run({
    id: stepId,
    jobId,
    stepName,
    status,
    progress: clampProgress(progress),
    message,
  });
}

export function listRunnablePendingJobs(limit = 100) {
  const db = getJobsDb();
  const rows = db
    .prepare(`
      SELECT j.*
      FROM jobs j
      WHERE j.status = @pending
        AND NOT EXISTS (
          SELECT 1
          FROM job_dependencies d
          LEFT JOIN jobs dep ON dep.id = d.depends_on_job_id
          WHERE d.job_id = j.id
            AND (dep.status IS NULL OR dep.status != @completed)
        )
      ORDER BY j.priority DESC, j.created_at ASC
      LIMIT @limit
    `)
    .all({
      pending: JOB_STATUS.PENDING,
      completed: JOB_STATUS.COMPLETED,
      limit: Math.max(1, Number(limit) || 100),
    });

  return rows.map(mapJobRow);
}

export function assignJobToWorker(jobId, workerId) {
  const db = getJobsDb();
  const now = Date.now();

  const result = db
    .prepare(`
      UPDATE jobs
      SET status = @running,
          worker_id = @workerId,
          started_at = COALESCE(started_at, @now),
          updated_at = @now
      WHERE id = @jobId
        AND status = @pending
    `)
    .run({
      running: JOB_STATUS.RUNNING,
      workerId,
      now,
      jobId,
      pending: JOB_STATUS.PENDING,
    });

  if (result.changes === 0) {
    return null;
  }

  return getJobById(jobId);
}

export function getRunningJobStats() {
  const db = getJobsDb();
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS running_count,
        SUM(CASE WHEN type = 'corpus_analysis' THEN 1 ELSE 0 END) AS running_analysis_count
      FROM jobs
      WHERE status = @running
    `)
    .get({ running: JOB_STATUS.RUNNING });

  return {
    runningCount: Number(row?.running_count ?? 0),
    runningAnalysisCount: Number(row?.running_analysis_count ?? 0),
  };
}

export function countQueuedAndRunningJobs() {
  const db = getJobsDb();
  const row = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM jobs
      WHERE status IN (@pending, @running)
    `)
    .get({
      pending: JOB_STATUS.PENDING,
      running: JOB_STATUS.RUNNING,
    });

  return Number(row?.total ?? 0);
}

