import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

let dbInstance = null;

function resolveDbPath() {
  return (
    process.env.STORYFORGE_CORPUS_DB_PATH
    || path.resolve(process.cwd(), 'data', 'storyforge-corpus.sqlite')
  );
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
  `);

  ensureColumn(db, 'corpuses', 'chunk_size_used INTEGER');
  ensureColumn(db, 'corpuses', 'chunk_count INTEGER DEFAULT 0');
  ensureColumn(db, 'corpuses', 'last_rechunked_at INTEGER');
  ensureColumn(db, 'chunks', 'start_position INTEGER');
  ensureColumn(db, 'corpus_analyses', 'progress REAL DEFAULT 0');
  ensureColumn(db, 'corpus_analyses', 'current_phase TEXT');
  ensureColumn(db, 'corpus_analyses', 'parts_generated INTEGER DEFAULT 0');

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
