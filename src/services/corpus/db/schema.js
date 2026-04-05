import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

let dbInstance = null;

function resolveModuleDefaultPath() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '..', '..', 'data', 'storyforge-corpus.sqlite');
}

function resolveDbPath() {
  const explicit = String(process.env.STORYFORGE_CORPUS_DB_PATH || '').trim();
  if (explicit) {
    return explicit;
  }

  const cwdCandidate = path.resolve(process.cwd(), 'data', 'storyforge-corpus.sqlite');
  const moduleCandidate = resolveModuleDefaultPath();

  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  if (fs.existsSync(moduleCandidate)) {
    return moduleCandidate;
  }

  return cwdCandidate;
}

function hasColumn(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row?.name === columnName);
}

function ensureColumn(db, tableName, columnDefinition) {
  const columnName = String(columnDefinition || '').trim().split(/\s+/u)[0];
  if (!columnName) {
    return;
  }

  if (hasColumn(db, tableName, columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
}

export function getCorpusDb() {
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

export function initCorpusSchema() {
  const db = getCorpusDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS corpuses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      source_file TEXT,
      file_type TEXT,
      fandom TEXT,
      fandom_confidence REAL,
      is_canon_fanfic TEXT,
      rating TEXT,
      language TEXT DEFAULT 'vi',
      chunk_size INTEGER DEFAULT 750,
      chunk_size_used INTEGER,
      chunk_count INTEGER DEFAULT 0,
      last_rechunked_at INTEGER,
      word_count INTEGER DEFAULT 0,
      chapter_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'uploaded',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      start_line INTEGER,
      end_line INTEGER,
      start_page INTEGER,
      end_page INTEGER,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      start_position INTEGER,
      start_word TEXT,
      end_word TEXT,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_corpuses_status_created
      ON corpuses(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_corpuses_fandom
      ON corpuses(fandom);
    CREATE INDEX IF NOT EXISTS idx_chapters_corpus_order
      ON chapters(corpus_id, chapter_index ASC);
    CREATE INDEX IF NOT EXISTS idx_chunks_chapter_order
      ON chunks(chapter_id, chunk_index ASC);
    CREATE INDEX IF NOT EXISTS idx_chunks_corpus
      ON chunks(corpus_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts (rowid, text)
      VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts (chunks_fts, rowid, text)
      VALUES ('delete', old.rowid, old.text);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts (chunks_fts, rowid, text)
      VALUES ('delete', old.rowid, old.text);

      INSERT INTO chunks_fts (rowid, text)
      VALUES (new.rowid, new.text);
    END;

    CREATE TABLE IF NOT EXISTS corpus_analyses (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      chunk_size INTEGER DEFAULT 750,
      chunk_overlap INTEGER DEFAULT 100,
      provider TEXT DEFAULT 'gemini_proxy',
      model TEXT,
      temperature REAL DEFAULT 0.2,
      status TEXT DEFAULT 'pending',
      level_0_status TEXT DEFAULT 'pending',
      level_1_status TEXT DEFAULT 'pending',
      level_2_status TEXT DEFAULT 'pending',
      result_l1 TEXT,
      result_l2 TEXT,
      result_l3 TEXT,
      result_l4 TEXT,
      result_l5 TEXT,
      result_l6 TEXT,
      final_result TEXT,
      total_chunks INTEGER DEFAULT 0,
      processed_chunks INTEGER DEFAULT 0,
      progress REAL DEFAULT 0,
      current_phase TEXT,
      parts_generated INTEGER DEFAULT 0,
      error_message TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunk_results (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chapter_id TEXT,
      processing_time_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      result TEXT,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_corpus
      ON corpus_analyses(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_status
      ON corpus_analyses(status);
    CREATE INDEX IF NOT EXISTS idx_analyses_created
      ON corpus_analyses(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chunk_results_analysis
      ON chunk_results(analysis_id, chunk_index);

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('major_plot_point', 'subplot', 'pov_thread')),
      description TEXT,
      start_chapter_id TEXT,
      start_chunk_id TEXT,
      end_chapter_id TEXT,
      end_chunk_id TEXT,
      chapter_start_index INTEGER,
      chapter_end_index INTEGER,
      chunk_start_index INTEGER,
      chunk_end_index INTEGER,
      start_anchor TEXT,
      active_span INTEGER,
      climax_anchor TEXT,
      end_anchor TEXT,
      boundary_note TEXT,
      uncertain_start INTEGER DEFAULT 0,
      uncertain_end INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      evidence TEXT,
      contained_events TEXT,
      sub_incident_ids TEXT,
      related_incidents TEXT,
      related_locations TEXT,
      causal_predecessors TEXT,
      causal_successors TEXT,
      major_score REAL DEFAULT 0,
      impact_score REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      review_status TEXT DEFAULT 'needs_review',
      priority TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      analyzed_at INTEGER,
      reviewed_at INTEGER,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_corpus
      ON incidents(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_analysis
      ON incidents(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_type
      ON incidents(type);
    CREATE INDEX IF NOT EXISTS idx_incidents_chapter_range
      ON incidents(chapter_start_index, chapter_end_index);
    CREATE INDEX IF NOT EXISTS idx_incidents_confidence
      ON incidents(confidence);
    CREATE INDEX IF NOT EXISTS idx_incidents_priority
      ON incidents(priority);
    CREATE INDEX IF NOT EXISTS idx_incidents_review_status
      ON incidents(review_status);

    CREATE TABLE IF NOT EXISTS analysis_events (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity REAL DEFAULT 0,
      tags TEXT,
      chapter_id TEXT,
      chapter_index INTEGER,
      chunk_id TEXT,
      chunk_index INTEGER,
      incident_id TEXT,
      link_role TEXT DEFAULT 'primary' CHECK (link_role IN ('primary', 'secondary')),
      secondary_incident_ids TEXT,
      location_link TEXT,
      causal_links TEXT,
      confidence REAL DEFAULT 0,
      evidence TEXT,
      quality_proxy INTEGER DEFAULT 0,
      review_status TEXT DEFAULT 'needs_review',
      needs_review INTEGER DEFAULT 1,
      annotation TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      grounded_at INTEGER,
      reviewed_at INTEGER,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_corpus
      ON analysis_events(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_events_analysis
      ON analysis_events(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_events_incident
      ON analysis_events(incident_id);
    CREATE INDEX IF NOT EXISTS idx_events_chapter
      ON analysis_events(chapter_index);
    CREATE INDEX IF NOT EXISTS idx_events_confidence
      ON analysis_events(confidence);
    CREATE INDEX IF NOT EXISTS idx_events_review_status
      ON analysis_events(review_status);

    CREATE TABLE IF NOT EXISTS analysis_locations (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized TEXT,
      aliases TEXT,
      mention_count INTEGER DEFAULT 0,
      chapter_start INTEGER,
      chapter_end INTEGER,
      chapter_spread TEXT,
      importance REAL DEFAULT 0,
      is_major INTEGER DEFAULT 0,
      tokens TEXT,
      evidence TEXT,
      incident_ids TEXT,
      event_ids TEXT,
      confidence REAL DEFAULT 0,
      evidence_strength REAL DEFAULT 0,
      review_status TEXT DEFAULT 'needs_review',
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      reviewed_at INTEGER,
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_locations_corpus
      ON analysis_locations(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_locations_analysis
      ON analysis_locations(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_locations_name
      ON analysis_locations(name);
    CREATE INDEX IF NOT EXISTS idx_analysis_locations_major
      ON analysis_locations(is_major);
    CREATE INDEX IF NOT EXISTS idx_analysis_locations_confidence
      ON analysis_locations(confidence);

    CREATE TABLE IF NOT EXISTS consistency_risks (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('hard', 'medium', 'soft')),
      description TEXT,
      details TEXT,
      involved_incidents TEXT,
      involved_events TEXT,
      involved_locations TEXT,
      evidence TEXT,
      chapter_start INTEGER,
      chapter_end INTEGER,
      resolved INTEGER DEFAULT 0,
      resolution TEXT,
      resolved_at INTEGER,
      detected_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_consistency_corpus
      ON consistency_risks(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_consistency_analysis
      ON consistency_risks(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_consistency_type
      ON consistency_risks(type);
    CREATE INDEX IF NOT EXISTS idx_consistency_severity
      ON consistency_risks(severity);
    CREATE INDEX IF NOT EXISTS idx_consistency_resolved
      ON consistency_risks(resolved);

    CREATE TABLE IF NOT EXISTS review_queue (
      id TEXT PRIMARY KEY,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK (item_type IN ('incident', 'event', 'location', 'consistency_risk')),
      item_id TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2')),
      priority_score REAL DEFAULT 0,
      score_breakdown TEXT,
      reason TEXT,
      suggestions TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'resolved', 'ignored')),
      reviewed_by TEXT,
      reviewed_at INTEGER,
      resolution TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      FOREIGN KEY (corpus_id) REFERENCES corpuses(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES corpus_analyses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_review_corpus
      ON review_queue(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_review_analysis
      ON review_queue(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_review_priority
      ON review_queue(priority);
    CREATE INDEX IF NOT EXISTS idx_review_status
      ON review_queue(status);
    CREATE INDEX IF NOT EXISTS idx_review_item
      ON review_queue(item_type, item_id);
  `);

  ensureColumn(db, 'corpuses', 'chunk_size_used INTEGER');
  ensureColumn(db, 'corpuses', 'chunk_count INTEGER DEFAULT 0');
  ensureColumn(db, 'corpuses', 'last_rechunked_at INTEGER');
  ensureColumn(db, 'chunks', 'start_position INTEGER');
  ensureColumn(db, 'corpus_analyses', 'progress REAL DEFAULT 0');
  ensureColumn(db, 'corpus_analyses', 'current_phase TEXT');
  ensureColumn(db, 'corpus_analyses', 'parts_generated INTEGER DEFAULT 0');

  ensureColumn(db, 'incidents', 'contained_events TEXT');
  ensureColumn(db, 'incidents', 'sub_incident_ids TEXT');
  ensureColumn(db, 'incidents', 'related_incidents TEXT');
  ensureColumn(db, 'incidents', 'related_locations TEXT');
  ensureColumn(db, 'incidents', 'causal_predecessors TEXT');
  ensureColumn(db, 'incidents', 'causal_successors TEXT');

  ensureColumn(db, 'analysis_events', 'chapter_id TEXT');
  ensureColumn(db, 'analysis_events', 'chapter_index INTEGER');
  ensureColumn(db, 'analysis_events', 'chunk_id TEXT');
  ensureColumn(db, 'analysis_events', 'chunk_index INTEGER');
  ensureColumn(db, 'analysis_events', 'incident_id TEXT');
  ensureColumn(db, 'analysis_events', 'link_role TEXT DEFAULT \'primary\'');
  ensureColumn(db, 'analysis_events', 'secondary_incident_ids TEXT');
  ensureColumn(db, 'analysis_events', 'location_link TEXT');
  ensureColumn(db, 'analysis_events', 'causal_links TEXT');
  ensureColumn(db, 'analysis_events', 'quality_proxy INTEGER DEFAULT 0');
  ensureColumn(db, 'analysis_events', 'review_status TEXT DEFAULT \'needs_review\'');
  ensureColumn(db, 'analysis_events', 'needs_review INTEGER DEFAULT 1');
  ensureColumn(db, 'analysis_events', 'annotation TEXT');

  ensureColumn(db, 'analysis_locations', 'incident_ids TEXT');
  ensureColumn(db, 'analysis_locations', 'importance REAL DEFAULT 0');
  ensureColumn(db, 'analysis_locations', 'is_major INTEGER DEFAULT 0');
  ensureColumn(db, 'analysis_locations', 'event_ids TEXT');
  ensureColumn(db, 'analysis_locations', 'confidence REAL DEFAULT 0');
  ensureColumn(db, 'analysis_locations', 'evidence_strength REAL DEFAULT 0');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_corpus_position
      ON chunks(corpus_id, start_position ASC);

    UPDATE corpuses
    SET chunk_size_used = chunk_size
    WHERE chunk_size_used IS NULL;

    UPDATE corpuses
    SET chunk_count = (
      SELECT COUNT(1) FROM chunks WHERE chunks.corpus_id = corpuses.id
    )
    WHERE chunk_count IS NULL OR chunk_count <= 0;
  `);
}
