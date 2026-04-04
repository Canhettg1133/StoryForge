/**
 * Phase 4: Analysis Viewer Database Schema
 * Tables for event_annotations, exports, saved_searches
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getCorpusDb } from '../corpus/db/schema.js';

function ensureColumn(db, tableName, columnDefinition) {
  const columnName = String(columnDefinition || '').trim().split(/\s+/u)[0];
  if (!columnName) return;

  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (rows.some((row) => row?.name === columnName)) return;

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
}

export function initViewerSchema() {
  const db = getCorpusDb();

  db.exec(`
    -- =====================================================
    -- EVENT ANNOTATIONS TABLE
    -- Store user annotations, notes, stars on events
    -- =====================================================
    CREATE TABLE IF NOT EXISTS event_annotations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      analysis_id TEXT,
      note TEXT,
      custom_tags TEXT,
      starred INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      linked_project_ids TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_event
      ON event_annotations(event_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_corpus
      ON event_annotations(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_starred
      ON event_annotations(starred);
    CREATE INDEX IF NOT EXISTS idx_annotations_created
      ON event_annotations(created_at DESC);

    -- =====================================================
    -- EXPORT HISTORY TABLE
    -- Track export operations for history/replay
    -- =====================================================
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      corpus_id TEXT,
      event_ids TEXT NOT NULL,
      event_count INTEGER DEFAULT 0,
      format TEXT NOT NULL,
      options TEXT,
      file_path TEXT,
      file_size INTEGER,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_exports_corpus
      ON exports(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_exports_format
      ON exports(format);
    CREATE INDEX IF NOT EXISTS idx_exports_created
      ON exports(created_at DESC);

    -- =====================================================
    -- SAVED SEARCHES TABLE
    -- Store user's saved search queries
    -- =====================================================
    CREATE TABLE IF NOT EXISTS saved_searches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT,
      filters TEXT,
      search_in TEXT,
      corpus_id TEXT,
      sort_by TEXT DEFAULT 'relevance',
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      last_used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_saved_searches_corpus
      ON saved_searches(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_saved_searches_created
      ON saved_searches(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_saved_searches_last_used
      ON saved_searches(last_used_at DESC);

    -- =====================================================
    -- EVENT FLAGS TABLE
    -- Additional flags/metadata on events (e.g. hidden, favorite)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS event_flags (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      flag_value TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_event_flags_event
      ON event_flags(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_flags_type
      ON event_flags(flag_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_flags_unique
      ON event_flags(event_id, flag_type);

    -- =====================================================
    -- EVENT GROUPS TABLE
    -- Groups of events selected/batched by user
    -- =====================================================
    CREATE TABLE IF NOT EXISTS event_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_ids TEXT NOT NULL,
      corpus_id TEXT,
      color TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
      updated_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_event_groups_corpus
      ON event_groups(corpus_id);
    CREATE INDEX IF NOT EXISTS idx_event_groups_created
      ON event_groups(created_at DESC);
  `);

  // Ensure columns (for migrations)
  ensureColumn(db, 'event_annotations', 'analysis_id TEXT');
  ensureColumn(db, 'event_annotations', 'linked_project_ids TEXT');
  ensureColumn(db, 'event_annotations', 'usage_count INTEGER DEFAULT 0');
  ensureColumn(db, 'event_annotations', 'last_used_at INTEGER');

  ensureColumn(db, 'exports', 'event_count INTEGER DEFAULT 0');
  ensureColumn(db, 'exports', 'options TEXT');
  ensureColumn(db, 'exports', 'file_path TEXT');
  ensureColumn(db, 'exports', 'file_size INTEGER');

  ensureColumn(db, 'saved_searches', 'filters TEXT');
  ensureColumn(db, 'saved_searches', 'search_in TEXT');
  ensureColumn(db, 'saved_searches', 'corpus_id TEXT');
  ensureColumn(db, 'saved_searches', 'sort_by TEXT DEFAULT \'relevance\'');
  ensureColumn(db, 'saved_searches', 'last_used_at INTEGER');
  ensureColumn(db, 'saved_searches', 'updated_at INTEGER');

  ensureColumn(db, 'event_flags', 'flag_value TEXT');
}

/**
 * Get viewer DB (same as corpus DB)
 */
export function getViewerDb() {
  return getCorpusDb();
}
