import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let dbInstance = null;

function resolveDbPath() {
  return (
    process.env.STORYFORGE_JOB_DB_PATH ||
    path.resolve(process.cwd(), 'data', 'storyforge-jobs.sqlite')
  );
}

export function getJobsDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  return dbInstance;
}

export function initJobSchema() {
  const db = getJobsDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      progress_message TEXT,
      input_data TEXT NOT NULL,
      output_data TEXT,
      error_message TEXT,
      error_stack TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      priority INTEGER DEFAULT 0,
      worker_id TEXT
    );

    CREATE TABLE IF NOT EXISTS job_steps (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      message TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      UNIQUE (job_id, step_name)
    );

    CREATE TABLE IF NOT EXISTS job_dependencies (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      depends_on_job_id TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created
      ON jobs(status, priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_job_steps_job_id
      ON job_steps(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_dependencies_job_id
      ON job_dependencies(job_id);
  `);
}

